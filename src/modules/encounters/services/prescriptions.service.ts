import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { writeBusinessAudit } from '../../../core/business/business-helpers';
import { PrismaService } from '../../../core/database/prisma.service';
import { serializable } from '../../../core/database/prisma-transaction';
import type {
  ConfirmVisitRecordDto,
  FamilyPrescriptionQuery,
  PrescriptionInputDto,
  SharePrescriptionDto,
} from '../dtos/share-prescription.dto';

const PAGE_SIZE = 12;
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;

const visitSelect = {
  id: true,
  encounterType: true,
  scheduledDate: true,
  scheduledTime: true,
  participants: {
    select: {
      patient: { select: { id: true, fullName: true, familyId: true } },
    },
  },
  contract: {
    select: {
      familyId: true,
      familyUnit: {
        select: {
          representativeUser: {
            select: { id: true, fullName: true, role: true, status: true },
          },
        },
      },
    },
  },
  clinicalEmrs: {
    select: {
      id: true,
      patientId: true,
      isFinalized: true,
      icd10Code: true,
      icd10Diagnosis: true,
      patient: { select: { id: true, fullName: true, familyId: true } },
      prescriptions: {
        select: { id: true, prescriptionCode: true, recipientUserId: true },
        take: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      },
    },
  },
} satisfies Prisma.EncounterSelect;

