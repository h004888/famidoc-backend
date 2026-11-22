import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { hash, hashSync } from 'bcryptjs';
import { PrismaService } from '../../../../core/database/prisma.service';
import { StorageService } from '../../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../../core/validation/document-file.validator';
import {
  todayInVietnam,
  toVietnamCalendarDate,
} from '../../../../core/business/business-helpers';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { DoctorCredentialType } from '@prisma/client';
import type {
  FacilityLegalDocumentType,
  IDoctorsService,
  UploadedDoctorCredentialFiles,
  UploadedFacilityLegalFiles,
} from '../interfaces/doctors.service.interface';
import type { ProvisionDoctorDto } from '../../dtos/provision-doctor.dto';
import type { SubmitDoctorCredentialsDto } from '../../dtos/submit-credentials.dto';
import type {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../../dtos/verify-credentials.dto';
import type { DoctorResponseDto } from '../../dtos/doctor-response.dto';
import type { CreateFacilityDto } from '../../dtos/create-facility.dto';
import type { SubmitFacilityLegalProfileDto } from '../../dtos/submit-facility-legal-profile.dto';
import type { VerifyFacilityLegalDto } from '../../dtos/verify-facility-legal.dto';
import type { FacilityResponseDto } from '../../dtos/facility-response.dto';
import { DoctorClinicalTier } from '@prisma/client';
import {
  computeQuotaMetrics,
  countActiveAndHeldMap,
} from '../../../contracts/pricing/doctor-quota.helper';
import { inferDoctorClinicalTier } from '../../utils/doctor-clinical-tier.util';
import { resolveAppPublicUrl } from '../../../../core/mailer/templates/famidoc-email-layout';
import {
  buildDoctorLevel2ApprovedEmail,
  buildDoctorLevel2ApprovedFacilityNoticeEmail,
  buildDoctorLevel2RejectedEmail,
  buildDoctorLevel2RejectedFacilityNoticeEmail,
  buildDoctorProvisioningEmail,
  buildFacilityLegalApprovedEmail,
  buildFacilityLegalRejectedEmail,
  buildFacilityProvisioningEmail,
} from '../../../../core/mailer/templates/onboarding-email.templates';
import type { ListDoctorsQueryDto } from '../../dtos/list-doctors-query.dto';
import {
  MAX_BULK_IMPORT_CONFIRM_BATCH,
  MAX_BULK_IMPORT_READ_ROWS,
  type BulkDoctorExistingRowDto,
  type BulkDoctorInvalidRowDto,
  type BulkDoctorNormalizedRowDto,
  type BulkImportCreatedDoctorDto,
  type BulkImportDoctorsPreviewResponseDto,
  type BulkImportFailedRowDto,
  type ConfirmBulkImportDoctorsDto,
  type ConfirmBulkImportDoctorsResponseDto,
} from '../../dtos/bulk-import-doctors.dto';
import {
  buildDoctorImportTemplateWorkbookBuffer,
  DEFAULT_DOCTOR_SPECIALTY,
  normalizeEmailValue,
  parseDoctorsExcelBuffer,
} from '../../utils/doctor-excel-import.util';
import {
  getVietnamesePhoneVariants,
  normalizeVietnameseMobilePhone,
  VN_MOBILE_PHONE_REGEX,
} from '../../utils/vietnamese-phone.util';

@Injectable()
export class DoctorsServiceImpl implements IDoctorsService {
  private readonly logger = new Logger(DoctorsServiceImpl.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject('MAILER_SERVICE')
    private readonly mailerService?: any,
    private readonly storage?: StorageService,
  ) {}

  private async assertActiveFacilityWithB2bContract(actor: AuthenticatedUser) {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế đối tác mới có quyền khởi tạo tài khoản Bác sĩ trực thuộc đơn vị mình',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
    });
    if (!facility || facility.verificationStatus !== 'ACTIVE') {
      throw new BadRequestException(
        'Tài khoản của bạn chưa liên kết với cơ sở y tế hợp lệ hoặc cơ sở y tế chưa được kích hoạt hoạt động',
      );
    }

    const today = todayInVietnam();
    const activeContract = await this.prisma.b2bStaffingContract.findFirst({
      where: {
        facilityId: facility.id,
        status: 'ACTIVE',
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    if (!activeContract) {
      throw new BadRequestException(
        'Cơ sở y tế chưa có hợp đồng nhân lực B2B đang có hiệu lực',
      );
    }

    return facility;
  }

  private async sendDoctorProvisioningEmail(params: {
    email: string;
    doctorName: string;
    facilityName: string;
    initialPassword: string;
  }): Promise<{ mailSent: boolean; mailWarning?: string }> {
    if (!this.mailerService?.sendMail) {
      return { mailSent: false, mailWarning: 'Dịch vụ gửi mail chưa được cấu hình' };
    }

    try {
      const emailPayload = buildDoctorProvisioningEmail({
        email: params.email,
        doctorName: params.doctorName,
        facilityName: params.facilityName,
        initialPassword: params.initialPassword,
        loginUrl: resolveAppPublicUrl('/login'),
      });
      await this.mailerService.sendMail({
        to: params.email,
        ...emailPayload,
      });
      return { mailSent: true };
    } catch (err) {
      this.logger.warn(
        `Gửi email mời bác sĩ ${params.email} thất bại: ${(err as Error)?.message ?? err}`,
      );
      return {
        mailSent: false,
        mailWarning: 'Tài khoản đã được tạo nhưng gửi email thông tin đăng nhập thất bại',
      };
    }
  }

  private async createDoctorRecordsInTransaction(params: {
    actorUserId: string;
    facilityId: string;
    ip: string;
    email: string;
    phone: string;
    doctorName: string;
    specialty: string;
    academicTitle?: string;
    experienceYears: number;
    bio?: string;
    passwordHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: params.email,
          phone: params.phone,
          fullName: params.doctorName,
          passwordHash: params.passwordHash,
          role: 'DOCTOR',
          status: 'PENDING',
          mustChangePassword: true,
        },
      });

      const doctor = await tx.doctor.create({
        data: {
          userId: newUser.id,
          facilityId: params.facilityId,
          doctorName: params.doctorName,
          specialty: params.specialty || DEFAULT_DOCTOR_SPECIALTY,
          academicTitle: params.academicTitle || null,
          experienceYears: params.experienceYears,
          bio: params.bio || null,
          onboardingStatus: 'PENDING_SUBMISSION',
        },
        include: {
          facility: true,
          credentials: true,
          user: { select: { email: true, phone: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: params.actorUserId,
          action: 'DOCTOR_ACCOUNT_PROVISIONED',
          resourceName: 'Doctor',
          resourceId: doctor.id,
          clientIp: params.ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      return doctor;
    });
  }

  async provisionDoctorAccount(
    actor: AuthenticatedUser,
    dto: ProvisionDoctorDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    const facility = await this.assertActiveFacilityWithB2bContract(actor);
    const email = normalizeEmailValue(dto.email);
    const phone = normalizeVietnameseMobilePhone(dto.phone);
    if (!VN_MOBILE_PHONE_REGEX.test(phone)) {
      throw new BadRequestException(
        'Số điện thoại không đúng định dạng di động Việt Nam',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { phone: { in: getVietnamesePhoneVariants(phone) } },
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'Email hoặc số điện thoại của bác sĩ đã tồn tại trên hệ thống',
      );
    }

    const initialPassword = this.generateRandomInitialPassword();
    const initialPasswordHash = hashSync(initialPassword, 10);
    const doctorName = dto.doctorName.trim();

    const result = await this.createDoctorRecordsInTransaction({
      actorUserId: actor.id,
      facilityId: facility.id,
      ip,
      email,
      phone,
      doctorName,
      specialty: dto.specialty?.trim() || DEFAULT_DOCTOR_SPECIALTY,
      academicTitle: dto.academicTitle?.trim() || undefined,
      experienceYears: dto.experienceYears ?? 0,
      bio: dto.bio?.trim() || undefined,
      passwordHash: initialPasswordHash,
    });

    const mailResult = await this.sendDoctorProvisioningEmail({
      email,
      doctorName,
      facilityName: facility.facilityName,
      initialPassword,
    });

    const formatted = this.formatDoctor(result, undefined, mailResult);
    return {
      ...formatted,
      email: formatted.email ?? email,
      phone: formatted.phone ?? phone,
    };
  }

  async generateDoctorImportTemplate(
    actor: AuthenticatedUser,
  ): Promise<Buffer> {
    await this.assertActiveFacilityWithB2bContract(actor);
    return buildDoctorImportTemplateWorkbookBuffer();
  }

  async previewDoctorsExcelImport(
    actor: AuthenticatedUser,
    file?: Express.Multer.File,
  ): Promise<BulkImportDoctorsPreviewResponseDto> {
    const facility = await this.assertActiveFacilityWithB2bContract(actor);
    if (!file) {
      throw new BadRequestException(
        'Vui lòng tải lên tệp Excel (.xlsx) để kiểm tra danh sách bác sĩ',
      );
    }

    const parsed = await parseDoctorsExcelBuffer(
      file.buffer,
      file.originalname,
    );

    const validRows: BulkDoctorNormalizedRowDto[] = [];
    const existingRows: BulkDoctorExistingRowDto[] = [];
    const invalidRows: BulkDoctorInvalidRowDto[] = [];

    const candidateRows: BulkDoctorNormalizedRowDto[] = [];
    const seenEmails = new Map<string, number>();
    const seenPhones = new Map<string, number>();

    for (const item of parsed.rows) {
      if (!item.isValid) {
        invalidRows.push(item.invalidRow);
        continue;
      }

      const row = item.row;
      const internalErrors: string[] = [];
      const dupEmailRow = seenEmails.get(row.email);
      if (dupEmailRow !== undefined) {
        internalErrors.push(
          `Email bị trùng với dòng ${dupEmailRow} trong cùng file Excel`,
        );
      }
      const dupPhoneRow = seenPhones.get(row.phone);
      if (dupPhoneRow !== undefined) {
        internalErrors.push(
          `Số điện thoại bị trùng với dòng ${dupPhoneRow} trong cùng file Excel`,
        );
      }

      if (internalErrors.length > 0) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          raw: {
            doctorName: row.doctorName,
            email: row.email,
            phone: row.phone,
            specialty: row.specialty,
            academicTitle: row.academicTitle,
            experienceYears: row.experienceYears,
            bio: row.bio,
          },
          errors: internalErrors,
        });
        continue;
      }

      seenEmails.set(row.email, row.rowNumber);
      seenPhones.set(row.phone, row.rowNumber);
      candidateRows.push(row);
    }

    if (candidateRows.length > 0) {
      const candidateEmails = candidateRows.map((r) => r.email);
      const candidatePhones = Array.from(
        new Set(candidateRows.flatMap((r) => getVietnamesePhoneVariants(r.phone))),
      );

      const existingUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            ...candidateEmails.map((em) => ({
              email: { equals: em, mode: 'insensitive' as const },
            })),
            { phone: { in: candidatePhones } },
          ],
        },
        select: {
          id: true,
          email: true,
          phone: true,
          fullName: true,
          role: true,
          doctor: {
            select: {
              id: true,
              facilityId: true,
              doctorName: true,
              onboardingStatus: true,
            },
          },
        },
      });

      const byEmail = new Map<string, (typeof existingUsers)[number]>();
      const byPhone = new Map<string, (typeof existingUsers)[number]>();
      for (const user of existingUsers) {
        if (user.email) byEmail.set(normalizeEmailValue(user.email), user);
        if (user.phone) {
          byPhone.set(normalizeVietnameseMobilePhone(user.phone), user);
        }
      }

      for (const row of candidateRows) {
        const emailOwner = byEmail.get(row.email);
        const phoneOwner = byPhone.get(row.phone);

        if (
          emailOwner &&
          phoneOwner &&
          emailOwner.id === phoneOwner.id &&
          emailOwner.doctor?.facilityId === facility.id
        ) {
          existingRows.push({
            rowNumber: row.rowNumber,
            doctorName: row.doctorName,
            email: row.email,
            phone: row.phone,
            existingDoctorId: emailOwner.doctor.id,
            existingDoctorName: emailOwner.doctor.doctorName,
            existingOnboardingStatus: emailOwner.doctor.onboardingStatus,
            reason:
              'Bác sĩ đã tồn tại tại cơ sở y tế này (tự động bỏ qua an toàn)',
          });
          continue;
        }

        if (emailOwner || phoneOwner) {
          const conflictErrors: string[] = [];
          if (emailOwner && phoneOwner && emailOwner.id !== phoneOwner.id) {
            conflictErrors.push(
              'Email và số điện thoại đang trùng với hai tài khoản khác nhau trên hệ thống',
            );
          } else if (emailOwner) {
            conflictErrors.push(
              emailOwner.doctor?.facilityId === facility.id
                ? `Email đã thuộc về bác sĩ ${emailOwner.doctor.doctorName} tại CSYT nhưng số điện thoại không khớp`
                : 'Email đã tồn tại trên hệ thống',
            );
          } else if (phoneOwner) {
            conflictErrors.push(
              phoneOwner.doctor?.facilityId === facility.id
                ? `Số điện thoại đã thuộc về bác sĩ ${phoneOwner.doctor.doctorName} tại CSYT nhưng email không khớp`
                : 'Số điện thoại đã tồn tại trên hệ thống',
            );
          }

          invalidRows.push({
            rowNumber: row.rowNumber,
            raw: {
              doctorName: row.doctorName,
              email: row.email,
              phone: row.phone,
              specialty: row.specialty,
              academicTitle: row.academicTitle,
              experienceYears: row.experienceYears,
              bio: row.bio,
            },
            errors: conflictErrors,
          });
          continue;
        }

        validRows.push(row);
      }
    }

    invalidRows.sort((a, b) => a.rowNumber - b.rowNumber);

    return {
      summary: {
        totalReadRows: parsed.totalReadRows,
        validCount: validRows.length,
        existingSkippedCount: existingRows.length,
        invalidCount: invalidRows.length,
        maxReadRows: MAX_BULK_IMPORT_READ_ROWS,
        maxConfirmBatch: MAX_BULK_IMPORT_CONFIRM_BATCH,
      },
      validRows,
      existingRows,
      invalidRows,
    };
  }

  async confirmDoctorsBulkImport(
    actor: AuthenticatedUser,
    dto: ConfirmBulkImportDoctorsDto,
    ip: string,
  ): Promise<ConfirmBulkImportDoctorsResponseDto> {
    const facility = await this.assertActiveFacilityWithB2bContract(actor);

    const items = dto?.doctors ?? [];
    if (items.length === 0) {
      throw new BadRequestException(
        'Vui lòng chọn ít nhất 1 bác sĩ để khởi tạo tài khoản',
      );
    }
    if (items.length > MAX_BULK_IMPORT_CONFIRM_BATCH) {
      throw new BadRequestException(
        `Mỗi lượt xác nhận chỉ được khởi tạo tối đa ${MAX_BULK_IMPORT_CONFIRM_BATCH} bác sĩ mới`,
      );
    }

    const failedRows: BulkImportFailedRowDto[] = [];
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    const dedupedItems: Array<{
      rowNumber?: number;
      email: string;
      phone: string;
      doctorName: string;
      specialty: string;
      academicTitle?: string;
      experienceYears: number;
      bio?: string;
    }> = [];

    for (const item of items) {
      const email = normalizeEmailValue(item.email);
      const phone = normalizeVietnameseMobilePhone(item.phone);
      const doctorName = item.doctorName.trim();

      if (seenEmails.has(email) || seenPhones.has(phone)) {
        failedRows.push({
          rowNumber: item.rowNumber,
          doctorName,
          email,
          phone,
          reason: 'Email hoặc số điện thoại bị trùng lặp trong danh sách xác nhận',
        });
        continue;
      }
      seenEmails.add(email);
      seenPhones.add(phone);

      dedupedItems.push({
        rowNumber: item.rowNumber,
        email,
        phone,
        doctorName,
        specialty: item.specialty?.trim() || DEFAULT_DOCTOR_SPECIALTY,
        academicTitle: item.academicTitle?.trim() || undefined,
        experienceYears: item.experienceYears ?? 0,
        bio: item.bio?.trim() || undefined,
      });
    }

    const readyToCreate: typeof dedupedItems = [];
    if (dedupedItems.length > 0) {
      const candidateEmails = dedupedItems.map((i) => i.email);
      const candidatePhones = Array.from(
        new Set(dedupedItems.flatMap((i) => getVietnamesePhoneVariants(i.phone))),
      );
      const existingUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            ...candidateEmails.map((em) => ({
              email: { equals: em, mode: 'insensitive' as const },
            })),
            { phone: { in: candidatePhones } },
          ],
        },
        select: { email: true, phone: true },
      });

      const existingEmailSet = new Set(
        existingUsers
          .map((u) => (u.email ? normalizeEmailValue(u.email) : ''))
          .filter(Boolean),
      );
      const existingPhoneSet = new Set(
        existingUsers
          .map((u) => (u.phone ? normalizeVietnameseMobilePhone(u.phone) : ''))
          .filter(Boolean),
      );

      for (const item of dedupedItems) {
        if (
          existingEmailSet.has(item.email) ||
          existingPhoneSet.has(item.phone)
        ) {
          failedRows.push({
            rowNumber: item.rowNumber,
            doctorName: item.doctorName,
            email: item.email,
            phone: item.phone,
            reason:
              'Email hoặc số điện thoại đã tồn tại trên hệ thống trước lúc xác nhận',
          });
          continue;
        }
        readyToCreate.push(item);
      }
    }

    const preparedItems = await Promise.all(
      readyToCreate.map(async (item) => {
        const initialPassword = this.generateRandomInitialPassword();
        const passwordHash = await hash(initialPassword, 10);
        return { ...item, initialPassword, passwordHash };
      }),
    );

    const createdPendingMail: Array<{
      rowNumber?: number;
      doctor: DoctorResponseDto;
      email: string;
      doctorName: string;
      initialPassword: string;
    }> = [];

    for (const item of preparedItems) {
      try {
        const doctor = await this.createDoctorRecordsInTransaction({
          actorUserId: actor.id,
          facilityId: facility.id,
          ip,
          email: item.email,
          phone: item.phone,
          doctorName: item.doctorName,
          specialty: item.specialty,
          academicTitle: item.academicTitle,
          experienceYears: item.experienceYears,
          bio: item.bio,
          passwordHash: item.passwordHash,
        });
        createdPendingMail.push({
          rowNumber: item.rowNumber,
          doctor: {
            ...this.formatDoctor(doctor),
            email: doctor.user?.email ?? item.email,
            phone: doctor.user?.phone ?? item.phone,
          },
          email: item.email,
          doctorName: item.doctorName,
          initialPassword: item.initialPassword,
        });
      } catch (err: any) {
        const isUniqueViolation = err?.code === 'P2002';
        failedRows.push({
          rowNumber: item.rowNumber,
          doctorName: item.doctorName,
          email: item.email,
          phone: item.phone,
          reason: isUniqueViolation
            ? 'Email hoặc số điện thoại vừa được tạo bởi một thao tác khác'
            : err?.message || 'Không thể khởi tạo tài khoản bác sĩ',
        });
      }
    }

    const createdDoctors: BulkImportCreatedDoctorDto[] = [];
    const MAIL_CONCURRENCY = 5;
    for (let i = 0; i < createdPendingMail.length; i += MAIL_CONCURRENCY) {
      const chunk = createdPendingMail.slice(i, i + MAIL_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (entry) => {
          const mailResult = await this.sendDoctorProvisioningEmail({
            email: entry.email,
            doctorName: entry.doctorName,
            facilityName: facility.facilityName,
            initialPassword: entry.initialPassword,
          });
          return {
            rowNumber: entry.rowNumber,
            doctor: entry.doctor,
            mailSent: mailResult.mailSent,
            ...(mailResult.mailWarning
              ? { mailWarning: mailResult.mailWarning }
              : {}),
          };
        }),
      );
      createdDoctors.push(...chunkResults);
    }

    const mailSentCount = createdDoctors.filter((d) => d.mailSent).length;
    const mailFailedCount = createdDoctors.length - mailSentCount;

    return {
      summary: {
        requestedCount: items.length,
        createdCount: createdDoctors.length,
        failedCount: failedRows.length,
        mailSentCount,
        mailFailedCount,
      },
      createdDoctors,
      failedRows,
    };
  }

  private resolveCredentialLabel(type: DoctorCredentialType): string {
    switch (type) {
      case DoctorCredentialType.PRACTICE_LICENSE_CCHN:
        return 'Chứng chỉ / Giấy phép hành nghề KBCB (CCHN/GPHN)';
      case DoctorCredentialType.DEGREE:
        return 'Bằng tốt nghiệp / chuyên môn';
      case DoctorCredentialType.FAMILY_MEDICINE_CERT:
        return 'Chứng chỉ / chứng nhận Y học gia đình';
    }
  }

  private pickUploadedCredentialFile(
    type: DoctorCredentialType,
    index: number,
    uploadedFiles?: UploadedDoctorCredentialFiles,
  ): Express.Multer.File | undefined {
    if (!uploadedFiles) return undefined;
    if (type === DoctorCredentialType.PRACTICE_LICENSE_CCHN) {
      return (
        uploadedFiles.cchnFile?.[0] ||
        uploadedFiles.practiceLicenseFile?.[0] ||
        uploadedFiles.files?.[index]
      );
    }
    if (type === DoctorCredentialType.DEGREE) {
      return uploadedFiles.degreeFile?.[0] || uploadedFiles.files?.[index];
    }
    if (type === DoctorCredentialType.FAMILY_MEDICINE_CERT) {
      return (
        uploadedFiles.familyMedicineFile?.[0] ||
        uploadedFiles.familyMedicineCertFile?.[0] ||
        uploadedFiles.files?.[index]
      );
    }
    return uploadedFiles.files?.[index];
  }

  async submitDoctorCredentials(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: SubmitDoctorCredentialsDto,
    ip: string,
    uploadedFiles?: UploadedDoctorCredentialFiles,
  ): Promise<DoctorResponseDto> {
    const doctor =
      doctorId === 'me'
        ? await this.prisma.doctor.findFirst({
            where: { userId: actor.id },
            include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
          })
        : await this.prisma.doctor.findUnique({
            where: { id: doctorId },
            include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
          });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    const actualDoctorId = doctor.id;

    if (actor.role === 'DOCTOR' && doctor.userId !== actor.id) {
      throw new ForbiddenException(
        'Bạn không có quyền nộp chứng chỉ cho bác sĩ khác',
      );
    }

    if (doctor.onboardingStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Bác sĩ đã hoàn tất onboarding và đang hoạt động (ACTIVE), không thể nộp lại hồ sơ',
      );
    }
    if (doctor.onboardingStatus === 'FACILITY_VERIFIED') {
      throw new BadRequestException(
        'Hồ sơ bác sĩ đã được Cơ sở y tế duyệt Cấp 1 và đang chờ Quản trị viên thẩm định Cấp 2, không thể tự ý nộp đè.',
      );
    }
    if (doctor.onboardingStatus === 'SUSPENDED') {
      throw new BadRequestException(
        'Tài khoản bác sĩ đang bị tạm đình chỉ (SUSPENDED), không thể nộp hồ sơ.',
      );
    }

    const requiredTypes: DoctorCredentialType[] = [
      DoctorCredentialType.PRACTICE_LICENSE_CCHN,
      DoctorCredentialType.DEGREE,
      DoctorCredentialType.FAMILY_MEDICINE_CERT,
    ];
    const todayVn = todayInVietnam();
    const seenTypes = new Set<DoctorCredentialType>();
    for (const c of dto.credentials) {
      if (seenTypes.has(c.credentialType)) {
        throw new BadRequestException(
          `Loại giấy tờ ${this.resolveCredentialLabel(c.credentialType)} bị trùng lặp.`,
        );
      }
      seenTypes.add(c.credentialType);

      const issueDate = toVietnamCalendarDate(c.issueDate);
      if (!issueDate) {
        throw new BadRequestException(
          `Ngày cấp chứng chỉ ${c.certificateNumber} không hợp lệ`,
        );
      }
      if (issueDate > todayVn) {
        throw new BadRequestException(
          `Ngày cấp chứng chỉ ${c.certificateNumber} không được ở tương lai`,
        );
      }
    }

    const missingTypes = requiredTypes.filter((t) => !seenTypes.has(t));
    if (missingTypes.length > 0) {
      throw new BadRequestException(
        `Thiếu tài liệu bắt buộc: ${missingTypes
          .map((t) => this.resolveCredentialLabel(t))
          .join(', ')}.`,
      );
    }

    const existingByType = new Map<DoctorCredentialType, any>(
      (doctor.credentials ?? []).map((c: any) => [c.credentialType, c]),
    );

    const preparedCredentials: Array<{
      id: string;
      doctorId: string;
      credentialType: DoctorCredentialType;
      certificateNumber: string;
      issueDate: Date;
      issuingAuthority: string;
      fileKey: string;
      fileUrl: string;
      facilityVerified: boolean;
      platformApproved: boolean;
      rejectionReason: null;
    }> = [];

    for (let i = 0; i < dto.credentials.length; i++) {
      const item = dto.credentials[i];
      const label = this.resolveCredentialLabel(item.credentialType);
      const uploadedFile = this.pickUploadedCredentialFile(
        item.credentialType,
        i,
        uploadedFiles,
      );
      const credId = randomUUID();

      let fileKey: string | undefined;
      if (uploadedFile) {
        const validated = validateUploadedDocumentFile(uploadedFile, {
          maxBytes: 10 * 1024 * 1024,
          label,
        });
        if (!this.storage) {
          throw new ServiceUnavailableException('Kho lưu trữ chưa sẵn sàng.');
        }
        try {
          fileKey = await this.storage.uploadFile(
            {
              ...uploadedFile,
              mimetype: validated.contentType,
              originalname: `${item.credentialType.toLowerCase()}.${validated.extension}`,
            },
            `doctor-credentials/${actualDoctorId}`,
          );
        } catch (err: any) {
          this.logger.error(
            `Upload chứng chỉ bác sĩ (${item.credentialType}) thất bại: ${err?.message || err}`,
          );
          throw new ServiceUnavailableException(
            `Không thể lưu tệp ${label} lên hệ thống lưu trữ.`,
          );
        }
      } else {
        const prior = existingByType.get(item.credentialType);
        if (prior?.fileKey) {
          fileKey = prior.fileKey;
        }
      }

      if (!fileKey) {
        throw new BadRequestException(
          `Vui lòng tải lên tệp scan (PDF, PNG hoặc JPEG) cho ${label}.`,
        );
      }

      preparedCredentials.push({
        id: credId,
        doctorId: actualDoctorId,
        credentialType: item.credentialType,
        certificateNumber: item.certificateNumber.trim(),
        issueDate: new Date(item.issueDate),
        issuingAuthority: item.issuingAuthority.trim(),
        fileKey,
        fileUrl: `/api/v1/doctors/${actualDoctorId}/credentials/${credId}/file`,
        facilityVerified: false,
        platformApproved: false,
        rejectionReason: null,
      });
    }

    const updatedDoctor = await this.prisma.$transaction(async (tx) => {
      await tx.doctorCredential.deleteMany({
        where: { doctorId: actualDoctorId },
      });

      await tx.doctorCredential.createMany({
        data: preparedCredentials,
      });

      const updated = await tx.doctor.update({
        where: { id: actualDoctorId },
        data: {
          onboardingStatus: 'PENDING_FACILITY_REVIEW',
          rejectionReason: null,
          credentialsSubmittedAt: new Date(),
          ...(dto.academicTitle !== undefined
            ? { academicTitle: dto.academicTitle.trim() || null }
            : {}),
          ...(dto.specialty?.trim() ? { specialty: dto.specialty.trim() } : {}),
          ...(dto.experienceYears !== undefined
            ? { experienceYears: dto.experienceYears }
            : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
          updatedAt: new Date(),
        },
        include: {
          facility: true,
          credentials: true,
          user: { select: { email: true, phone: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'DOCTOR_CREDENTIALS_SUBMITTED',
          resourceName: 'Doctor',
          resourceId: actualDoctorId,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      if (doctor.facility?.userId) {
        await tx.notification.create({
          data: {
            userId: doctor.facility.userId,
            title: 'Hồ sơ chứng chỉ bác sĩ mới cần thẩm định',
            content: `Bác sĩ ${doctor.doctorName} đã nộp đủ 3 tài liệu chứng chỉ hành nghề, đang chờ cơ sở y tế thẩm định Cấp 1.`,
            type: 'DOCTOR_CREDENTIALS_SUBMITTED',
            referenceId: actualDoctorId,
          },
        });
      }

      return updated;
    });

    return this.formatDoctor(updatedDoctor);
  }

  async getDoctorCredentialFile(
    actor: AuthenticatedUser,
    doctorId: string,
    credentialId: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const doctor =
      doctorId === 'me'
        ? await this.prisma.doctor.findUnique({
            where: { userId: actor.id },
            include: { facility: true },
          })
        : await this.prisma.doctor.findUnique({
            where: { id: doctorId },
            include: { facility: true },
          });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (actor.role === 'DOCTOR' && doctor.userId !== actor.id) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập tài liệu của bác sĩ khác',
      );
    }
    if (
      actor.role === 'HEALTHCARE_FACILITY' &&
      doctor.facility?.userId !== actor.id
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập tài liệu bác sĩ của cơ sở y tế khác',
      );
    }

    const credential = await this.prisma.doctorCredential.findFirst({
      where: { id: credentialId, doctorId: doctor.id },
      select: { fileKey: true },
    });

    if (!credential?.fileKey) {
      throw new NotFoundException('Không tìm thấy tệp chứng chỉ trên hệ thống');
    }
    if (!this.storage) {
      throw new ServiceUnavailableException('Kho lưu trữ chưa sẵn sàng.');
    }

    return this.storage.downloadFile(credential.fileKey);
  }

  async approveDoctorCredentialsByFacility(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: FacilityVerifyCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (actor.role === 'HEALTHCARE_FACILITY') {
      if (doctor.facility.userId !== actor.id) {
        throw new ForbiddenException(
          'Chỉ cơ sở y tế quản lý trực tiếp bác sĩ này mới có quyền thẩm định cấp 1',
        );
      }
      if (doctor.facility.verificationStatus !== 'ACTIVE') {
        throw new ForbiddenException(
          'Cơ sở y tế chưa hoàn tất thẩm định pháp lý (ACTIVE).',
        );
      }
    } else if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền thẩm định hồ sơ bác sĩ');
    }

    if (doctor.onboardingStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Bác sĩ đã ở trạng thái ACTIVE, không cần thẩm định lại',
      );
    }

    if (doctor.onboardingStatus !== 'PENDING_FACILITY_REVIEW') {
      throw new BadRequestException(
        'Hồ sơ bác sĩ chưa ở trạng thái chờ Cơ sở y tế thẩm định Cấp 1 (PENDING_FACILITY_REVIEW).',
      );
    }

    if (dto.approved) {
      const submittedTypes = new Set(
        (doctor.credentials ?? []).map((c: any) => c.credentialType),
      );
      const requiredTypes: DoctorCredentialType[] = [
        DoctorCredentialType.PRACTICE_LICENSE_CCHN,
        DoctorCredentialType.DEGREE,
        DoctorCredentialType.FAMILY_MEDICINE_CERT,
      ];
      const missingTypes = requiredTypes.filter((t) => !submittedTypes.has(t));
      if (missingTypes.length > 0) {
        throw new BadRequestException(
          `Bác sĩ chưa nộp đủ 3 loại văn bằng chứng chỉ bắt buộc để thẩm định (${missingTypes
            .map((t) => this.resolveCredentialLabel(t))
            .join(', ')}).`,
        );
      }
    }

    if (!dto.approved && (!dto.rejectionReason || !dto.rejectionReason.trim())) {
      throw new BadRequestException(
        'Vui lòng cung cấp lý do từ chối thẩm định (rejectionReason)',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            facilityVerified: true,
            facilityVerifiedBy: actor.id,
            facilityVerifiedAt: new Date(),
            rejectionReason: null,
          },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'FACILITY_VERIFIED',
            rejectionReason: null,
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'DOCTOR_CREDENTIALS_FACILITY_VERIFIED',
            resourceName: 'Doctor',
            resourceId: doctorId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        const admins = await tx.user.findMany({
          where: { role: 'ADMIN', status: 'ACTIVE' },
        });

        for (const admin of admins) {
          await tx.notification.create({
            data: {
              userId: admin.id,
              title: 'Hồ sơ bác sĩ đã được CSYT thẩm định Cấp 1',
              content: `Hồ sơ bác sĩ ${doctor.doctorName} (${doctor.facility.facilityName}) đã qua thẩm định Cấp 1, chờ phê duyệt Cấp 2.`,
              type: 'DOCTOR_FACILITY_VERIFIED',
              referenceId: doctor.id,
            },
          });
        }

        return doc;
      } else {
        const rejectionReason =
          dto.rejectionReason?.trim() || 'Cơ sở y tế từ chối thẩm định';
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            facilityVerified: false,
            rejectionReason,
          },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'PENDING_SUBMISSION',
            rejectionReason,
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'DOCTOR_CREDENTIALS_FACILITY_REJECTED',
            resourceName: 'Doctor',
            resourceId: doctorId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: doctor.userId,
            title: 'Hồ sơ văn bằng chuyên môn bị Cơ sở y tế từ chối',
            content: `Cơ sở y tế đã từ chối hồ sơ chuyên môn của bạn. Lý do: ${dto.rejectionReason || 'Không đạt yêu cầu'}. Vui lòng cập nhật lại.`,
            type: 'DOCTOR_FACILITY_REJECTED',
            referenceId: doctor.id,
          },
        });

        return doc;
      }
    });

    return this.formatDoctor(updated);
  }

  async approveDoctorCredentialsByPlatform(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: PlatformApproveCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên Nền tảng mới có quyền phê duyệt cấp 2',
      );
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (doctor.onboardingStatus !== 'FACILITY_VERIFIED') {
      throw new BadRequestException(
        'Hồ sơ bác sĩ phải được Cơ sở y tế thẩm định cấp 1 (FACILITY_VERIFIED) trước khi Quản trị viên duyệt kích hoạt',
      );
    }

    if (!dto.approved && (!dto.rejectionReason || !dto.rejectionReason.trim())) {
      throw new BadRequestException(
        'Vui lòng cung cấp lý do từ chối phê duyệt (rejectionReason)',
      );
    }

    const rejectionReason = !dto.approved
      ? dto.rejectionReason?.trim() || 'Quản trị viên từ chối phê duyệt cấp 2'
      : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            platformApproved: true,
            platformApprovedBy: actor.id,
            platformApprovedAt: new Date(),
            rejectionReason: null,
          },
        });

        await tx.user.update({
          where: { id: doctor.userId },
          data: { status: 'ACTIVE' },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'ACTIVE',
            rejectionReason: null,
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'DOCTOR_CREDENTIALS_PLATFORM_APPROVED',
            resourceName: 'Doctor',
            resourceId: doctorId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: doctor.userId,
            title: 'Chúc mừng! Hồ sơ bác sĩ của bạn đã được phê duyệt',
            content:
              'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn đã được Quản trị viên FamiDoc phê duyệt cấp 2. Tài khoản của bạn hiện đã được kích hoạt (ACTIVE) và sẵn sàng tiếp nhận hộ gia đình.',
            type: 'DOCTOR_PLATFORM_APPROVED',
            referenceId: doctor.id,
          },
        });

        if (doctor.facility?.userId) {
          await tx.notification.create({
            data: {
              userId: doctor.facility.userId,
              title: 'Hoàn tất onboarding bác sĩ trực thuộc',
              content: `Bác sĩ ${doctor.doctorName} đã được Quản trị viên Nền tảng phê duyệt Cấp 2 và chính thức kích hoạt hoạt động (ACTIVE).`,
              type: 'DOCTOR_ONBOARDING_COMPLETED',
              referenceId: doctor.id,
            },
          });
        }

        return doc;
      } else {
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            facilityVerified: false,
            platformApproved: false,
            rejectionReason,
          },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'PENDING_SUBMISSION',
            rejectionReason,
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'DOCTOR_CREDENTIALS_PLATFORM_REJECTED',
            resourceName: 'Doctor',
            resourceId: doctorId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: doctor.userId,
            title: 'Hồ sơ văn bằng chuyên môn bị Quản trị viên từ chối',
            content: `Quản trị viên đã từ chối phê duyệt hồ sơ chuyên môn của bạn. Lý do: ${rejectionReason}. Vui lòng kiểm tra và bổ sung lại.`,
            type: 'DOCTOR_PLATFORM_REJECTED',
            referenceId: doctor.id,
          },
        });

        if (doctor.facility?.userId) {
          await tx.notification.create({
            data: {
              userId: doctor.facility.userId,
              title: 'Hồ sơ bác sĩ bị Quản trị viên từ chối ở Cấp 2',
              content: `Hồ sơ bác sĩ ${doctor.doctorName} không đạt phê duyệt Cấp 2. Lý do: ${rejectionReason}. Bác sĩ cần bổ sung và gửi lại để CSYT thẩm định lại.`,
              type: 'DOCTOR_PLATFORM_REJECTED',
              referenceId: doctor.id,
            },
          });
        }

        return doc;
      }
    });

    if (this.mailerService?.sendMail) {
      const docUser = await this.prisma.user.findUnique({
        where: { id: doctor.userId },
      });
      const facUser = doctor.facility?.userId
        ? await this.prisma.user.findUnique({
            where: { id: doctor.facility.userId },
          })
        : null;

      const loginUrl = resolveAppPublicUrl('/login');

      if (dto.approved) {
        if (docUser?.email) {
          try {
            await this.mailerService.sendMail({
              to: docUser.email,
              ...buildDoctorLevel2ApprovedEmail({
                doctorName: doctor.doctorName,
                loginUrl,
              }),
            });
          } catch (err) {
            this.logger.warn(
              `Gửi email duyệt Cấp 2 tới bác sĩ ${docUser.email} thất bại: ${(err as Error)?.message ?? err}`,
            );
          }
        }

        if (facUser?.email && facUser.email !== docUser?.email) {
          try {
            await this.mailerService.sendMail({
              to: facUser.email,
              ...buildDoctorLevel2ApprovedFacilityNoticeEmail({
                facilityName: doctor.facility.facilityName,
                doctorName: doctor.doctorName,
                loginUrl,
              }),
            });
          } catch (err) {
            this.logger.warn(
              `Gửi email duyệt Cấp 2 tới CSYT ${facUser.email} thất bại: ${(err as Error)?.message ?? err}`,
            );
          }
        }
      } else {
        if (docUser?.email) {
          try {
            await this.mailerService.sendMail({
              to: docUser.email,
              ...buildDoctorLevel2RejectedEmail({
                doctorName: doctor.doctorName,
                rejectionReason: rejectionReason ?? '',
                loginUrl,
              }),
            });
          } catch (err) {
            this.logger.warn(
              `Gửi email từ chối Cấp 2 tới bác sĩ ${docUser.email} thất bại: ${(err as Error)?.message ?? err}`,
            );
          }
        }

        if (facUser?.email && facUser.email !== docUser?.email) {
          try {
            await this.mailerService.sendMail({
              to: facUser.email,
              ...buildDoctorLevel2RejectedFacilityNoticeEmail({
                facilityName: doctor.facility.facilityName,
                doctorName: doctor.doctorName,
                rejectionReason: rejectionReason ?? '',
                loginUrl,
              }),
            });
          } catch (err) {
            this.logger.warn(
              `Gửi email từ chối Cấp 2 tới CSYT ${facUser.email} thất bại: ${(err as Error)?.message ?? err}`,
            );
          }
        }
      }
    }

    return this.formatDoctor(updated);
  }

  async getDoctorProfile(
    actor: AuthenticatedUser,
    doctorId: string,
  ): Promise<DoctorResponseDto> {
    if (doctorId === 'me') {
      const doc = await this.prisma.doctor.findUnique({
        where: { userId: actor.id },
        include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
      });
      if (!doc) {
        throw new NotFoundException(
          'Không tìm thấy thông tin bác sĩ liên kết với tài khoản này',
        );
      }
      return this.formatDoctor(doc);
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { facility: true, credentials: true, user: { select: { email: true, phone: true } } },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (actor.role === 'HEALTHCARE_FACILITY') {
      if (doctor.facility?.userId !== actor.id) {
        throw new ForbiddenException(
          'Bạn không có quyền xem thông tin bác sĩ của cơ sở y tế khác',
        );
      }
    }

    return this.formatDoctor(doctor);
  }

  async listDoctors(
    actor: AuthenticatedUser,
    query: ListDoctorsQueryDto,
  ): Promise<{
    items: DoctorResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (actor.role === 'HEALTHCARE_FACILITY') {
      const facility = await this.prisma.healthcareFacility.findUnique({
        where: { userId: actor.id },
      });
      if (!facility || facility.verificationStatus !== 'ACTIVE') {
        throw new ForbiddenException(
          'Cơ sở y tế chưa hoàn tất thẩm định pháp lý (ACTIVE).',
        );
      }
      where.facilityId = facility.id;
    } else if (actor.role === 'ADMIN') {
      if (query.facilityId) {
        where.facilityId = query.facilityId;
      }
    } else {
      throw new ForbiddenException(
        'Bạn không có quyền xem danh sách nhân sự bác sĩ',
      );
    }

    if (query.onboardingStatus) {
      where.onboardingStatus = query.onboardingStatus;
    }

    if (query.search) {
      where.OR = [
        { doctorName: { contains: query.search, mode: 'insensitive' } },
        { specialty: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.doctor.count({ where }),
      this.prisma.doctor.findMany({
        where,
        skip,
        take: limit,
        include: {
          facility: true,
          credentials: true,
          user: { select: { email: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const doctorIds = items.map((doc) => doc.id);
    const activeHeldMap =
      typeof this.prisma.medicalContract?.findMany === 'function'
        ? await countActiveAndHeldMap(this.prisma, doctorIds)
        : new Map<string, number>();

    return {
      items: items.map((doc) =>
        this.formatDoctor(
          doc,
          activeHeldMap.get(doc.id) ?? doc.activePanelCount ?? 0,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async listFacilityDoctors(
    actor: AuthenticatedUser,
    query: ListDoctorsQueryDto,
  ): Promise<{
    items: DoctorResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền xem danh sách bác sĩ trực thuộc',
      );
    }
    return this.listDoctors(actor, query);
  }

  private formatDoctor(
    doctor: any,
    activeAndHeldCountOverride?: number,
    mailResult?: { mailSent: boolean; mailWarning?: string },
  ): DoctorResponseDto {
    const activeAndHeld =
      activeAndHeldCountOverride ?? doctor.activePanelCount ?? 0;
    const quota = computeQuotaMetrics(doctor.maxPanelCapacity, activeAndHeld);
    const clinicalTier: DoctorClinicalTier =
      doctor.clinicalTier ??
      inferDoctorClinicalTier(doctor.experienceYears ?? 0, doctor.academicTitle);

    return {
      id: doctor.id,
      userId: doctor.userId,
      facilityId: doctor.facilityId,
      ...(doctor.user?.email ? { email: doctor.user.email } : {}),
      ...(doctor.user?.phone ? { phone: doctor.user.phone } : {}),
      doctorName: doctor.doctorName,
      specialty: doctor.specialty,
      academicTitle: doctor.academicTitle,
      experienceYears: doctor.experienceYears,
      clinicalTier,
      bio: doctor.bio,
      activePanelCount: doctor.activePanelCount,
      maxPanelCapacity: doctor.maxPanelCapacity,
      activeAndHeldCount: quota.activeAndHeldCount,
      remainingSlots: quota.remainingSlots,
      isQuotaFull: quota.isQuotaFull,
      ratingAvg: Number(doctor.ratingAvg),
      totalReviews: doctor.totalReviews,
      onboardingStatus: doctor.onboardingStatus,
      rejectionReason: doctor.rejectionReason ?? null,
      credentialsSubmittedAt: doctor.credentialsSubmittedAt ?? null,
      createdAt: doctor.createdAt,
      updatedAt: doctor.updatedAt,
      ...(doctor.facility
        ? {
            facility: {
              id: doctor.facility.id,
              facilityName: doctor.facility.facilityName,
              address: doctor.facility.address,
              hotline: doctor.facility.hotline,
            },
          }
        : {}),
      ...(doctor.credentials
        ? {
            credentials: doctor.credentials.map((c: any) => ({
              id: c.id,
              credentialType: c.credentialType,
              certificateNumber: c.certificateNumber,
              issueDate: c.issueDate,
              issuingAuthority: c.issuingAuthority,
              fileUrl: c.fileUrl,
              facilityVerified: c.facilityVerified,
              facilityVerifiedAt: c.facilityVerifiedAt,
              platformApproved: c.platformApproved,
              platformApprovedAt: c.platformApprovedAt,
              rejectionReason: c.rejectionReason,
            })),
          }
        : {}),
      ...(mailResult
        ? {
            mailSent: mailResult.mailSent,
            ...(mailResult.mailWarning
              ? { mailWarning: mailResult.mailWarning }
              : {}),
          }
        : {}),
    };
  }

  // ==========================================
  // FACILITY ONBOARDING METHODS (ADMIN-LED)
  // ==========================================

  private generateRandomInitialPassword(): string {
    return `Fd!${randomBytes(12).toString('base64url')}9`;
  }

  async createFacilityByAdmin(
    actor: AuthenticatedUser,
    dto: CreateFacilityDto,
    ip: string,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền khởi tạo tài khoản Cơ sở y tế',
      );
    }

    const email = normalizeEmailValue(dto.email);
    const phone = normalizeVietnameseMobilePhone(dto.phone);
    if (!VN_MOBILE_PHONE_REGEX.test(phone)) {
      throw new BadRequestException(
        'Số điện thoại không đúng định dạng di động Việt Nam',
      );
    }
    const facilityName = dto.facilityName.trim();
    const representativeName = dto.representativeName.trim();
    const address = dto.address?.trim() || 'Chưa cập nhật địa chỉ';

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone: { in: getVietnamesePhoneVariants(phone) } }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'Email hoặc số điện thoại của người đại diện đã tồn tại trên hệ thống',
      );
    }

    const existingFacility = await this.prisma.healthcareFacility.findFirst({
      where: { facilityName },
    });

    if (existingFacility) {
      throw new ConflictException(
        'Tên cơ sở y tế này đã được đăng ký trên hệ thống',
      );
    }

    const initialPassword = this.generateRandomInitialPassword();
    const passwordHash = hashSync(initialPassword, 10);
    const randomSuffix = randomUUID().substring(0, 8).toUpperCase();

    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          phone,
          fullName: representativeName,
          passwordHash,
          role: 'HEALTHCARE_FACILITY',
          status: 'ACTIVE',
          mustChangePassword: true,
        },
      });

      const facility = await tx.healthcareFacility.create({
        data: {
          userId: newUser.id,
          facilityName,
          address,
          hotline: phone,
          licenseNumber: `PENDING_LICENSE_${randomSuffix}`,
          taxCode: `PENDING_TAX_${randomSuffix}`,
          bankName: 'CHƯA_CẬP_NHẬT',
          bankAccountNumber: 'CHƯA_CẬP_NHẬT',
          bankAccountHolder: 'CHƯA_CẬP_NHẬT',
          verificationStatus: 'PENDING',
        },
        include: { user: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'FACILITY_ACCOUNT_CREATED_BY_ADMIN',
          resourceName: 'HealthcareFacility',
          resourceId: facility.id,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: newUser.id,
          title: 'Tài khoản Cơ sở Y tế đã được khởi tạo',
          content:
            'Quản trị viên đã tạo tài khoản cổng đối tác cho cơ sở y tế của bạn. Vui lòng hoàn thiện và nộp hồ sơ pháp lý để được thẩm định kích hoạt.',
          type: 'FACILITY_ACCOUNT_CREATED',
          referenceId: facility.id,
        },
      });

      return facility;
    });

    if (this.mailerService?.sendMail) {
      try {
        await this.mailerService.sendMail({
          to: email,
          ...buildFacilityProvisioningEmail({
            recipientName: representativeName,
            facilityName,
            email,
            initialPassword,
            loginUrl: resolveAppPublicUrl('/login'),
          }),
        });
      } catch {
        // Silently ignore mail errors in dev
      }
    }

    return this.formatFacility(created);
  }

  private resolveFacilityLegalFiles(
    filesOrSingle?: Express.Multer.File | UploadedFacilityLegalFiles,
  ): {
    operatingLicenseFile?: Express.Multer.File;
    businessLicenseFile?: Express.Multer.File;
  } {
    if (!filesOrSingle) {
      return {};
    }
    if ('buffer' in filesOrSingle && 'originalname' in filesOrSingle) {
      return { operatingLicenseFile: filesOrSingle };
    }
    const grouped = filesOrSingle as UploadedFacilityLegalFiles;
    return {
      operatingLicenseFile:
        grouped.operatingLicenseFile?.[0] || grouped.file?.[0],
      businessLicenseFile: grouped.businessLicenseFile?.[0],
    };
  }

  async submitFacilityLegalProfile(
    actor: AuthenticatedUser,
    dto: SubmitFacilityLegalProfileDto,
    ip: string,
    filesOrSingle?: Express.Multer.File | UploadedFacilityLegalFiles,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền cập nhật hồ sơ pháp lý',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
      include: { user: true },
    });

    if (!facility) {
      throw new NotFoundException(
        'Không tìm thấy thông tin cơ sở y tế liên kết với tài khoản này',
      );
    }

    if (facility.verificationStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Cơ sở y tế đã hoàn tất thẩm định pháp lý (ACTIVE), không cần nộp lại hồ sơ',
      );
    }

    const parsedLicenseDate = toVietnamCalendarDate(dto.licenseDate);
    if (!parsedLicenseDate) {
      throw new BadRequestException('Ngày cấp giấy phép hoạt động không hợp lệ');
    }
    if (parsedLicenseDate > todayInVietnam()) {
      throw new BadRequestException(
        'Ngày cấp giấy phép hoạt động không được ở tương lai',
      );
    }

    const { operatingLicenseFile, businessLicenseFile } =
      this.resolveFacilityLegalFiles(filesOrSingle);

    if (!operatingLicenseFile && !facility.legalDocumentKey) {
      throw new BadRequestException(
        'Vui lòng tải lên bản scan Giấy phép hoạt động KBCB (PDF, PNG hoặc JPEG).',
      );
    }

    if (!businessLicenseFile && !facility.businessLicenseKey) {
      throw new BadRequestException(
        'Vui lòng tải lên bản scan Giấy chứng nhận Đăng ký doanh nghiệp (PDF, PNG hoặc JPEG).',
      );
    }

    const validatedOperating = operatingLicenseFile
      ? validateUploadedDocumentFile(operatingLicenseFile, {
          maxBytes: 10 * 1024 * 1024,
          label: 'Bản scan Giấy phép hoạt động KBCB',
        })
      : null;

    const validatedBusiness = businessLicenseFile
      ? validateUploadedDocumentFile(businessLicenseFile, {
          maxBytes: 10 * 1024 * 1024,
          label: 'Bản scan Giấy chứng nhận Đăng ký doanh nghiệp',
        })
      : null;

    const duplicateLicense = await this.prisma.healthcareFacility.findFirst({
      where: {
        licenseNumber: dto.licenseNumber.trim(),
        id: { not: facility.id },
      },
    });

    if (duplicateLicense) {
      throw new ConflictException(
        'Số giấy phép hoạt động khám chữa bệnh đã được đăng ký bởi cơ sở y tế khác',
      );
    }

    const duplicateTax = await this.prisma.healthcareFacility.findFirst({
      where: {
        taxCode: dto.taxCode.trim(),
        id: { not: facility.id },
      },
    });

    if (duplicateTax) {
      throw new ConflictException(
        'Mã số thuế doanh nghiệp đã được đăng ký bởi cơ sở y tế khác',
      );
    }

    let operatingDocumentKey: string | undefined;
    let businessDocumentKey: string | undefined;

    if (operatingLicenseFile && validatedOperating) {
      if (!this.storage) {
        throw new ServiceUnavailableException('Kho lưu trữ chưa sẵn sàng.');
      }
      try {
        operatingDocumentKey = await this.storage.uploadFile(
          {
            ...operatingLicenseFile,
            mimetype: validatedOperating.contentType,
            originalname: `operating-license.${validatedOperating.extension}`,
          },
          `facility-legal/${facility.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Upload GPHĐ CSYT (${facility.id}) thất bại: ${err?.message || err}`,
        );
        throw new ServiceUnavailableException(
          'Không thể lưu bản scan Giấy phép hoạt động KBCB.',
        );
      }
    }

    if (businessLicenseFile && validatedBusiness) {
      if (!this.storage) {
        throw new ServiceUnavailableException('Kho lưu trữ chưa sẵn sàng.');
      }
      try {
        businessDocumentKey = await this.storage.uploadFile(
          {
            ...businessLicenseFile,
            mimetype: validatedBusiness.contentType,
            originalname: `business-license.${validatedBusiness.extension}`,
          },
          `facility-legal/${facility.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Upload ĐKKD CSYT (${facility.id}) thất bại: ${err?.message || err}`,
        );
        throw new ServiceUnavailableException(
          'Không thể lưu bản scan Giấy chứng nhận Đăng ký doanh nghiệp.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const fac = await tx.healthcareFacility.update({
        where: { id: facility.id, verificationStatus: { not: 'ACTIVE' } },
        data: {
          licenseNumber: dto.licenseNumber.trim(),
          taxCode: dto.taxCode.trim(),
          hotline: dto.hotline.trim(),
          bankName: dto.bankName.trim(),
          bankBin: dto.bankBin?.trim() || null,
          bankCode: dto.bankCode?.trim().toUpperCase() || null,
          bankAccountNumber: dto.bankAccountNumber.trim(),
          bankAccountHolder: dto.bankAccountHolder.trim(),
          facilityName: dto.facilityName?.trim() || facility.facilityName,
          address: dto.address.trim(),
          legalDocumentsUrl: null,
          legalDocumentKey: operatingDocumentKey ?? facility.legalDocumentKey,
          businessLicenseKey: businessDocumentKey ?? facility.businessLicenseKey,
          licenseIssuer: dto.licenseIssuer.trim(),
          licenseDate: parsedLicenseDate,
          legalRejectionReason: null,
          verificationStatus: 'PENDING',
          updatedAt: new Date(),
        },
        include: { user: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'FACILITY_LEGAL_PROFILE_SUBMITTED',
          resourceName: 'HealthcareFacility',
          resourceId: facility.id,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      const admins = await tx.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });

      for (const admin of admins) {
        await tx.notification.create({
          data: {
            userId: admin.id,
            title: 'Hồ sơ pháp lý cơ sở y tế chờ thẩm định',
            content: `Cơ sở y tế ${fac.facilityName} (GPHĐ: ${dto.licenseNumber}) đã nộp hồ sơ pháp lý và tài khoản ngân hàng. Vui lòng thẩm định.`,
            type: 'FACILITY_LEGAL_PROFILE_SUBMITTED',
            referenceId: fac.id,
          },
        });
      }

      return fac;
    });

    return this.formatFacility(updated);
  }

  async verifyFacilityLegal(
    actor: AuthenticatedUser,
    facilityId: string,
    dto: VerifyFacilityLegalDto,
    ip: string,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền thẩm định pháp lý cơ sở y tế',
      );
    }

    if (!dto.approved && (!dto.rejectionReason || !dto.rejectionReason.trim())) {
      throw new BadRequestException(
        'Vui lòng cung cấp lý do từ chối hồ sơ pháp lý (rejectionReason)',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { id: facilityId },
      include: { user: true },
    });

    if (!facility) {
      throw new NotFoundException('Không tìm thấy thông tin cơ sở y tế');
    }

    if (
      facility.licenseNumber.startsWith('PENDING_') ||
      facility.taxCode.startsWith('PENDING_') ||
      facility.bankName === 'CHƯA_CẬP_NHẬT'
    ) {
      throw new BadRequestException(
        'Cơ sở y tế chưa nộp hồ sơ pháp lý chuyên sâu (GPHĐ, MST, Ngân hàng) để thẩm định',
      );
    }

    if (
      dto.approved &&
      (!facility.legalDocumentKey || !facility.businessLicenseKey)
    ) {
      throw new BadRequestException(
        'Cơ sở y tế chưa nộp đủ 2 tài liệu scan bắt buộc (GPHĐ KBCB và Giấy chứng nhận ĐKKD) để phê duyệt ACTIVE',
      );
    }

    if (facility.verificationStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Cơ sở y tế đã ở trạng thái ACTIVE, không cần thẩm định lại',
      );
    }
    if (facility.user?.status !== 'ACTIVE' || facility.legalRejectionReason) {
      throw new ConflictException(
        'CSYT cần có tài khoản đang hoạt động và hồ sơ mới chờ hậu kiểm.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        const fac = await tx.healthcareFacility.update({
          where: { id: facilityId, updatedAt: facility.updatedAt },
          data: {
            verificationStatus: 'ACTIVE',
            legalRejectionReason: null,
            updatedAt: new Date(),
          },
          include: { user: true },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'FACILITY_LEGAL_VERIFIED',
            resourceName: 'HealthcareFacility',
            resourceId: facilityId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: facility.userId,
            title: 'Hồ sơ pháp lý cơ sở y tế đã được Quản trị viên phê duyệt',
            content: `Chúc mừng! Cơ sở y tế ${fac.facilityName} đã hoàn tất thẩm định pháp lý (ACTIVE). Quý cơ sở hiện đã đủ điều kiện ký hợp đồng cung ứng nhân lực và tiếp nhận bác sĩ gia đình.`,
            type: 'FACILITY_LEGAL_VERIFIED',
            referenceId: fac.id,
          },
        });

        if (this.mailerService?.sendMail && facility.user?.email) {
          try {
            await this.mailerService.sendMail({
              to: facility.user.email,
              ...buildFacilityLegalApprovedEmail({
                recipientName: facility.user.fullName,
                facilityName: facility.facilityName,
                loginUrl: resolveAppPublicUrl('/login'),
              }),
            });
          } catch {
            // Silently ignore mail errors in dev
          }
        }

        return fac;
      } else {
        const reason = dto.rejectionReason!.trim();
        const fac = await tx.healthcareFacility.update({
          where: { id: facilityId, updatedAt: facility.updatedAt },
          data: { legalRejectionReason: reason, updatedAt: new Date() },
          include: { user: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'FACILITY_LEGAL_REJECTED',
            resourceName: 'HealthcareFacility',
            resourceId: facilityId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
            details: { reason },
          },
        });

        await tx.notification.create({
          data: {
            userId: facility.userId,
            title: 'Hồ sơ pháp lý cơ sở y tế cần bổ sung / chỉnh sửa',
            content: `Quản trị viên đã từ chối hồ sơ pháp lý của bạn. Lý do: ${reason}. Vui lòng cập nhật và nộp lại.`,
            type: 'FACILITY_LEGAL_REJECTED',
            referenceId: facility.id,
          },
        });

        if (this.mailerService?.sendMail && facility.user?.email) {
          try {
            await this.mailerService.sendMail({
              to: facility.user.email,
              ...buildFacilityLegalRejectedEmail({
                recipientName: facility.user.fullName,
                facilityName: facility.facilityName,
                reason,
                loginUrl: resolveAppPublicUrl('/login'),
              }),
            });
          } catch {
            // Silently ignore mail errors in dev
          }
        }

        return fac;
      }
    });

    return this.formatFacility(updated!);
  }

  async getMyFacility(actor: AuthenticatedUser): Promise<FacilityResponseDto> {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ tài khoản Cơ sở y tế mới có quyền xem thông tin cơ sở của mình',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
      include: { user: true },
    });

    if (!facility) {
      throw new NotFoundException(
        'Không tìm thấy thông tin cơ sở y tế liên kết với tài khoản này',
      );
    }

    const today = todayInVietnam();
    const [activeStaffing, historicalStaffing] = await Promise.all([
      this.prisma.b2bStaffingContract?.findFirst({
        where: {
          facilityId: facility.id,
          status: 'ACTIVE',
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { id: true },
      }) ?? Promise.resolve(null),
      this.prisma.b2bStaffingContract?.findFirst({
        where: {
          facilityId: facility.id,
          status: { in: ['ACTIVE', 'EXPIRED', 'TERMINATED'] },
        },
        select: { id: true },
      }) ?? Promise.resolve(null),
    ]);

    return this.formatFacility(facility, {
      hasActiveStaffingContract: Boolean(activeStaffing),
      hasHistoricalStaffingContract: Boolean(activeStaffing || historicalStaffing),
    });
  }

  async getFacilityLegalDocument(
    facilityId: string,
    actor?: AuthenticatedUser,
    docType: FacilityLegalDocumentType = 'operating',
  ) {
    const facility =
      facilityId === 'me' && actor
        ? await this.prisma.healthcareFacility.findUnique({
            where: { userId: actor.id },
            select: {
              id: true,
              userId: true,
              legalDocumentKey: true,
              businessLicenseKey: true,
            },
          })
        : await this.prisma.healthcareFacility.findUnique({
            where: { id: facilityId },
            select: {
              id: true,
              userId: true,
              legalDocumentKey: true,
              businessLicenseKey: true,
            },
          });

    if (actor) {
      if (actor.role === 'HEALTHCARE_FACILITY') {
        if (!facility || facility.userId !== actor.id) {
          throw new ForbiddenException(
            'Bạn không có quyền truy cập bản scan hồ sơ pháp lý của cơ sở y tế khác.',
          );
        }
      } else if (actor.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập hồ sơ pháp lý cơ sở y tế.',
        );
      }
    }

    const targetKey =
      docType === 'business'
        ? facility?.businessLicenseKey
        : facility?.legalDocumentKey;

    if (!targetKey) {
      throw new NotFoundException(
        docType === 'business'
          ? 'CSYT chưa có bản scan Giấy chứng nhận Đăng ký doanh nghiệp.'
          : 'CSYT chưa có bản scan Giấy phép hoạt động KBCB.',
      );
    }
    if (!this.storage) {
      throw new ServiceUnavailableException('Kho lưu trữ chưa sẵn sàng.');
    }
    return this.storage.downloadFile(targetKey);
  }

  async listFacilitiesForAdmin(
    actor: AuthenticatedUser,
    query?: { status?: string; page?: number; limit?: number },
  ): Promise<{ items: FacilityResponseDto[]; total: number }> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên mới có quyền xem danh sách CSYT');
    }

    const page = Math.max(1, query?.page || 1);
    const limit = Math.min(50, Math.max(1, query?.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) {
      where.verificationStatus = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.healthcareFacility.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      }),
      this.prisma.healthcareFacility.count({ where }),
    ]);

    return {
      items: items.map((f) => this.formatFacility(f)),
      total,
    };
  }

  async getFacilityDetailForAdmin(
    actor: AuthenticatedUser,
    facilityId: string,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản trị viên mới có quyền xem chi tiết CSYT');
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { id: facilityId },
      include: { user: true },
    });

    if (!facility) {
      throw new NotFoundException('Không tìm thấy thông tin cơ sở y tế');
    }

    return this.formatFacility(facility);
  }

  private formatFacility(
    facility: any,
    staffingFlags?: {
      hasActiveStaffingContract: boolean;
      hasHistoricalStaffingContract: boolean;
    },
  ): FacilityResponseDto {
    return {
      id: facility.id,
      userId: facility.userId,
      facilityName: facility.facilityName,
      licenseNumber: facility.licenseNumber,
      taxCode: facility.taxCode,
      address: facility.address,
      hotline: facility.hotline,
      bankName: facility.bankName,
      bankBin: facility.bankBin ?? null,
      bankCode: facility.bankCode ?? null,
      bankAccountNumber: facility.bankAccountNumber,
      bankAccountHolder: facility.bankAccountHolder,
      verificationStatus: facility.verificationStatus,
      legalDocumentsUrl: facility.legalDocumentsUrl ?? null,
      hasLegalDocument: Boolean(facility.legalDocumentKey),
      hasOperatingLicense: Boolean(facility.legalDocumentKey),
      hasBusinessLicense: Boolean(facility.businessLicenseKey),
      licenseIssuer: facility.licenseIssuer ?? null,
      licenseDate: facility.licenseDate ?? null,
      legalRejectionReason: facility.legalRejectionReason ?? null,
      ...(staffingFlags
        ? {
            hasActiveStaffingContract: staffingFlags.hasActiveStaffingContract,
            hasHistoricalStaffingContract:
              staffingFlags.hasHistoricalStaffingContract,
          }
        : {}),
      createdAt: facility.createdAt,
      updatedAt: facility.updatedAt,
      ...(facility.user
        ? {
            user: {
              id: facility.user.id,
              email: facility.user.email,
              phone: facility.user.phone,
              fullName: facility.user.fullName,
              role: facility.user.role,
              status: facility.user.status,
            },
          }
        : {}),
    };
  }
}
