import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  eligibleForLongTermPrescription,
  patientAgeMonths,
  prescriptionDrugName,
  type PrescriptionSnapshot,
} from '../prescription-rules';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { writeBusinessAudit } from '../../../core/business/business-helpers';
import { PrismaService } from '../../../core/database/prisma.service';
import { serializable } from '../../../core/database/prisma-transaction';
import type {
  ConfirmVisitRecordDto,
  FamilyPrescriptionsDto,
  FamilyPrescriptionQuery,
  PrescriptionInputDto,
  ReplacePrescriptionDto,
  SharePrescriptionDto,
} from '../dtos/share-prescription.dto';

const PAGE_SIZE = 12;
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;

async function prescriptionTransaction<T>(
  prisma: PrismaService,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await serializable(prisma, action);
  } catch (error) {
    if (error instanceof ConflictException && error.message.startsWith('Concurrent'))
      throw new ConflictException(
        'Đơn thuốc vừa được cập nhật. Vui lòng tải lại trước khi thao tác tiếp.',
      );
    throw error;
  }
}

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
  doctor: {
    select: {
      doctorName: true,
      user: { select: { phone: true } },
      facility: { select: { facilityName: true, address: true } },
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
  validUntil: true,
  recordSnapshot: true,
  replacementReason: true,
  cancelledAt: true,
  replaces: { select: { id: true, prescriptionCode: true } },
  replacedBy: { select: { id: true, prescriptionCode: true } },
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
  const snapshot = record.recordSnapshot as PrescriptionSnapshot | null;
  const expired =
    record.validUntil &&
    record.validUntil.toISOString().slice(0, 10) <
      new Date(Date.now() + VIETNAM_TIME_OFFSET_MS).toISOString().slice(0, 10);
  return {
    id: record.id,
    prescriptionCode: record.prescriptionCode,
    prescribedDate: record.prescribedDate,
    createdAt: record.createdAt,
    status: record.status === 'ISSUED' && expired ? 'EXPIRED' : record.status,
    validUntil: record.validUntil,
    recordSnapshot: snapshot,
    replaces: record.replaces,
    replacedBy: record.replacedBy,
    replacementReason: record.replacementReason,
    cancelledAt: record.cancelledAt,
    patient: snapshot
      ? { id: snapshot.patient.id, fullName: snapshot.patient.fullName }
      : patient,
    doctorName: snapshot?.doctorName ?? doctor.doctorName,
    facilityName:
      snapshot?.facility.facilityName ?? doctor.facility.facilityName,
    diagnosis:
      snapshot?.exam.icd10Diagnosis ?? record.clinicalEmr.icd10Diagnosis,
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
          // Chọn đúng người bệnh khi một buổi khám có nhiều thành viên.
          const patientIds = new Set([
            ...visit.participants.map(({ patient }) => patient.id),
            ...visit.clinicalEmrs.map(({ patientId }) => patientId),
          ]);
          const targetPatientId =
            dto.patientId ?? (patientIds.size === 1 ? [...patientIds][0] : undefined);
          if (!targetPatientId || !patientIds.has(targetPatientId)) {
            throw new BadRequestException(
              'Vui lòng chọn thành viên được khám để kê đơn.',
            );
          }
          const existingEmr = visit.clinicalEmrs.find(
            (emr) => emr.patientId === targetPatientId,
          );
          if (existingEmr?.isFinalized && dto.exam) {
            throw new ConflictException(
              'Thông tin khám đã xác nhận được giữ nguyên khi kê đơn.',
            );
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

  async prescribeFamily(
    actor: AuthenticatedUser,
    familyId: string,
    dto: FamilyPrescriptionsDto,
  ) {
    if (actor.role !== 'DOCTOR')
      throw new NotFoundException(
        'Không tìm thấy gia đình trong phạm vi kê đơn.',
      );
    const visitPatients = dto.prescriptions.map(
      (entry) => entry.encounterId + ':' + entry.patientId,
    );
    if (new Set(visitPatients).size !== visitPatients.length)
      throw new BadRequestException('Mỗi thành viên chỉ được chọn một lần trong cùng buổi khám.');
    const now = new Date(Date.now() + VIETNAM_TIME_OFFSET_MS);
    return prescriptionTransaction(this.prisma, async (tx) => {
      const items = [];
      for (const entry of dto.prescriptions) {
        const visit = await tx.encounter.findFirst({
          where: {
            id: entry.encounterId,
            contract: { familyId },
            ...doctorVisitScope(actor.id, now),
          },
          select: visitSelect,
        });
        const emr = visit?.clinicalEmrs.find(
          ({ patientId }) => patientId === entry.patientId,
        );
        const participant = visit?.participants.find(
          ({ patient }) => patient.id === entry.patientId,
        );
        const patient = emr?.patient ?? participant?.patient;
        if (!visit || patient?.familyId !== familyId || visit.contract.familyId !== familyId) {
          throw new NotFoundException(
            'Lần khám không thuộc gia đình hoặc bác sĩ đang kê đơn.',
          );
        }
        if (!emr?.isFinalized)
          throw new ConflictException(
            'Cần xác nhận sổ khám của từng thành viên trước khi gửi đơn gia đình.',
          );
        if (emr.prescriptions.length)
          throw new ConflictException(
            'Một thành viên đã được kê đơn cho lần khám đã chọn. Hãy tải lại danh sách.',
          );
        const prescription = await this.createSharedPrescription(
          tx,
          actor.id,
          visit,
          emr.id,
          entry,
          now,
        );
        items.push({
          ...prescription,
          patientId: entry.patientId,
          encounterId: entry.encounterId,
        });
      }
      return { familyId, items };
    });
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
    return prescriptionTransaction(this.prisma, async (tx) => {
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
    replacement?: { id: string; reason: string },
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
    const { patient, ...exam } = await tx.clinicalEmr.findUniqueOrThrow({
      where: { id: emrId },
      select: {
        chiefComplaint: true,
        clinicalFindings: true,
        icd10Code: true,
        icd10Diagnosis: true,
        treatmentPlan: true,
        patient: {
          select: { id: true, fullName: true, familyId: true, dateOfBirth: true, gender: true },
        },
      },
    });
    if (patient.familyId !== visit.contract.familyId) {
      throw new NotFoundException('Người bệnh không thuộc gia đình của buổi khám.');
    }
    const ageMonths = patientAgeMonths(patient.dateOfBirth, vietnamNow);
    if (ageMonths === null)
      throw new BadRequestException(
        'Ngày sinh người bệnh không hợp lệ. Vui lòng cập nhật hồ sơ.',
      );
    const context = dto.clinicalContext;
    if (!context?.address?.trim())
      throw new BadRequestException('Vui lòng nhập nơi cư trú của người bệnh.');
    if (!context.phone?.trim())
      throw new BadRequestException(
        'Vui lòng nhập số điện thoại liên hệ của người bệnh hoặc người đại diện.',
      );
    if (context.treatmentMode === 'INPATIENT')
      throw new BadRequestException(
        'Mẫu kê đơn tại nhà và từ xa chỉ hỗ trợ điều trị ngoại trú.',
      );
    if (
      ageMonths < 72 &&
      (!context.weightKg || !context.caregiverName?.trim())
    ) {
      throw new BadRequestException(
        'Trẻ dưới 72 tháng tuổi cần có cân nặng và họ tên người đưa trẻ đến khám.',
      );
    }
    for (const [index, drug] of dto.details.entries()) {
      if (prescriptionDrugName(drug).length > 150)
        throw new BadRequestException(
          `Thuốc ${index + 1}: tên INN và tên thương mại kết hợp không được vượt quá 150 ký tự.`,
        );
      if (!drug.medicationType || drug.medicationType === 'SINGLE_INGREDIENT') {
        if (!drug.activeIngredient?.trim())
          throw new BadRequestException(
            `Thuốc ${index + 1}: vui lòng nhập tên hoạt chất (INN).`,
          );
      }
      if (
        drug.durationDays > 30 &&
        (!eligibleForLongTermPrescription(exam.icd10Code) ||
          (context.longTermReason?.trim().length ?? 0) < 10)
      ) {
        throw new BadRequestException(
          `Thuốc ${index + 1}: kê trên 30 ngày cần chẩn đoán thuộc Phụ lục VII và lý do chuyên môn ít nhất 10 ký tự.`,
        );
      }
      if (
        !Number.isInteger(drug.durationDays) ||
        drug.durationDays < 1 ||
        drug.durationDays > 90
      ) {
        throw new BadRequestException(
          `Thuốc ${index + 1}: số ngày dùng phải từ 1 đến 90 ngày.`,
        );
      }
    }
    const prescribedDate = new Date(
      `${vietnamNow.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    const validUntil = new Date(
      prescribedDate.getTime() + 5 * 24 * 60 * 60 * 1000,
    );
    const recordSnapshot: PrescriptionSnapshot = {
      version: 1,
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        gender: patient.gender,
        ageMonths,
      },
      doctorName: visit.doctor.doctorName,
      facility: { ...visit.doctor.facility, phone: visit.doctor.user.phone },
      exam,
    };
    const prescription = await tx.prescription.create({
      data: {
        emrId,
        prescriptionCode: `FMD-${randomUUID()}`,
        recipientUserId: recipient.id,
        prescribedDate,
        validUntil,
        recordSnapshot,
        ...(replacement
          ? {
              replacesPrescriptionId: replacement.id,
              replacementReason: replacement.reason,
            }
          : {}),
        instructions: dto.instructions || null,
        clinicalContext: {
          ...context,
          address: context.address.trim(),
          phone: context.phone.trim(),
          ageMonths,
          treatmentMode: 'OUTPATIENT',
        },
        details: {
          create: dto.details.map((detail, index) => ({
            medicationName: prescriptionDrugName(detail),
            medicationCode: detail.medicationCode || null,
            activeIngredient: detail.activeIngredient || null,
            medicationType: detail.medicationType ?? 'SINGLE_INGREDIENT',
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

  async replace(
    actor: AuthenticatedUser,
    id: string,
    dto: ReplacePrescriptionDto,
  ) {
    if (actor.role !== 'DOCTOR')
      throw new NotFoundException(
        'Không tìm thấy đơn thuốc trong phạm vi của bạn.',
      );
    if ((dto.replacementReason?.trim().length ?? 0) < 10)
      throw new BadRequestException('Lý do thay thế phải có ít nhất 10 ký tự.');
    const now = new Date();
    const vietnamNow = new Date(now.getTime() + VIETNAM_TIME_OFFSET_MS);
    return prescriptionTransaction(this.prisma, async (tx) => {
      const previous = await tx.prescription.findFirst({
        where: {
          id,
          clinicalEmr: {
            encounter: { doctor: activePrescribingDoctor(actor.id) },
          },
        },
        select: {
          id: true,
          emrId: true,
          status: true,
          clinicalEmr: { select: { encounterId: true } },
        },
      });
      if (!previous)
        throw new NotFoundException('Không tìm thấy đơn thuốc do bạn kê.');
      if (previous.status === 'CANCELLED')
        throw new ConflictException(
          'Đơn này đã được thay thế. Vui lòng tải lại đơn mới nhất.',
        );
      const visit = await tx.encounter.findFirst({
        where: {
          id: previous.clinicalEmr.encounterId,
          ...doctorVisitScope(actor.id, vietnamNow),
        },
        select: visitSelect,
      });
      if (!visit)
        throw new NotFoundException(
          'Lần khám không còn thuộc phạm vi kê đơn của bạn.',
        );
      const result = await this.createSharedPrescription(
        tx,
        actor.id,
        visit,
        previous.emrId,
        dto,
        vietnamNow,
        { id, reason: dto.replacementReason.trim() },
      );
      const changed = await tx.prescription.updateMany({
        where: { id, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      if (changed.count !== 1)
        throw new ConflictException('Đơn vừa được thay thế. Vui lòng tải lại.');
      await writeBusinessAudit(
        tx,
        actor.id,
        'REPLACE_PRESCRIPTION',
        'Prescription',
        id,
      );
      return { ...result, replacesPrescriptionId: id };
    });
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

  async exportRecord(actor: AuthenticatedUser, id: string) {
    const record = await this.detail(actor, id, actor.role === 'DOCTOR');
    await writeBusinessAudit(
      this.prisma,
      actor.id,
      'EXPORT_PRESCRIPTION',
      'Prescription',
      id,
    );
    return {
      format: 'FAMIDOC_PRESCRIPTION_V1',
      exportedAt: new Date().toISOString(),
      ...record,
    };
  }

  async familyDetail(actor: AuthenticatedUser, id: string) {
    return this.detail(actor, id, false);
  }

  private async detail(actor: AuthenticatedUser, id: string, doctor: boolean) {
    const record = await this.prisma.prescription.findFirst({
      where: {
        id,
        ...(doctor
          ? {
              clinicalEmr: {
                encounter: { doctor: activePrescribingDoctor(actor.id) },
              },
            }
          : familyPrescriptionScope(actor)),
      },
      select: {
        ...prescriptionSelect,
        instructions: true,
        clinicalContext: true,
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
      clinicalContext: record.clinicalContext,
      details: record.details,
    };
  }
}
