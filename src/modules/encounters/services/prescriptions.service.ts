import {
  ConflictException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ContractErrorCode,
  EncounterRecordErrorCode,
  ValidationErrorCode,
  ValidationIssue,
} from '../../../core/constants/error-codes.constant';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { Icd10Service } from '../../icd10/icd10.service';
import {
  assertDiagnoses,
  type ResolvedDiagnosisRow,
} from '../visit-diagnoses.util';
import {
  computeProfileCompleteness,
  isFutureBirthDate,
} from '../../patients/utils/profile-completeness.util';
import type { UpdateVisitPatientProfileDto } from '../dtos/update-visit-patient-profile.dto';
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
import { computeVitalAbnormalAlert } from '../../patients/utils/vital-sign.util';
import type {
  ConfirmVisitRecordDto,
  DraftDiagnosisDto,
  FamilyPrescriptionsDto,
  FamilyPrescriptionQuery,
  HomeMedicationDto,
  PrescriptionInputDto,
  ReplacePrescriptionDto,
  SaveVisitDraftDto,
  SharePrescriptionDto,
  VisitVitalsDto,
} from '../dtos/share-prescription.dto';

const PAGE_SIZE = 12;
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;
const LOCKED_VISIT_STATUSES = new Set(['DISPUTED', 'NO_SHOW', 'CANCELLED']);

function incompleteProfileError(fullName: string): BaseApiException {
  return new BaseApiException({
    errorCode: ContractErrorCode.PATIENT_PROFILE_INCOMPLETE,
    status: HttpStatus.BAD_REQUEST,
    message: 'Chưa thể kê đơn vì thiếu ngày sinh người bệnh.',
    detail: `Cần cập nhật ngày sinh của ${fullName} để tính liều theo tuổi.`,
    conditions: [
      {
        code: 'DOB_REQUIRED',
        condition: 'Người bệnh phải có ngày sinh hợp lệ',
        message: `Vui lòng bổ sung ngày sinh của ${fullName} trước khi kê đơn.`,
      },
    ],
  });
}

function visitFieldError(
  field: string,
  issue: ValidationIssue,
  message: string,
): BaseApiException {
  return new BaseApiException({
    errorCode: ValidationErrorCode.VALIDATION_FAILED,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message,
    invalidParams: [{ field, issue, message }],
  });
}

function formatVisitStart(scheduledDate: Date, scheduledTime: Date): string {
  const hh = String(scheduledTime.getUTCHours()).padStart(2, '0');
  const mm = String(scheduledTime.getUTCMinutes()).padStart(2, '0');
  const dd = String(scheduledDate.getUTCDate()).padStart(2, '0');
  const mo = String(scheduledDate.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = scheduledDate.getUTCFullYear();
  return `${hh}:${mm} ngày ${dd}/${mo}/${yyyy}`;
}

async function prescriptionTransaction<T>(
  prisma: PrismaService,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await serializable(prisma, action);
  } catch (error) {
    if (error instanceof ConflictException && error.message.startsWith('Concurrent'))
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.PRESCRIPTION_CONCURRENT_UPDATE,
        status: HttpStatus.CONFLICT,
        message:
          'Đơn thuốc vừa được cập nhật. Vui lòng tải lại trước khi thao tác tiếp.',
        conditions: [
          {
            code: 'NO_CONCURRENT_UPDATE',
            condition: 'Đơn thuốc không bị thay đổi đồng thời bởi thao tác khác',
            message:
              'Đơn thuốc vừa được cập nhật. Vui lòng tải lại trước khi thao tác tiếp.',
          },
        ],
      });
    throw error;
  }
}

