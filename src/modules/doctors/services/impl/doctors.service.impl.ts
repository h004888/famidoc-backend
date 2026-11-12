import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../../../../core/database/prisma.service';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { IDoctorsService } from '../interfaces/doctors.service.interface';
import type { ProvisionDoctorDto } from '../../dtos/provision-doctor.dto';
import type { SubmitDoctorCredentialsDto } from '../../dtos/submit-credentials.dto';
import type {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../../dtos/verify-credentials.dto';
import type { DoctorResponseDto } from '../../dtos/doctor-response.dto';
import type { RegisterFacilityDto } from '../../dtos/register-facility.dto';
import type { ApproveFacilityAccountDto } from '../../dtos/approve-facility-account.dto';
import type { SubmitFacilityLegalProfileDto } from '../../dtos/submit-facility-legal-profile.dto';
import type { VerifyFacilityLegalDto } from '../../dtos/verify-facility-legal.dto';
import type { FacilityResponseDto } from '../../dtos/facility-response.dto';

@Injectable()
export class DoctorsServiceImpl implements IDoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject('MAILER_SERVICE')
    private readonly mailerService?: any,
  ) {}

  async provisionDoctorAccount(
    actor: AuthenticatedUser,
    dto: ProvisionDoctorDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    let targetFacilityId: string;

    if (actor.role === 'ADMIN') {
      if (!dto.facilityId) {
        throw new BadRequestException(
          'Vui lòng chỉ định cơ sở y tế trực thuộc (facilityId)',
        );
      }
      const facility = await this.prisma.healthcareFacility.findUnique({
        where: { id: dto.facilityId },
      });
      if (!facility || facility.verificationStatus !== 'ACTIVE') {
        throw new BadRequestException(
          'Cơ sở y tế không tồn tại hoặc chưa được kích hoạt hoạt động',
        );
      }
      targetFacilityId = facility.id;
    } else if (actor.role === 'HEALTHCARE_FACILITY') {
      const facility = await this.prisma.healthcareFacility.findUnique({
        where: { userId: actor.id },
      });
      if (!facility || facility.verificationStatus !== 'ACTIVE') {
        throw new BadRequestException(
          'Tài khoản của bạn chưa liên kết với cơ sở y tế hợp lệ',
        );
      }
      targetFacilityId = facility.id;
    } else {
      throw new ForbiddenException(
        'Chỉ Quản trị viên hoặc Cơ sở y tế mới có quyền tạo tài khoản bác sĩ',
      );
    }

    const activeContract = await this.prisma.b2bStaffingContract.findFirst({
      where: {
        facilityId: targetFacilityId,
        status: 'ACTIVE',
        endDate: { gte: new Date() },
      },
    });

    if (!activeContract) {
      throw new BadRequestException(
        'Cơ sở y tế chưa có hợp đồng nhân lực B2B đang có hiệu lực',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { phone: dto.phone }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'Email hoặc số điện thoại của bác sĩ đã tồn tại trên hệ thống',
      );
    }

    const defaultPasswordHash = hashSync('FamiDoc@2026', 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          fullName: dto.doctorName,
          passwordHash: defaultPasswordHash,
          role: 'DOCTOR',
          status: 'ACTIVE',
        },
      });

      const doctor = await tx.doctor.create({
        data: {
          userId: newUser.id,
          facilityId: targetFacilityId,
          doctorName: dto.doctorName,
          specialty: dto.specialty || 'Y học gia đình',
          academicTitle: dto.academicTitle || null,
          experienceYears: dto.experienceYears,
          bio: dto.bio || null,
          onboardingStatus: 'PENDING_SUBMISSION',
        },
        include: {
          facility: true,
          credentials: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'DOCTOR_ACCOUNT_PROVISIONED',
          resourceName: 'Doctor',
          resourceId: doctor.id,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      return doctor;
    });

    if (this.mailerService?.sendMail) {
      try {
        await this.mailerService.sendMail({
          to: dto.email,
          subject: 'Thư mời kích hoạt tài khoản Bác sĩ gia đình - FamiDoc',
          text: `Kính gửi Bác sĩ ${dto.doctorName},\n\nTài khoản của bạn tại hệ thống FamiDoc đã được tạo thành công bởi cơ sở y tế. Vui lòng đăng nhập với mật khẩu mặc định 'FamiDoc@2026' và hoàn thiện hồ sơ chứng chỉ hành nghề để được phê duyệt.\n\nTrân trọng,\nĐội ngũ FamiDoc`,
        });
      } catch {
        // Continue even if mail fails
      }
    }

    return this.formatDoctor(result);
  }

  async submitDoctorCredentials(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: SubmitDoctorCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    const doctor =
      doctorId === 'me'
        ? await this.prisma.doctor.findFirst({
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

    for (const c of dto.credentials) {
      const issueDate = new Date(c.issueDate);
      if (isNaN(issueDate.getTime())) {
        throw new BadRequestException(
          `Ngày cấp chứng chỉ ${c.certificateNumber} không hợp lệ`,
        );
      }
      if (issueDate > new Date()) {
        throw new BadRequestException(
          `Ngày cấp chứng chỉ ${c.certificateNumber} không được ở tương lai`,
        );
      }
    }

    const updatedDoctor = await this.prisma.$transaction(async (tx) => {
      await tx.doctorCredential.deleteMany({
        where: { doctorId: actualDoctorId },
      });

      await tx.doctorCredential.createMany({
        data: dto.credentials.map((c) => ({
          doctorId: actualDoctorId,
          credentialType: c.credentialType,
          certificateNumber: c.certificateNumber,
          issueDate: new Date(c.issueDate),
          issuingAuthority: c.issuingAuthority,
          fileUrl: c.fileUrl,
          facilityVerified: false,
          platformApproved: false,
        })),
      });

      const updated = await tx.doctor.update({
        where: { id: actualDoctorId },
        data: {
          onboardingStatus: 'PENDING_SUBMISSION',
          updatedAt: new Date(),
        },
        include: {
          facility: true,
          credentials: true,
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
            content: `Bác sĩ ${doctor.doctorName} đã nộp hồ sơ chứng chỉ hành nghề, đang chờ cơ sở y tế thẩm định Cấp 1.`,
            type: 'DOCTOR_CREDENTIALS_SUBMITTED',
            referenceId: actualDoctorId,
          },
        });
      }

      return updated;
    });

    return this.formatDoctor(updatedDoctor);
  }

  async approveDoctorCredentialsByFacility(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: FacilityVerifyCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { facility: true, credentials: true },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (
      actor.role === 'HEALTHCARE_FACILITY' &&
      doctor.facility.userId !== actor.id
    ) {
      throw new ForbiddenException(
        'Chỉ cơ sở y tế quản lý trực tiếp bác sĩ này mới có quyền thẩm định cấp 1',
      );
    } else if (actor.role !== 'HEALTHCARE_FACILITY' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền thẩm định hồ sơ bác sĩ');
    }

    if (doctor.onboardingStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Bác sĩ đã ở trạng thái ACTIVE, không cần thẩm định lại',
      );
    }

    if (
      dto.approved &&
      (!doctor.credentials || doctor.credentials.length === 0)
    ) {
      throw new BadRequestException(
        'Bác sĩ chưa nộp văn bằng chứng chỉ chuyên môn để thẩm định',
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
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true },
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
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            facilityVerified: false,
            rejectionReason:
              dto.rejectionReason || 'Cơ sở y tế từ chối thẩm định',
          },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'PENDING_SUBMISSION',
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true },
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
      include: { facility: true, credentials: true },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (doctor.onboardingStatus !== 'FACILITY_VERIFIED') {
      throw new BadRequestException(
        'Hồ sơ bác sĩ phải được Cơ sở y tế thẩm định cấp 1 (FACILITY_VERIFIED) trước khi Quản trị viên duyệt kích hoạt',
      );
    }

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
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true },
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
              'Hồ sơ văn bằng và chứng chỉ hành nghề của bạn đã được Quản trị viên FamiDoc phê duyệt cấp 2. Tài khoản của bạn hiện đã được kích hoạt (ACTIVE).',
            type: 'DOCTOR_PLATFORM_APPROVED',
            referenceId: doctor.id,
          },
        });

        if (this.mailerService?.sendMail) {
          const docUser = await tx.user.findUnique({
            where: { id: doctor.userId },
          });
          if (docUser?.email) {
            try {
              await this.mailerService.sendMail({
                to: docUser.email,
                subject:
                  'Hồ sơ bác sĩ của bạn đã được phê duyệt thành công - FamiDoc',
                text: `Kính gửi Bác sĩ ${doctor.doctorName},\n\nHồ sơ văn bằng và chứng chỉ hành nghề của bạn đã được Quản trị viên FamiDoc phê duyệt cấp 2. Tài khoản của bạn đã chuyển sang trạng thái ACTIVE.\n\nTrân trọng,\nĐội ngũ FamiDoc`,
              });
            } catch {
              // Silently ignore mail errors in dev
            }
          }
        }

        return doc;
      } else {
        await tx.doctorCredential.updateMany({
          where: { doctorId },
          data: {
            platformApproved: false,
            rejectionReason:
              dto.rejectionReason || 'Quản trị viên từ chối phê duyệt cấp 2',
          },
        });

        const doc = await tx.doctor.update({
          where: { id: doctorId },
          data: {
            onboardingStatus: 'PENDING_SUBMISSION',
            updatedAt: new Date(),
          },
          include: { facility: true, credentials: true },
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
            content: `Quản trị viên đã từ chối phê duyệt hồ sơ chuyên môn của bạn. Lý do: ${dto.rejectionReason || 'Không đạt yêu cầu pháp lý'}. Vui lòng kiểm tra và bổ sung lại.`,
            type: 'DOCTOR_PLATFORM_REJECTED',
            referenceId: doctor.id,
          },
        });

        return doc;
      }
    });

    return this.formatDoctor(updated);
  }

  async getDoctorProfile(
    actor: AuthenticatedUser,
    doctorId: string,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { facility: true, credentials: true },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    return this.formatDoctor(doctor);
  }

  private formatDoctor(doctor: any): DoctorResponseDto {
    return {
      id: doctor.id,
      userId: doctor.userId,
      facilityId: doctor.facilityId,
      doctorName: doctor.doctorName,
      specialty: doctor.specialty,
      academicTitle: doctor.academicTitle,
      experienceYears: doctor.experienceYears,
      bio: doctor.bio,
      activePanelCount: doctor.activePanelCount,
      maxPanelCapacity: doctor.maxPanelCapacity,
      ratingAvg: Number(doctor.ratingAvg),
      totalReviews: doctor.totalReviews,
      onboardingStatus: doctor.onboardingStatus,
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
    };
  }

  // ==========================================
  // FACILITY ONBOARDING METHODS (2 STAGES)
  // ==========================================

  async registerFacility(
    dto: RegisterFacilityDto,
    ip: string,
  ): Promise<FacilityResponseDto> {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email.trim().toLowerCase() }, { phone: dto.phone.trim() }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'Email hoặc số điện thoại của người đại diện đã tồn tại trên hệ thống',
      );
    }

    const existingFacility = await this.prisma.healthcareFacility.findFirst({
      where: { facilityName: dto.facilityName.trim() },
    });

    if (existingFacility) {
      throw new ConflictException(
        'Tên cơ sở y tế này đã được đăng ký trên hệ thống',
      );
    }

    const tempPasswordHash = hashSync(randomUUID(), 10);
    const randomSuffix = randomUUID().substring(0, 8).toUpperCase();

    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          phone: dto.phone.trim(),
          fullName: dto.representativeName.trim(),
          passwordHash: tempPasswordHash,
          role: 'HEALTHCARE_FACILITY',
          status: 'PENDING',
        },
      });

      const facility = await tx.healthcareFacility.create({
        data: {
          userId: newUser.id,
          facilityName: dto.facilityName.trim(),
          address: dto.address.trim(),
          hotline: dto.phone.trim(),
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
          actorUserId: newUser.id,
          action: 'FACILITY_REGISTRATION_SUBMITTED',
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
            title: 'Đăng ký cơ sở y tế mới chờ duyệt cấp tài khoản',
            content: `Cơ sở y tế ${dto.facilityName} đã gửi đăng ký đối tác (Người đại diện: ${dto.representativeName}). Vui lòng kiểm tra và duyệt cấp tài khoản.`,
            type: 'FACILITY_REGISTRATION_SUBMITTED',
            referenceId: facility.id,
          },
        });
      }

      return facility;
    });

    return this.formatFacility(created);
  }

  async approveFacilityAccount(
    actor: AuthenticatedUser,
    facilityId: string,
    dto: ApproveFacilityAccountDto,
    ip: string,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền duyệt cấp tài khoản cơ sở y tế',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { id: facilityId },
      include: { user: true },
    });

    if (!facility) {
      throw new NotFoundException('Không tìm thấy thông tin cơ sở y tế');
    }

    if (facility.user.status === 'ACTIVE') {
      throw new BadRequestException(
        'Tài khoản cơ sở y tế này đã được kích hoạt trước đó',
      );
    }

    const defaultInitialPassword = 'FamiDoc@Facility2026';
    const passwordHash = hashSync(defaultInitialPassword, 10);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        await tx.user.update({
          where: { id: facility.userId },
          data: {
            passwordHash,
            status: 'ACTIVE',
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'FACILITY_ACCOUNT_APPROVED',
            resourceName: 'HealthcareFacility',
            resourceId: facilityId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: facility.userId,
            title: 'Tài khoản cơ sở y tế đã được Quản trị viên phê duyệt',
            content: `Tài khoản của bạn đã được phê duyệt cấp 1 thành công. Vui lòng đăng nhập với mật khẩu khởi tạo được cấp trong email để hoàn thiện hồ sơ pháp lý.`,
            type: 'FACILITY_ACCOUNT_APPROVED',
            referenceId: facility.id,
          },
        });

        if (this.mailerService?.sendMail && facility.user?.email) {
          try {
            await this.mailerService.sendMail({
              to: facility.user.email,
              subject: 'Thông báo phê duyệt cấp tài khoản Cơ sở y tế - FamiDoc',
              text: `Kính gửi ${facility.user.fullName || facility.facilityName},\n\nHồ sơ đăng ký tài khoản ban đầu của quý cơ sở đã được Quản trị viên FamiDoc phê duyệt thành công.\n\nThông tin đăng nhập:\n- Email: ${facility.user.email}\n- Mật khẩu khởi tạo: ${defaultInitialPassword}\n\nVui lòng đăng nhập vào hệ thống để tải lên các tài liệu pháp lý chuyên sâu (Giấy phép hoạt động, Mã số thuế, Thông tin ngân hàng) để hoàn tất kích hoạt đối tác.\n\nTrân trọng,\nĐội ngũ FamiDoc`,
            });
          } catch {
            // Silently ignore mail errors in dev
          }
        }
      } else {
        await tx.user.update({
          where: { id: facility.userId },
          data: { status: 'SUSPENDED' },
        });

        await tx.healthcareFacility.update({
          where: { id: facilityId },
          data: { verificationStatus: 'SUSPENDED' },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'FACILITY_ACCOUNT_REJECTED',
            resourceName: 'HealthcareFacility',
            resourceId: facilityId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        if (this.mailerService?.sendMail && facility.user?.email) {
          try {
            await this.mailerService.sendMail({
              to: facility.user.email,
              subject: 'Thông báo từ chối cấp tài khoản Cơ sở y tế - FamiDoc',
              text: `Kính gửi đại diện ${facility.facilityName},\n\nĐề xuất đăng ký tài khoản của quý cơ sở đã bị từ chối.\nLý do: ${dto.rejectionReason || 'Thông tin không hợp lệ hoặc cơ sở không tồn tại'}.\n\nTrân trọng,\nĐội ngũ FamiDoc`,
            });
          } catch {
            // Silently ignore mail errors in dev
          }
        }
      }

      return tx.healthcareFacility.findUnique({
        where: { id: facilityId },
        include: { user: true },
      });
    });

    return this.formatFacility(updated!);
  }

  async submitFacilityLegalProfile(
    actor: AuthenticatedUser,
    dto: SubmitFacilityLegalProfileDto,
    ip: string,
  ): Promise<FacilityResponseDto> {
    if (actor.role !== 'HEALTHCARE_FACILITY' && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế hoặc Quản trị viên mới có quyền cập nhật hồ sơ pháp lý',
      );
    }

    let facility = await this.prisma.healthcareFacility.findUnique({
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const fac = await tx.healthcareFacility.update({
        where: { id: facility.id },
        data: {
          licenseNumber: dto.licenseNumber.trim(),
          taxCode: dto.taxCode.trim(),
          hotline: dto.hotline.trim(),
          bankName: dto.bankName.trim(),
          bankAccountNumber: dto.bankAccountNumber.trim(),
          bankAccountHolder: dto.bankAccountHolder.trim(),
          facilityName: dto.facilityName?.trim() || facility.facilityName,
          address: dto.address?.trim() || facility.address,
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
            title: 'Hồ sơ pháp lý cơ sở y tế chờ thẩm định Cấp 2',
            content: `Cơ sở y tế ${fac.facilityName} (GPHĐ: ${dto.licenseNumber}) đã nộp hồ sơ pháp lý và tài khoản ngân hàng. Vui lòng hậu kiểm pháp lý.`,
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

    if (facility.verificationStatus === 'ACTIVE') {
      throw new BadRequestException(
        'Cơ sở y tế đã ở trạng thái ACTIVE, không cần thẩm định lại',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approved) {
        const fac = await tx.healthcareFacility.update({
          where: { id: facilityId },
          data: {
            verificationStatus: 'ACTIVE',
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
              subject:
                'Chúc mừng! Hồ sơ pháp lý cơ sở y tế đã được kích hoạt thành công - FamiDoc',
              text: `Kính gửi ${facility.user.fullName || facility.facilityName},\n\nHồ sơ pháp lý và tài khoản ngân hàng của quý cơ sở đã được Quản trị viên FamiDoc thẩm định và kích hoạt thành công (ACTIVE).\n\nQuý cơ sở hiện đã có thể bắt đầu quá trình ký hợp đồng cung ứng nhân lực B2B và khởi tạo danh sách bác sĩ trực thuộc.\n\nTrân trọng,\nĐội ngũ FamiDoc`,
            });
          } catch {
            // Silently ignore mail errors in dev
          }
        }

        return fac;
      } else {
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'FACILITY_LEGAL_REJECTED',
            resourceName: 'HealthcareFacility',
            resourceId: facilityId,
            clientIp: ip || '127.0.0.1',
            timestamp: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: facility.userId,
            title: 'Hồ sơ pháp lý cơ sở y tế bị từ chối thẩm định',
            content: `Quản trị viên đã từ chối hồ sơ pháp lý của bạn. Lý do: ${dto.rejectionReason || 'Thông tin giấy phép hoặc mã số thuế không hợp lệ'}. Vui lòng cập nhật lại.`,
            type: 'FACILITY_LEGAL_REJECTED',
            referenceId: facility.id,
          },
        });

        return tx.healthcareFacility.findUnique({
          where: { id: facilityId },
          include: { user: true },
        });
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

    return this.formatFacility(facility);
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

  private formatFacility(facility: any): FacilityResponseDto {
    return {
      id: facility.id,
      userId: facility.userId,
      facilityName: facility.facilityName,
      licenseNumber: facility.licenseNumber,
      taxCode: facility.taxCode,
      address: facility.address,
      hotline: facility.hotline,
      bankName: facility.bankName,
      bankAccountNumber: facility.bankAccountNumber,
      bankAccountHolder: facility.bankAccountHolder,
      verificationStatus: facility.verificationStatus,
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