const prescriptionSelect = {
  id: true,
  prescriptionCode: true,
  createdAt: true,
  prescribedDate: true,
  doctorSignature: true,
  status: true,
  clinicalEmr: {
    select: {
      icd10Diagnosis: true,
      patient: { select: { id: true, fullName: true } },
      encounter: {
        select: {
          doctor: {
            select: {
              doctorName: true,
              facility: { select: { facilityName: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PrescriptionSelect;

type PrescriptionSummary = Prisma.PrescriptionGetPayload<{
  select: typeof prescriptionSelect;
}>;

function summary(record: PrescriptionSummary) {
  const { patient, encounter } = record.clinicalEmr;
  const { doctor } = encounter;
  return {
    id: record.id,
    prescriptionCode: record.prescriptionCode,
    prescribedDate: record.prescribedDate,
    createdAt: record.createdAt,
    status: record.status,
    patient,
    doctorName: doctor.doctorName,
    facilityName: doctor.facility.facilityName,
    diagnosis: record.clinicalEmr.icd10Diagnosis,
    hasSignature: Boolean(record.doctorSignature),
  };
}

export function activePrescribingDoctor(
  userId: string,
): Prisma.DoctorWhereInput {
  return {
    userId,
    onboardingStatus: 'ACTIVE',
    facility: { verificationStatus: 'ACTIVE' },
  };
}

export function doctorVisitScope(
  userId: string,
  now = new Date(Date.now() + VIETNAM_TIME_OFFSET_MS),
): Prisma.EncounterWhereInput {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const time = new Date(`1970-01-01T${now.toISOString().slice(11)}`);
  return {
    doctor: activePrescribingDoctor(userId),
    OR: [
      { encounterStatus: { in: ['IN_PROGRESS', 'COMPLETED'] } },
      {
        encounterStatus: 'CONFIRMED',
        OR: [
          { scheduledDate: { lt: today } },
          { scheduledDate: today, scheduledTime: { lte: time } },
        ],
      },
    ],
  };
}

function familyPrescriptionScope(
  actor: AuthenticatedUser,
): Prisma.PrescriptionWhereInput {
  if (!actor.familyUnitId)
    throw new NotFoundException('Không tìm thấy hồ sơ gia đình.');
  return {
    recipientUserId: actor.id,
    clinicalEmr: {
      patient: { familyId: actor.familyUnitId },
      encounter: {
        contract: {
          familyId: actor.familyUnitId,
          familyUnit: { representativeUserId: actor.id },
        },
      },
    },
  };
}

@Injectable()
export class PrescriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async doctorVisits(actor: AuthenticatedUser, page: number) {
    const visits = await this.prisma.encounter.findMany({
      where: doctorVisitScope(
        actor.id,
        new Date(Date.now() + VIETNAM_TIME_OFFSET_MS),
      ),
      select: visitSelect,
      orderBy: [
        { scheduledDate: 'desc' },
        { scheduledTime: 'desc' },
        { id: 'desc' },
      ],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    return {
      items: visits
        .slice(0, PAGE_SIZE)
        .map(({ participants, contract, clinicalEmrs, ...visit }) => {
          const recipient = contract.familyUnit.representativeUser;
          const clinicalEmr = clinicalEmrs[0];
          const patient = clinicalEmr?.patient ?? participants[0]?.patient ?? null;
          const record = clinicalEmr?.prescriptions[0];
          return {
            ...visit,
            patient: patient ? { id: patient.id, fullName: patient.fullName } : null,
            recipient:
              (!patient || patient.familyId === contract.familyId) &&
              recipient.role === 'FAMILY_REP' &&
              recipient.status === 'ACTIVE'
                ? { id: recipient.id, name: recipient.fullName }
                : null,
            diagnosis: clinicalEmr
              ? {
                  code: clinicalEmr.icd10Code,
                  name: clinicalEmr.icd10Diagnosis,
                }
              : null,
            prescription: record
              ? {
                  id: record.id,
                  prescriptionCode: record.prescriptionCode,
                  shared: Boolean(record.recipientUserId),
                }
              : null,
          };
        }),
      hasNextPage: visits.length > PAGE_SIZE,
    };
  }

  async share(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: SharePrescriptionDto,
  ) {
    if (dto.recipientAuthorized !== true) {
      throw new BadRequestException(
        'Cần xác nhận người nhận có quyền nhận đơn thuốc.',
      );
    }

    const now = new Date(Date.now() + VIETNAM_TIME_OFFSET_MS);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const visit = await tx.encounter.findFirst({
            where: { id: encounterId, ...doctorVisitScope(actor.id, now) },
            select: visitSelect,
          });
          if (!visit)
            throw new NotFoundException(
              'Không tìm thấy buổi khám đủ điều kiện kê đơn.',
            );
          const targetPatientId =
            (dto as { patientId?: string }).patientId ??
            visit.participants[0]?.patient.id;
          if (!targetPatientId) {
            throw new BadRequestException(
              'Vui lòng chọn thành viên được khám để kê đơn.',
            );
          }
          const existingEmr = visit.clinicalEmrs.find(
            (e) => e.patientId === targetPatientId,
          );
          if (existingEmr?.isFinalized) {
            throw new ConflictException('Trang khám đã được xác nhận.');
          }
          if (existingEmr?.prescriptions.length) {
            throw new ConflictException('Buổi khám này đã có đơn thuốc.');
          }
          let emrId = existingEmr?.id;
          if (!emrId) {
            if (!dto.exam)
              throw new BadRequestException(
                'Vui lòng nhập thông tin khám trước khi gửi đơn.',
              );
            const emr = await tx.clinicalEmr.create({
              data: {
                encounterId,
                patientId: targetPatientId,
                chiefComplaint: dto.exam.chiefComplaint,
                clinicalFindings: dto.exam.clinicalFindings,
                icd10Code: dto.exam.icd10Code,
                icd10Diagnosis: dto.exam.icd10Diagnosis,
                treatmentPlan: dto.exam.treatmentPlan,
              },
              select: { id: true },
            });
            emrId = emr.id;
          }
          return this.createSharedPrescription(
            tx,
            actor.id,
            visit,
            emrId,
            dto,
            now,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        throw new ConflictException(
          'Buổi khám vừa được cập nhật. Vui lòng tải lại để kiểm tra đơn thuốc.',
        );
      }
      throw error;
    }
  }

  async confirmVisitRecord(
    actor: AuthenticatedUser,
    id: string,
    dto: ConfirmVisitRecordDto,
  ) {
    if (dto.confirmed !== true) {
      throw new BadRequestException(
        'Vui lòng xác nhận nội dung và người được khám.',
      );
    }
    const now = new Date();
    const vietnamNow = new Date(now.getTime() + VIETNAM_TIME_OFFSET_MS);
    return serializable(this.prisma, async (tx) => {
      const visit = await tx.encounter.findFirst({
        where: {
          id,
          ...doctorVisitScope(actor.id, vietnamNow),
        },
        select: visitSelect,
      });
      if (!visit) {
        throw new NotFoundException(
          'Không tìm thấy buổi khám của thành viên này.',
        );
      }
      const member = await tx.patient.findFirst({
        where: {
          id: dto.patientId,
          familyId: visit.contract.familyId,
        },
        select: { id: true },
      });
      if (!member) {
        throw new NotFoundException(
          'Không tìm thấy buổi khám của thành viên này.',
        );
      }
      const existingEmr = visit.clinicalEmrs.find(
        (e) => e.patientId === dto.patientId,
      );
      if (existingEmr?.isFinalized) {
        throw new ConflictException('Trang khám đã được xác nhận.');
      }
      if (
        existingEmr?.prescriptions.length &&
        (dto.prescription || dto.exam)
      ) {
        throw new ConflictException(
          'Trang khám đã có đơn thuốc. Bạn có thể xác nhận nội dung đã lưu.',
        );
      }
      if (!existingEmr && !dto.exam) {
        throw new BadRequestException(
          'Vui lòng nhập thông tin khám trước khi xác nhận.',
        );
      }

      // Xác nhận nội bộ gắn với tài khoản bác sĩ và thời điểm ghi nhận.
      const confirmation = { isFinalized: true, finalizedAt: now };
      const record = existingEmr
        ? await tx.clinicalEmr.update({
            where: { id: existingEmr.id },
            data: { ...dto.exam, ...confirmation },
            select: { id: true },
          })
        : await tx.clinicalEmr.create({
            data: {
              ...dto.exam!,
              encounterId: id,
              patientId: dto.patientId,
              ...confirmation,
            },
            select: { id: true },
          });
      if (dto.prescription) {
        await this.createSharedPrescription(
          tx,
          actor.id,
          visit,
          record.id,
          dto.prescription,
          vietnamNow,
        );
      }
      await tx.encounter.updateMany({
        where: {
          id,
          encounterStatus: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        },
        data: { encounterStatus: 'COMPLETED' },
      });
      await tx.notification.create({
        data: {
          userId: visit.contract.familyUnit.representativeUser.id,
          type: 'ENCOUNTER_COMPLETED',
          title: 'Buổi khám đã hoàn tất',
          content:
            'Bác sĩ đã hoàn tất ghi nhận bệnh án cho buổi khám. Bạn có thể xem lại sổ khám và gửi đánh giá bác sĩ.',
          referenceId: id,
        },
      });
      await writeBusinessAudit(
        tx,
        actor.id,
        'CONFIRM_VISIT_RECORD',
        'ClinicalEmr',
        record.id,
      );
      return { encounterId: id, finalizedAt: now };
    });
  }

  private async createSharedPrescription(
    tx: Prisma.TransactionClient,
    actorId: string,
    visit: Prisma.EncounterGetPayload<{ select: typeof visitSelect }>,
    emrId: string,
    dto: PrescriptionInputDto,
    vietnamNow: Date,
  ) {
    const recipient = visit.contract.familyUnit.representativeUser;
    if (
      dto.recipientAuthorized !== true ||
      recipient.id !== dto.recipientUserId ||
      recipient.role !== 'FAMILY_REP' ||
      recipient.status !== 'ACTIVE'
    ) {
      throw new ConflictException(
        'Người nhận đã thay đổi hoặc không còn hợp lệ. Vui lòng tải lại buổi khám.',
      );
    }
    const prescription = await tx.prescription.create({
      data: {
        emrId,
        prescriptionCode: `FMD-${emrId}`,
        recipientUserId: recipient.id,
        prescribedDate: new Date(
          `${vietnamNow.toISOString().slice(0, 10)}T00:00:00.000Z`,
        ),
        instructions: dto.instructions || null,
        details: {
          create: dto.details.map((detail, index) => ({
            medicationName: detail.medicationName,
            strength: detail.strength,
            administrationRoute: detail.administrationRoute,
            dosage: detail.dosage,
            frequency: detail.frequency,
            quantity: detail.quantity,
            unit: detail.unit,
            durationDays: detail.durationDays,
            lineNumber: index + 1,
          })),
        },
      },
      select: { id: true, prescriptionCode: true },
    });
    await tx.notification.create({
      data: {
        userId: recipient.id,
        type: 'PRESCRIPTION_SHARED',
        title: 'Bác sĩ đã gửi đơn thuốc',
        content: 'Mở hồ sơ gia đình để xem đơn thuốc và lời dặn của bác sĩ.',
        referenceId: prescription.id,
      },
    });
    await writeBusinessAudit(
      tx,
      actorId,
      'SHARE_PRESCRIPTION_AUTHORIZED_RECIPIENT',
      'Prescription',
      prescription.id,
    );
    return { ...prescription, shared: true };
  }

  async familyList(actor: AuthenticatedUser, query: FamilyPrescriptionQuery) {
    const records = await this.prisma.prescription.findMany({
      where: {
        ...familyPrescriptionScope(actor),
        ...(query.patientId
          ? {
              AND: {
                clinicalEmr: { patientId: query.patientId },
              },
            }
          : {}),
      },
      select: prescriptionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    return {
      items: records.slice(0, PAGE_SIZE).map(summary),
      hasNextPage: records.length > PAGE_SIZE,
    };
  }

  async familyDetail(actor: AuthenticatedUser, id: string) {
    const record = await this.prisma.prescription.findFirst({
      where: { id, ...familyPrescriptionScope(actor) },
      select: {
        ...prescriptionSelect,
        instructions: true,
        details: {
          omit: { prescriptionId: true, lineNumber: true },
          orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!record)
      throw new NotFoundException(
        'Không tìm thấy đơn thuốc được chia sẻ với bạn.',
      );
    return {
      ...summary(record),
      instructions: record.instructions,
      details: record.details,
    };
  }
}
