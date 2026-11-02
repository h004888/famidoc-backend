import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

@Injectable()
export class DoctorsServiceImpl implements IDoctorsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.formatDoctor(result);
  }

  async submitDoctorCredentials(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: SubmitDoctorCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy thông tin bác sĩ');
    }

    if (actor.role === 'DOCTOR' && doctor.userId !== actor.id) {
      throw new ForbiddenException(
        'Bạn không có quyền nộp chứng chỉ cho bác sĩ khác',
      );
    }

    const updatedDoctor = await this.prisma.$transaction(async (tx) => {
      await tx.doctorCredential.deleteMany({
        where: { doctorId },
      });

      await tx.doctorCredential.createMany({
        data: dto.credentials.map((c) => ({
          doctorId,
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
        where: { id: doctorId },
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
          resourceId: doctorId,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

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
    } else if (
      actor.role !== 'HEALTHCARE_FACILITY' &&
      actor.role !== 'ADMIN'
    ) {
      throw new ForbiddenException('Bạn không có quyền thẩm định hồ sơ bác sĩ');
    }

    if (dto.approved && (!doctor.credentials || doctor.credentials.length === 0)) {
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
}