const visitSelect = {
  id: true,
  encounterType: true,
  encounterStatus: true,
  familyConfirmedArrivalAt: true,
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
      {
        encounterStatus: {
          in: ['IN_PROGRESS', 'PENDING_RECORD', 'WRAP_UP', 'COMPLETED', 'DISPUTED', 'NO_SHOW'],
        },
      },
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
    throw new BaseApiException({
      errorCode: ContractErrorCode.FAMILY_UNIT_NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
      message: 'Không tìm thấy hồ sơ gia đình.',
    });
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly icd10?: Icd10Service,
  ) {}

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
      throw visitFieldError(
        'recipientAuthorized',
        ValidationIssue.REQUIRED,
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
            throw new BaseApiException({
              errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
              status: HttpStatus.NOT_FOUND,
              message: 'Không tìm thấy buổi khám đủ điều kiện kê đơn.',
            });
          // Chọn đúng người bệnh khi một buổi khám có nhiều thành viên.
          const patientIds = new Set([
            ...visit.participants.map(({ patient }) => patient.id),
            ...visit.clinicalEmrs.map(({ patientId }) => patientId),
          ]);
          const targetPatientId =
            dto.patientId ?? (patientIds.size === 1 ? [...patientIds][0] : undefined);
          if (!targetPatientId || !patientIds.has(targetPatientId)) {
            throw visitFieldError(
              'patientId',
              !targetPatientId ? ValidationIssue.REQUIRED : ValidationIssue.NOT_FOUND,
              'Vui lòng chọn thành viên được khám để kê đơn.',
            );
          }
          const existingEmr = visit.clinicalEmrs.find(
            (emr) => emr.patientId === targetPatientId,
          );
          if (existingEmr?.isFinalized && dto.exam) {
            throw new BaseApiException({
              errorCode: EncounterRecordErrorCode.VISIT_RECORD_LOCKED,
              status: HttpStatus.CONFLICT,
              message: 'Thông tin khám đã xác nhận được giữ nguyên khi kê đơn.',
              conditions: [
                {
                  code: 'VISIT_RECORD_UNLOCKED',
                  condition: 'Thông tin khám chưa được xác nhận',
                  message:
                    'Thông tin khám đã xác nhận được giữ nguyên khi kê đơn.',
                },
              ],
            });
          }
          if (existingEmr?.prescriptions.length) {
            throw new BaseApiException({
              errorCode: EncounterRecordErrorCode.VISIT_PRESCRIPTION_ALREADY_ISSUED,
              status: HttpStatus.CONFLICT,
              message: 'Buổi khám này đã có đơn thuốc.',
              conditions: [
                {
                  code: 'NO_ISSUED_PRESCRIPTION',
                  condition: 'Buổi khám chưa có đơn thuốc nào',
                  message: 'Buổi khám này đã có đơn thuốc.',
                },
              ],
            });
          }
          let emrId = existingEmr?.id;
          if (!emrId) {
            if (!dto.exam)
              throw visitFieldError(
                'exam',
                ValidationIssue.REQUIRED,
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
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.PRESCRIPTION_CONCURRENT_UPDATE,
          status: HttpStatus.CONFLICT,
          message:
            'Buổi khám vừa được cập nhật. Vui lòng tải lại để kiểm tra đơn thuốc.',
          conditions: [
            {
              code: 'NO_CONCURRENT_UPDATE',
              condition: 'Buổi khám không bị cập nhật đồng thời',
              message:
                'Buổi khám vừa được cập nhật. Vui lòng tải lại để kiểm tra đơn thuốc.',
            },
          ],
        });
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
      throw new BaseApiException({
        errorCode: ContractErrorCode.FAMILY_UNIT_NOT_FOUND,
        status: HttpStatus.NOT_FOUND,
        message: 'Không tìm thấy gia đình trong phạm vi kê đơn.',
      });
    const visitPatients = dto.prescriptions.map(
      (entry) => entry.encounterId + ':' + entry.patientId,
    );
    if (new Set(visitPatients).size !== visitPatients.length)
      throw visitFieldError(
        'prescriptions',
        ValidationIssue.DUPLICATE,
        'Mỗi thành viên chỉ được chọn một lần trong cùng buổi khám.',
      );
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
          throw new BaseApiException({
            errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
            status: HttpStatus.NOT_FOUND,
            message: 'Lần khám không thuộc gia đình hoặc bác sĩ đang kê đơn.',
          });
        }
        if (!emr?.isFinalized)
          throw new BaseApiException({
            errorCode: EncounterRecordErrorCode.VISIT_RECORD_NOT_FINALIZED,
            status: HttpStatus.CONFLICT,
            message:
              'Cần xác nhận sổ khám của từng thành viên trước khi gửi đơn gia đình.',
            conditions: [
              {
                code: 'VISIT_RECORD_FINALIZED',
                condition: 'Sổ khám của từng thành viên phải được xác nhận trước',
                message:
                  'Cần xác nhận sổ khám của từng thành viên trước khi gửi đơn gia đình.',
              },
            ],
          });
        if (emr.prescriptions.length)
          throw new BaseApiException({
            errorCode: EncounterRecordErrorCode.VISIT_PRESCRIPTION_ALREADY_ISSUED,
            status: HttpStatus.CONFLICT,
            message:
              'Một thành viên đã được kê đơn cho lần khám đã chọn. Hãy tải lại danh sách.',
            conditions: [
              {
                code: 'NO_ISSUED_PRESCRIPTION',
                condition: 'Thành viên chưa được kê đơn cho lần khám đã chọn',
                message:
                  'Một thành viên đã được kê đơn cho lần khám đã chọn. Hãy tải lại danh sách.',
              },
            ],
          });
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

  private async resolveDoctorVisitMember(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
    patientId: string,
    vietnamNow: Date,
  ) {
    const visit = await tx.encounter.findFirst({
      where: {
        id,
        ...doctorVisitScope(actor.id, vietnamNow),
      },
      select: visitSelect,
    });
    if (!visit) {
      const pendingVisit = await tx.encounter.findFirst({
        where: {
          id,
          doctor: activePrescribingDoctor(actor.id),
        },
        select: {
          encounterStatus: true,
          scheduledDate: true,
          scheduledTime: true,
        },
      });
      if (pendingVisit?.encounterStatus === 'CONFIRMED') {
        const msg = `Chưa đến giờ khám. Bạn có thể ghi trang khám từ ${formatVisitStart(pendingVisit.scheduledDate, pendingVisit.scheduledTime)}.`;
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_NOT_STARTED,
          status: HttpStatus.CONFLICT,
          message: msg,
          conditions: [
            {
              code: 'VISIT_NOT_STARTED',
              condition: 'Buổi khám phải đến giờ bắt đầu',
              message: msg,
            },
          ],
        });
      }
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
        status: HttpStatus.NOT_FOUND,
        message: 'Không tìm thấy buổi khám của thành viên này.',
      });
    }
    if (LOCKED_VISIT_STATUSES.has(visit.encounterStatus)) {
      const msg =
        'Ca khám đang bị khóa (khiếu nại/vắng mặt), không thể ghi trang khám.';
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.VISIT_RECORD_LOCKED,
        status: HttpStatus.CONFLICT,
        message: msg,
        conditions: [
          {
            code: 'VISIT_LOCKED',
            condition:
              'Ca khám không ở trạng thái bị khóa (khiếu nại/vắng mặt/đã hủy)',
            message: msg,
          },
        ],
      });
    }
    const member = await tx.patient.findFirst({
      where: {
        id: patientId,
        familyId: visit.contract.familyId,
      },
      select: { id: true },
    });
    if (!member) {
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
        status: HttpStatus.NOT_FOUND,
        message: 'Không tìm thấy buổi khám của thành viên này.',
      });
    }
    const existingEmr = visit.clinicalEmrs.find(
      (e) => e.patientId === patientId,
    );
    return { visit, existingEmr };
  }

  async updateVisitPatientProfile(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateVisitPatientProfileDto,
  ) {
    if (dto.dateOfBirth && isFutureBirthDate(dto.dateOfBirth)) {
      throw new BaseApiException({
        errorCode: ValidationErrorCode.VALIDATION_FAILED,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Ngày sinh không được ở tương lai.',
        detail: 'Ngày sinh không được ở tương lai.',
        invalidParams: [
          {
            field: 'dateOfBirth',
            issue: 'FUTURE_DATE',
            message: 'Ngày sinh không được ở tương lai.',
          },
        ],
      });
    }

    return prescriptionTransaction(this.prisma, async (tx) => {
      const vietnamNow = new Date(Date.now() + VIETNAM_TIME_OFFSET_MS);
      await this.resolveDoctorVisitMember(
        tx,
        actor,
        id,
        dto.patientId,
        vietnamNow,
      );

      const data: Prisma.PatientUpdateInput = {
        ...(dto.dateOfBirth !== undefined
          ? { dateOfBirth: new Date(dto.dateOfBirth) }
          : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
      };

      const updated = await tx.patient.update({
        where: { id: dto.patientId },
        data,
        select: { id: true, dateOfBirth: true, gender: true },
      });

      return {
        ...updated,
        profileCompleteness: computeProfileCompleteness(updated),
      };
    });
  }

  private async upsertVisitVitals(
    tx: Prisma.TransactionClient,
    emrId: string,
    patientId: string,
    vitals?: VisitVitalsDto,
  ) {
    if (!vitals) return;
    const hasAnyValue = Object.values(vitals).some(
      (value) => value !== undefined && value !== null,
    );
    if (!hasAnyValue) return;

    const isAbnormalAlert = computeVitalAbnormalAlert(vitals);
    const vitalData = {
      ...(vitals.systolicBp !== undefined
        ? { systolicBp: vitals.systolicBp }
        : {}),
      ...(vitals.diastolicBp !== undefined
        ? { diastolicBp: vitals.diastolicBp }
        : {}),
      ...(vitals.heartRate !== undefined
        ? { heartRate: vitals.heartRate }
        : {}),
      ...(vitals.temperature !== undefined
        ? { temperature: vitals.temperature }
        : {}),
      ...(vitals.spo2 !== undefined ? { spo2: vitals.spo2 } : {}),
      ...(vitals.respiratoryRate !== undefined
        ? { respiratoryRate: vitals.respiratoryRate }
        : {}),
      ...(vitals.weightKg !== undefined ? { weightKg: vitals.weightKg } : {}),
      ...(vitals.heightCm !== undefined ? { heightCm: vitals.heightCm } : {}),
      isAbnormalAlert,
    };

    await tx.vitalSign.upsert({
      where: { emrId },
      create: {
        emrId,
        patientId,
        ...vitalData,
      },
      update: vitalData,
    });
  }

  private async resolveDiagnosesCatalog(diagnoses: DraftDiagnosisDto[]) {
    const catalog = this.icd10
      ? await this.icd10.findActiveByCodes(diagnoses.map((d) => d.icd10Code))
      : [];
    return assertDiagnoses(diagnoses, catalog);
  }

  private async replaceDiagnoses(
    tx: Prisma.TransactionClient,
    emrId: string,
    rows: ResolvedDiagnosisRow[],
  ) {
    await tx.clinicalEmrDiagnosis.deleteMany({ where: { emrId } });
    if (rows.length > 0) {
      await tx.clinicalEmrDiagnosis.createMany({
        data: rows.map((row) => ({
          emrId,
          icd10Code: row.icd10Code,
          nameSnapshot: row.nameSnapshot,
          isPrimary: row.isPrimary,
          lineNumber: row.lineNumber,
        })),
      });
    }
  }

  private async replaceHomeMedications(
    tx: Prisma.TransactionClient,
    emrId: string,
    items: HomeMedicationDto[],
  ) {
    await tx.homeMedication.deleteMany({ where: { emrId } });
    if (items.length > 0) {
      await tx.homeMedication.createMany({
        data: items.map((item, lineNumber) => ({
          emrId,
          medicationName: item.medicationName,
          source: item.source,
          assessment: item.assessment,
          notes: item.notes ?? null,
          lineNumber,
        })),
      });
    }
  }

  private buildExamWriteData(
    exam: SaveVisitDraftDto['exam'] | ConfirmVisitRecordDto['exam'],
    icd10Code?: string,
    icd10Diagnosis?: string,
  ) {
    return {
      ...(exam?.chiefComplaint !== undefined
        ? { chiefComplaint: exam.chiefComplaint }
        : {}),
      ...(exam?.anamnesis !== undefined ? { anamnesis: exam.anamnesis } : {}),
      ...(exam?.informantName !== undefined
        ? { informantName: exam.informantName }
        : {}),
      ...(exam?.informantRelation !== undefined
        ? { informantRelation: exam.informantRelation }
        : {}),
      ...(exam?.personalHistory !== undefined
        ? { personalHistory: exam.personalHistory }
        : {}),
      ...(exam?.familyHistory !== undefined
        ? { familyHistory: exam.familyHistory }
        : {}),
      ...(exam?.medicationAdherence !== undefined
        ? { medicationAdherence: exam.medicationAdherence }
        : {}),
      ...(exam?.generalExam !== undefined
        ? { generalExam: exam.generalExam }
        : {}),
      ...(exam?.clinicalFindings !== undefined
        ? { clinicalFindings: exam.clinicalFindings }
        : {}),
      ...(icd10Code !== undefined ? { icd10Code } : {}),
      ...(icd10Diagnosis !== undefined ? { icd10Diagnosis } : {}),
      ...(exam?.treatmentPlan !== undefined
        ? { treatmentPlan: exam.treatmentPlan }
        : {}),
      ...(exam?.selfCareNotes !== undefined
        ? { selfCareNotes: exam.selfCareNotes }
        : {}),
      ...(exam?.progression !== undefined
        ? { progression: exam.progression }
        : {}),
      ...(exam?.followUpDate !== undefined
        ? { followUpDate: new Date(`${exam.followUpDate}T00:00:00.000Z`) }
        : {}),
    };
  }

  private async assertReplaceablePrescription(
    tx: Prisma.TransactionClient,
    patientId: string,
    id: string,
  ) {
    const previous = await tx.prescription.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        replacedBy: { select: { id: true } },
        clinicalEmr: { select: { patientId: true } },
        details: { select: { medicationName: true } },
      },
    });
    if (
      !previous ||
      previous.clinicalEmr.patientId !== patientId ||
      previous.status !== 'ISSUED' ||
      previous.replacedBy != null
    ) {
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.PRESCRIPTION_REPLACEMENT_INVALID,
        status: HttpStatus.CONFLICT,
        message:
          'Đơn thuốc nối tiếp không hợp lệ hoặc đã được thay thế trước đó.',
      });
    }
    return previous;
  }

  private async isLongTermDiagnosisEligible(
    tx: Prisma.TransactionClient,
    emrId: string,
    fallbackIcd10Code: string,
    resolvedDiagnoses?: ResolvedDiagnosisRow[],
  ): Promise<boolean> {
    if (resolvedDiagnoses?.length) {
      return resolvedDiagnoses.some((row) => row.longTermEligible);
    }

    const savedDiagnoses = await tx.clinicalEmrDiagnosis?.findMany?.({
      where: { emrId },
      select: { icd10Code: true },
    });
    const codes = savedDiagnoses?.length
      ? savedDiagnoses.map((d) => d.icd10Code)
      : [fallbackIcd10Code].filter(Boolean);

    if (codes.length === 0) {
      return false;
    }

    if (this.icd10) {
      const entries = await this.icd10.findActiveByCodes(codes);
      if (entries.length > 0) {
        return entries.some((entry) => Boolean(entry.longTermEligible));
      }
    }

    // Fallback: chỉ dùng khi danh mục ICD-10 chưa có mã hoặc icd10Service chưa được inject.
    return codes.some((code) => eligibleForLongTermPrescription(code));
  }

  async saveVisitDraft(
    actor: AuthenticatedUser,
    id: string,
    dto: SaveVisitDraftDto,
  ) {
    const now = new Date();
    const vietnamNow = new Date(now.getTime() + VIETNAM_TIME_OFFSET_MS);
    return prescriptionTransaction(this.prisma, async (tx) => {
      const { existingEmr } = await this.resolveDoctorVisitMember(
        tx,
        actor,
        id,
        dto.patientId,
        vietnamNow,
      );
      if (existingEmr?.isFinalized) {
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_RECORD_LOCKED,
          status: HttpStatus.CONFLICT,
          message: 'Trang khám đã được xác nhận, không thể chỉnh sửa.',
        });
      }

      const resolvedDiagnoses =
        dto.exam?.diagnoses !== undefined
          ? await this.resolveDiagnosesCatalog(dto.exam.diagnoses)
          : undefined;

      const icd10Code =
        resolvedDiagnoses?.primary.icd10Code ?? dto.exam?.icd10Code;
      const icd10Diagnosis =
        resolvedDiagnoses?.primary.nameSnapshot ?? dto.exam?.icd10Diagnosis;

      const examPatch = this.buildExamWriteData(
        dto.exam,
        icd10Code,
        icd10Diagnosis,
      );

      const record = existingEmr
        ? await tx.clinicalEmr.update({
            where: { id: existingEmr.id },
            data: examPatch,
            select: { id: true, isFinalized: true },
          })
        : await tx.clinicalEmr.create({
            data: {
              encounterId: id,
              patientId: dto.patientId,
              chiefComplaint: dto.exam?.chiefComplaint ?? '',
              clinicalFindings: dto.exam?.clinicalFindings ?? '',
              icd10Code: icd10Code ?? '',
              icd10Diagnosis: icd10Diagnosis ?? '',
              treatmentPlan: dto.exam?.treatmentPlan ?? '',
              ...(dto.exam?.anamnesis !== undefined
                ? { anamnesis: dto.exam.anamnesis }
                : {}),
              ...(dto.exam?.informantName !== undefined
                ? { informantName: dto.exam.informantName }
                : {}),
              ...(dto.exam?.informantRelation !== undefined
                ? { informantRelation: dto.exam.informantRelation }
                : {}),
              ...(dto.exam?.personalHistory !== undefined
                ? { personalHistory: dto.exam.personalHistory }
                : {}),
              ...(dto.exam?.familyHistory !== undefined
                ? { familyHistory: dto.exam.familyHistory }
                : {}),
              ...(dto.exam?.medicationAdherence !== undefined
                ? { medicationAdherence: dto.exam.medicationAdherence }
                : {}),
              ...(dto.exam?.generalExam !== undefined
                ? { generalExam: dto.exam.generalExam }
                : {}),
              ...(dto.exam?.selfCareNotes !== undefined
                ? { selfCareNotes: dto.exam.selfCareNotes }
                : {}),
              ...(dto.exam?.progression !== undefined
                ? { progression: dto.exam.progression }
                : {}),
              ...(dto.exam?.followUpDate !== undefined
                ? {
                    followUpDate: new Date(
                      `${dto.exam.followUpDate}T00:00:00.000Z`,
                    ),
                  }
                : {}),
              isFinalized: false,
            },
            select: { id: true, isFinalized: true },
          });

      if (resolvedDiagnoses) {
        await this.replaceDiagnoses(tx, record.id, resolvedDiagnoses.rows);
      }
      if (dto.exam?.homeMedications !== undefined) {
        await this.replaceHomeMedications(
          tx,
          record.id,
          dto.exam.homeMedications,
        );
      }
      await this.upsertVisitVitals(tx, record.id, dto.patientId, dto.vitals);

      return {
        encounterId: id,
        emrId: record.id,
        isFinalized: record.isFinalized,
        savedAt: now,
      };
    });
  }

  async confirmVisitRecord(
    actor: AuthenticatedUser,
    id: string,
    dto: ConfirmVisitRecordDto,
  ) {
    if (dto.confirmed !== true) {
      throw visitFieldError(
        'confirmed',
        ValidationIssue.REQUIRED,
        'Vui lòng xác nhận nội dung và người được khám.',
      );
    }
    const now = new Date();
    const vietnamNow = new Date(now.getTime() + VIETNAM_TIME_OFFSET_MS);
    return prescriptionTransaction(this.prisma, async (tx) => {
      const { visit, existingEmr } = await this.resolveDoctorVisitMember(
        tx,
        actor,
        id,
        dto.patientId,
        vietnamNow,
      );
      if (existingEmr?.isFinalized) {
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_RECORD_LOCKED,
          status: HttpStatus.CONFLICT,
          message: 'Trang khám đã được xác nhận.',
          conditions: [
            {
              code: 'VISIT_RECORD_UNLOCKED',
              condition: 'Trang khám chưa được xác nhận',
              message: 'Trang khám đã được xác nhận nên không thể xác nhận lại.',
            },
          ],
        });
      }
      if (
        existingEmr?.prescriptions.length &&
        (dto.prescription || dto.exam)
      ) {
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_PRESCRIPTION_ALREADY_ISSUED,
          status: HttpStatus.CONFLICT,
          message:
            'Trang khám đã có đơn thuốc. Bạn có thể xác nhận nội dung đã lưu.',
          conditions: [
            {
              code: 'NO_ISSUED_PRESCRIPTION',
              condition: 'Trang khám chưa có đơn thuốc nào',
              message:
                'Trang khám đã có đơn thuốc nên không thể gửi lại nội dung khám hoặc đơn mới.',
            },
          ],
        });
      }
      if (!existingEmr && !dto.exam) {
        throw visitFieldError(
          'exam',
          ValidationIssue.REQUIRED,
          'Vui lòng nhập thông tin khám trước khi xác nhận.',
        );
      }

      const resolvedDiagnoses =
        dto.exam?.diagnoses !== undefined
          ? await this.resolveDiagnosesCatalog(dto.exam.diagnoses)
          : undefined;
      const icd10Code =
        resolvedDiagnoses?.primary.icd10Code ?? dto.exam?.icd10Code;
      const icd10Diagnosis =
        resolvedDiagnoses?.primary.nameSnapshot ?? dto.exam?.icd10Diagnosis;

      if (!(icd10Code ?? existingEmr?.icd10Code)?.trim()) {
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.ICD10_PRIMARY_REQUIRED,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'Phải chọn đúng 1 bệnh chính trong danh sách chẩn đoán.',
        });
      }

      const examPatch = this.buildExamWriteData(
        dto.exam,
        icd10Code,
        icd10Diagnosis,
      );

      // Xác nhận nội bộ gắn với tài khoản bác sĩ và thời điểm ghi nhận.
      const confirmation = { isFinalized: true, finalizedAt: now };
      const record = existingEmr
        ? await tx.clinicalEmr.update({
            where: { id: existingEmr.id },
            data: { ...examPatch, ...confirmation },
            select: { id: true },
          })
        : await tx.clinicalEmr.create({
            data: {
              chiefComplaint: dto.exam?.chiefComplaint ?? '',
              clinicalFindings: dto.exam?.clinicalFindings ?? '',
              icd10Code: icd10Code ?? '',
              icd10Diagnosis: icd10Diagnosis ?? '',
              treatmentPlan: dto.exam?.treatmentPlan ?? '',
              ...examPatch,
              encounterId: id,
              patientId: dto.patientId,
              ...confirmation,
            },
            select: { id: true },
          });
      if (resolvedDiagnoses) {
        await this.replaceDiagnoses(tx, record.id, resolvedDiagnoses.rows);
      }
      if (dto.exam?.homeMedications !== undefined) {
        await this.replaceHomeMedications(
          tx,
          record.id,
          dto.exam.homeMedications,
        );
      }
      await this.upsertVisitVitals(tx, record.id, dto.patientId, dto.vitals);
      if (dto.vitals?.weightKg !== undefined) {
        await tx.patient.update({
          where: { id: dto.patientId },
          data: { weightKg: dto.vitals.weightKg },
        });
      }
      if (dto.prescription) {
        if (resolvedDiagnoses) {
          await this.createSharedPrescription(
            tx,
            actor.id,
            visit,
            record.id,
            dto.prescription,
            vietnamNow,
            undefined,
            resolvedDiagnoses.rows,
          );
        } else {
          await this.createSharedPrescription(
            tx,
            actor.id,
            visit,
            record.id,
            dto.prescription,
            vietnamNow,
          );
        }
      }
      await tx.encounterParticipant.upsert({
        where: {
          encounterId_patientId: { encounterId: id, patientId: dto.patientId },
        },
        update: { attendanceStatus: 'EXAMINED' },
        create: {
          encounterId: id,
          patientId: dto.patientId,
          attendanceStatus: 'EXAMINED',
        },
      });
      if (visit.encounterType === 'TELEHEALTH') {
        const shouldCompleteEncounter =
          visit.encounterStatus === 'PENDING_RECORD' ||
          visit.encounterStatus === 'IN_PROGRESS' ||
          (visit.encounterStatus === 'CONFIRMED' &&
            visit.familyConfirmedArrivalAt != null);
        if (shouldCompleteEncounter) {
          await tx.encounter.updateMany({
            where: {
              id,
              encounterStatus: {
                in: ['CONFIRMED', 'IN_PROGRESS', 'PENDING_RECORD'],
              },
            },
            data: { encounterStatus: 'COMPLETED' },
          });
        }
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
      }
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
    resolvedDiagnoses?: ResolvedDiagnosisRow[],
  ) {
    const recipient = visit.contract.familyUnit.representativeUser;
    if (
      dto.recipientAuthorized !== true ||
      recipient.id !== dto.recipientUserId ||
      recipient.role !== 'FAMILY_REP' ||
      recipient.status !== 'ACTIVE'
    ) {
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.PRESCRIPTION_RECIPIENT_INVALID,
        status: HttpStatus.CONFLICT,
        message:
          'Người nhận đã thay đổi hoặc không còn hợp lệ. Vui lòng tải lại buổi khám.',
        conditions: [
          {
            code: 'RECIPIENT_ACTIVE_REPRESENTATIVE',
            condition:
              'Người nhận đơn phải là đại diện gia đình đang hoạt động và đã được xác nhận',
            message:
              'Người nhận đơn không còn khớp với đại diện gia đình hiện tại. Vui lòng tải lại buổi khám.',
          },
        ],
      });
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
      throw new BaseApiException({
        errorCode: ContractErrorCode.PATIENT_NOT_IN_FAMILY,
        status: HttpStatus.NOT_FOUND,
        message: 'Người bệnh không thuộc gia đình của buổi khám.',
      });
    }
    const ageMonths = patientAgeMonths(patient.dateOfBirth, vietnamNow);
    if (!patient.dateOfBirth || ageMonths === null) {
      throw incompleteProfileError(patient.fullName);
    }
    const context = dto.clinicalContext;
    if (!context?.address?.trim())
      throw visitFieldError(
        'prescription.clinicalContext.address',
        ValidationIssue.REQUIRED,
        'Vui lòng nhập nơi cư trú của người bệnh.',
      );
    if (!context.phone?.trim())
      throw visitFieldError(
        'prescription.clinicalContext.phone',
        ValidationIssue.REQUIRED,
        'Vui lòng nhập số điện thoại liên hệ của người bệnh hoặc người đại diện.',
      );
    if (context.treatmentMode === 'INPATIENT')
      throw visitFieldError(
        'prescription.clinicalContext.treatmentMode',
        ValidationIssue.INVALID_STATE,
        'Mẫu kê đơn tại nhà và từ xa chỉ hỗ trợ điều trị ngoại trú.',
      );
    if (
      ageMonths < 72 &&
      (!context.weightKg || !context.caregiverName?.trim())
    ) {
      throw visitFieldError(
        !context.weightKg
          ? 'prescription.clinicalContext.weightKg'
          : 'prescription.clinicalContext.caregiverName',
        ValidationIssue.REQUIRED,
        'Trẻ dưới 72 tháng tuổi cần có cân nặng và họ tên người đưa trẻ đến khám.',
      );
    }

    let effectiveReplacement = replacement;
    let previousMedicationNames: Set<string> | null = null;
    if (!effectiveReplacement && dto.replacesPrescriptionId) {
      const previousRx = await this.assertReplaceablePrescription(
        tx,
        patient.id,
        dto.replacesPrescriptionId,
      );
      previousMedicationNames = new Set(
        previousRx.details.map((d) => d.medicationName.trim().toLowerCase()),
      );
      const visitDate = vietnamNow.toISOString().slice(0, 10);
      effectiveReplacement = {
        id: previousRx.id,
        reason: `Tái khám tại nhà ngày ${visitDate}, cập nhật đơn.`,
      };
    }

    let longTermEligible: boolean | null = null;
    for (const [index, drug] of dto.details.entries()) {
      if (prescriptionDrugName(drug).length > 150)
        throw visitFieldError(
          `prescription.details[${index}].medicationName`,
          ValidationIssue.MAX_LENGTH,
          `Thuốc ${index + 1}: tên INN và tên thương mại kết hợp không được vượt quá 150 ký tự.`,
        );
      if (!drug.medicationType || drug.medicationType === 'SINGLE_INGREDIENT') {
        if (!drug.activeIngredient?.trim())
          throw visitFieldError(
            `prescription.details[${index}].activeIngredient`,
            ValidationIssue.REQUIRED,
            `Thuốc ${index + 1}: vui lòng nhập tên hoạt chất (INN).`,
          );
      }
      if (drug.changeType === 'KEEP' || drug.changeType === 'DOSE_CHANGED') {
        const rawName = drug.medicationName.trim().toLowerCase();
        const formattedName = prescriptionDrugName(drug).trim().toLowerCase();
        if (
          !previousMedicationNames ||
          (!previousMedicationNames.has(rawName) &&
            !previousMedicationNames.has(formattedName))
        ) {
          const msg =
            'Thuốc này không có trong đơn đang dùng nên không thể chọn Giữ nguyên/Đổi liều.';
          throw new BaseApiException({
            errorCode: ValidationErrorCode.VALIDATION_FAILED,
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            message: msg,
            invalidParams: [
              {
                field: `prescription.details[${index}].changeType`,
                issue: ValidationIssue.INVALID_STATE,
                message: msg,
              },
            ],
          });
        }
      }
      if (
        !Number.isInteger(drug.durationDays) ||
        drug.durationDays < 1 ||
        drug.durationDays > 90
      ) {
        throw new BaseApiException({
          errorCode:
            EncounterRecordErrorCode.PRESCRIPTION_DURATION_OUT_OF_RANGE,
          status: HttpStatus.BAD_REQUEST,
          message: `Thuốc ${index + 1}: số ngày dùng phải từ 1 đến 90 ngày.`,
        });
      }
      if (drug.durationDays > 30) {
        if (longTermEligible === null) {
          longTermEligible = await this.isLongTermDiagnosisEligible(
            tx,
            emrId,
            exam.icd10Code,
            resolvedDiagnoses,
          );
        }
        if (
          !longTermEligible ||
          (context.longTermReason?.trim().length ?? 0) < 10
        ) {
          const msg = `Thuốc ${index + 1}: kê trên 30 ngày cần chẩn đoán thuộc Phụ lục VII và lý do chuyên môn ít nhất 10 ký tự.`;
          throw new BaseApiException({
            errorCode:
              EncounterRecordErrorCode.LONG_TERM_PRESCRIPTION_NOT_ELIGIBLE,
            status: HttpStatus.BAD_REQUEST,
            message: msg,
            conditions: [
              {
                code: 'P_VII',
                condition:
                  'Chẩn đoán thuộc Phụ lục VII TT 26/2025 và lý do ≥ 10 ký tự',
                message: msg,
              },
            ],
          });
        }
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
        ...(effectiveReplacement
          ? {
              replacesPrescriptionId: effectiveReplacement.id,
              replacementReason: effectiveReplacement.reason,
            }
          : {}),
        ...(dto.discontinuedMedications !== undefined
          ? {
              discontinuedMedications: dto.discontinuedMedications.map(
                (item) => ({
                  medicationName: item.medicationName.trim(),
                  reason: item.reason.trim(),
                }),
              ),
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
            changeType: detail.changeType ?? 'NEW',
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
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.PRESCRIPTION_NOT_FOUND,
        status: HttpStatus.NOT_FOUND,
        message: 'Không tìm thấy đơn thuốc trong phạm vi của bạn.',
      });
    if ((dto.replacementReason?.trim().length ?? 0) < 10)
      throw visitFieldError(
        'replacementReason',
        ValidationIssue.MIN_LENGTH,
        'Lý do thay thế phải có ít nhất 10 ký tự.',
      );
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
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.PRESCRIPTION_NOT_FOUND,
          status: HttpStatus.NOT_FOUND,
          message: 'Không tìm thấy đơn thuốc do bạn kê.',
        });
      if (previous.status === 'CANCELLED')
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.PRESCRIPTION_REPLACEMENT_INVALID,
          status: HttpStatus.CONFLICT,
          message: 'Đơn này đã được thay thế. Vui lòng tải lại đơn mới nhất.',
          conditions: [
            {
              code: 'PRESCRIPTION_ACTIVE',
              condition: 'Đơn thuốc phải chưa bị hủy hoặc thay thế trước đó',
              message:
                'Đơn này đã được thay thế. Vui lòng tải lại đơn mới nhất.',
            },
          ],
        });
      const visit = await tx.encounter.findFirst({
        where: {
          id: previous.clinicalEmr.encounterId,
          ...doctorVisitScope(actor.id, vietnamNow),
        },
        select: visitSelect,
      });
      if (!visit)
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
          status: HttpStatus.NOT_FOUND,
          message: 'Lần khám không còn thuộc phạm vi kê đơn của bạn.',
        });
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
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.PRESCRIPTION_CONCURRENT_UPDATE,
          status: HttpStatus.CONFLICT,
          message: 'Đơn vừa được thay thế. Vui lòng tải lại.',
          conditions: [
            {
              code: 'NO_CONCURRENT_UPDATE',
              condition: 'Đơn thuốc chưa bị thay thế đồng thời',
              message: 'Đơn vừa được thay thế. Vui lòng tải lại.',
            },
          ],
        });
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
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.PRESCRIPTION_NOT_FOUND,
        status: HttpStatus.NOT_FOUND,
        message: 'Không tìm thấy đơn thuốc được chia sẻ với bạn.',
      });
    return {
      ...summary(record),
      instructions: record.instructions,
      clinicalContext: record.clinicalContext,
      details: record.details,
    };
  }
}
