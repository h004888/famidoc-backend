import {
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { writeBusinessAudit } from '../../../core/business/business-helpers';
import {
  EncounterRecordErrorCode,
  ValidationErrorCode,
  ValidationIssue,
} from '../../../core/constants/error-codes.constant';
import { PrismaService } from '../../../core/database/prisma.service';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { StorageService } from '../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../core/validation/document-file.validator';
import type { SaveHomeEnvironmentDto } from '../dtos/home-environment.dto';
import type { UploadBookDocumentDto } from '../dtos/share-prescription.dto';
import {
  activePrescribingDoctor,
  doctorVisitScope,
} from './prescriptions.service';
import {
  dateKeyset,
  dateTimeKeyset,
  decodeTimelineCursor,
  encounterKeyset,
  mergeTimelineEvents,
  type TimelineEvent,
} from './timeline.util';

const PAGE_SIZE = 12;
const VISIT_TITLE: Record<string, string> = {
  TELEHEALTH: 'Khám trực tuyến',
  HOME_VISIT: 'Khám tại nhà',
  FACILITY_VISIT: 'Khám tại cơ sở',
};

function canOpenEncounter(actor: AuthenticatedUser, doctorUserId: string) {
  return actor.role !== 'DOCTOR' || doctorUserId === actor.id;
}

function combineEncounterDateTime(scheduledDate: Date, scheduledTime: Date) {
  return new Date(
    `${scheduledDate.toISOString().slice(0, 10)}T${scheduledTime.toISOString().slice(11)}`,
  );
}

function visitEvent(
  actor: AuthenticatedUser,
  row: {
    id: string;
    encounterType: string;
    scheduledDate: Date;
    scheduledTime: Date;
    doctor: { doctorName: string; userId: string };
    clinicalEmrs: { isFinalized: boolean; icd10Diagnosis: string | null }[];
  },
): TimelineEvent {
  const emr = row.clinicalEmrs[0];
  return {
    id: row.id,
    type: 'VISIT',
    occurredAt: combineEncounterDateTime(row.scheduledDate, row.scheduledTime),
    title: VISIT_TITLE[row.encounterType] ?? 'Lượt khám',
    summary: emr?.isFinalized ? (emr.icd10Diagnosis ?? null) : null,
    actorName: row.doctor.doctorName,
    source: 'CLINICAL',
    link: { encounterId: row.id },
    canOpenDetail: canOpenEncounter(actor, row.doctor.userId),
    attachments: [],
  };
}

function prescriptionEvent(
  actor: AuthenticatedUser,
  row: {
    id: string;
    prescriptionCode: string;
    createdAt: Date;
    clinicalEmr: {
      encounterId: string;
      encounter: { doctor: { doctorName: string; userId: string } };
    };
  },
): TimelineEvent {
  const doctor = row.clinicalEmr.encounter.doctor;
  return {
    id: row.id,
    type: 'PRESCRIPTION',
    occurredAt: row.createdAt,
    title: 'Đơn thuốc',
    summary: `Mã đơn ${row.prescriptionCode}`,
    actorName: doctor.doctorName,
    source: 'CLINICAL',
    link: { encounterId: row.clinicalEmr.encounterId },
    canOpenDetail: canOpenEncounter(actor, doctor.userId),
    attachments: [],
  };
}

function documentEvent(
  patientId: string,
  record: Prisma.PatientDocumentGetPayload<{ select: typeof documentSelect }>,
): TimelineEvent {
  const info = documentInfo(patientId, record);
  return {
    id: record.id,
    type: 'DOCUMENT',
    occurredAt: record.recordedDate,
    title: record.documentName,
    summary: null,
    actorName: null,
    source: 'FAMILY_UPLOAD',
    link: { documentId: record.id },
    canOpenDetail: false,
    attachments: [
      {
        id: record.id,
        name: record.documentName,
        downloadAvailable: info.downloadAvailable,
        isImage: /\.(png|jpe?g)$/i.test(record.fileUrl ?? ''),
      },
    ],
  };
}
const documentSelect = {
  id: true,
  documentName: true,
  documentType: true,
  fileUrl: true,
  recordedDate: true,
} satisfies Prisma.PatientDocumentSelect;
const patientSelect = {
  id: true,
  fullName: true,
  dateOfBirth: true,
  relationshipToHead: true,
} satisfies Prisma.PatientSelect;
const visitSelect = {
  id: true,
  encounterType: true,
  scheduledDate: true,
  scheduledTime: true,
  doctor: { select: { doctorName: true } },
} satisfies Prisma.EncounterSelect;

function assignedContract(
  actor: AuthenticatedUser,
): Prisma.MedicalContractWhereInput {
  return {
    contractStatus: 'ACTIVE',
    doctor: activePrescribingDoctor(actor.id),
  };
}

function rosterScope(
  actor: AuthenticatedUser,
  familyId?: string,
): Prisma.PatientWhereInput {
  if (actor.role !== 'DOCTOR') return {};
  return {
    OR: [
      {
        contractMembers: {
          some: { contract: { ...assignedContract(actor), familyId } },
        },
      },
      {
        encounterParticipants: {
          some: {
            encounter: { ...doctorVisitScope(actor.id), contract: { familyId } },
          },
        },
      },
    ],
  };
}

function familyScope(actor: AuthenticatedUser): Prisma.FamilyUnitWhereInput {
  if (actor.role !== 'DOCTOR') return { representativeUserId: actor.id };
  return {
    medicalContracts: {
      some: {
        OR: [
          assignedContract(actor),
          { encounters: { some: doctorVisitScope(actor.id) } },
        ],
      },
    },
  };
}

function visitScope(actor: AuthenticatedUser): Prisma.EncounterWhereInput {
  return actor.role === 'DOCTOR'
    ? doctorVisitScope(actor.id)
    : {
        contract: { familyUnit: { representativeUserId: actor.id } },
        OR: [
          { encounterType: 'TELEHEALTH' },
          { encounterType: 'HOME_VISIT', doctorCompletedAt: { not: null } },
        ],
        clinicalEmrs: {
          some: {
            isFinalized: true,
            patient: { familyUnit: { representativeUserId: actor.id } },
          },
        },
      };
}

function patientEncounterFilter(
  familyId: string,
  patientId: string,
): Prisma.EncounterWhereInput {
  return {
    contract: { familyId },
    OR: [
      { participants: { some: { patientId } } },
      { clinicalEmrs: { some: { patientId } } },
    ],
  };
}

export function timelineVisitScope(
  actor: AuthenticatedUser,
  familyId: string,
  patientId: string,
): Prisma.EncounterWhereInput {
  const roleFilter: Prisma.EncounterWhereInput =
    actor.role === 'DOCTOR'
      ? {
          OR: [
            doctorVisitScope(actor.id),
            { clinicalEmrs: { some: { patientId, isFinalized: true } } },
          ],
        }
      : visitScope(actor);
  return { AND: [roleFilter, patientEncounterFilter(familyId, patientId)] };
}

function documentScope(
  actor: AuthenticatedUser,
  familyId: string,
  patientId: string,
): Prisma.PatientWhereInput {
  return {
    id: patientId,
    familyId,
    familyUnit: familyScope(actor),
    ...(actor.role === 'DOCTOR'
      ? {
          contractMembers: {
            some: { contract: { ...assignedContract(actor), familyId } },
          },
        }
      : {}),
  };
}

const documentFolder = (patientId: string) => `medical-books/${patientId}`;

function storedDocumentExtension(patientId: string, key: string) {
  const allowedPrefixes = [
    `${documentFolder(patientId)}/`,
    `patient-documents/${patientId}/`,
  ];
  const matchedPrefix = allowedPrefixes.find((prefix) =>
    key.startsWith(prefix),
  );
  if (!matchedPrefix) return null;
  const ext =
    /^[-\w]+\.(pdf|png|jpe?g)$/i.exec(key.slice(matchedPrefix.length))?.[1]?.toLowerCase() ??
    null;
  return ext === 'jpeg' ? 'jpg' : ext;
}

function documentInfo(
  patientId: string,
  {
    fileUrl,
    ...record
  }: Prisma.PatientDocumentGetPayload<{ select: typeof documentSelect }>,
) {
  const downloadAvailable = Boolean(
    storedDocumentExtension(patientId, fileUrl),
  );
  return {
    ...record,
    fileUrl: downloadAvailable ? null : fileUrl,
    downloadAvailable,
  };
}

@Injectable()
export class MedicalBooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async families(actor: AuthenticatedUser, page: number) {
    const rows = await this.prisma.familyUnit.findMany({
      where: familyScope(actor),
      select: {
        id: true,
        representativeUser: { select: { fullName: true } },
        patients: {
          where: rosterScope(actor),
          select: patientSelect,
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ representativeUser: { fullName: 'asc' } }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    return {
      items: rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        representativeName: row.representativeUser.fullName,
        members: row.patients,
      })),
      hasNextPage: rows.length > PAGE_SIZE,
    };
  }

  async familyPrescriptionVisits(
    actor: AuthenticatedUser,
    familyId: string,
    date: string,
  ) {
    const family = await this.prisma.familyUnit.findFirst({
      where: { id: familyId, ...familyScope(actor) },
      select: { id: true },
    });
    if (!family)
      throw new NotFoundException('Không tìm thấy sổ khám gia đình.');
    const rows = await this.prisma.encounter.findMany({
      where: {
        AND: [
          visitScope(actor),
          {
            contract: { familyId },
            scheduledDate: new Date(`${date}T00:00:00Z`),
          },
        ],
      },
      select: {
        id: true,
        participants: {
          where: { patient: { familyId } },
          select: { patientId: true },
        },
        clinicalEmrs: {
          where: { patient: { familyId } },
          select: { patientId: true },
        },
      },
      orderBy: [{ scheduledTime: 'desc' }, { id: 'asc' }],
    });
    const visits = rows.flatMap(({ id, participants, clinicalEmrs }) => {
      const patientIds = new Set(
        [...participants, ...clinicalEmrs].map(({ patientId }) => patientId),
      );
      return [...patientIds].map((patientId) =>
        this.visitDetail(actor, id, patientId),
      );
    });
    return { items: await Promise.all(visits) };
  }

  async patientVisits(
    actor: AuthenticatedUser,
    familyId: string,
    patientId: string,
    page: number,
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId,
        familyId,
        familyUnit: familyScope(actor),
        ...rosterScope(actor, familyId),
      },
      select: { id: true },
    });
    if (!patient)
      throw new NotFoundException('Không tìm thấy sổ khám của thành viên này.');

    const scope = visitScope(actor);
    const rows = await this.prisma.encounter.findMany({
      where: {
        AND: [scope, patientEncounterFilter(familyId, patientId)],
      },
      select: {
        ...visitSelect,
        clinicalEmrs: {
          where: { patientId },
          select: { isFinalized: true, icd10Diagnosis: true },
          take: 1,
        },
      },
      orderBy: [
        { scheduledDate: 'desc' },
        { scheduledTime: 'desc' },
        { id: 'desc' },
      ],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    return {
      items: rows
        .slice(0, PAGE_SIZE)
        .map(({ clinicalEmrs, doctor, ...visit }) => {
          const clinicalEmr = clinicalEmrs[0];
          return {
            ...visit,
            doctorName: doctor.doctorName,
            isFinalized: clinicalEmr?.isFinalized ?? false,
            diagnosis: clinicalEmr?.icd10Diagnosis ?? null,
          };
        }),
      hasNextPage: rows.length > PAGE_SIZE,
    };
  }

  async patientDocuments(
    actor: AuthenticatedUser,
    familyId: string,
    patientId: string,
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: documentScope(actor, familyId, patientId),
      select: {
        id: true,
        documents: {
          select: documentSelect,
          orderBy: [{ recordedDate: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!patient)
      throw new NotFoundException(
        'Không tìm thấy tài liệu trong phạm vi chăm sóc hiện tại.',
      );
    await writeBusinessAudit(
      this.prisma,
      actor.id,
      'READ_PATIENT_DOCUMENTS',
      'Patient',
      patientId,
    );
    return patient.documents.map((record) => documentInfo(patientId, record));
  }

  async patientTimeline(
    actor: AuthenticatedUser,
    familyId: string,
    patientId: string,
    query: { cursor?: string; limit: number },
  ) {
    const cursor = decodeTimelineCursor(query.cursor);
    const patient = await this.prisma.patient.findFirst({
      where: documentScope(actor, familyId, patientId),
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException(
        'Không tìm thấy sổ khám của thành viên này.',
      );
    }

    const visitScopeWhere = timelineVisitScope(actor, familyId, patientId);
    const take = query.limit + 1;

    const [encounters, prescriptions, documents] = await Promise.all([
      this.prisma.encounter.findMany({
        where: { AND: [visitScopeWhere, encounterKeyset(cursor)] },
        select: {
          id: true,
          encounterType: true,
          scheduledDate: true,
          scheduledTime: true,
          doctor: { select: { doctorName: true, userId: true } },
          clinicalEmrs: {
            where: { patientId },
            select: { isFinalized: true, icd10Diagnosis: true },
            take: 1,
          },
        },
        orderBy: [
          { scheduledDate: 'desc' },
          { scheduledTime: 'desc' },
          { id: 'desc' },
        ],
        take,
      }),
      this.prisma.prescription.findMany({
        where: {
          AND: [
            { clinicalEmr: { patientId, encounter: visitScopeWhere } },
            actor.role === 'DOCTOR'
              ? { status: { in: ['ISSUED', 'EXPIRED'] } }
              : { recipientUserId: actor.id },
            dateTimeKeyset('createdAt', cursor),
          ],
        },
        select: {
          id: true,
          prescriptionCode: true,
          createdAt: true,
          clinicalEmr: {
            select: {
              encounterId: true,
              encounter: {
                select: {
                  doctor: { select: { doctorName: true, userId: true } },
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.patientDocument.findMany({
        where: { patientId, ...dateKeyset('recordedDate', cursor) },
        select: documentSelect,
        orderBy: [{ recordedDate: 'desc' }, { id: 'desc' }],
        take,
      }),
    ]);

    await writeBusinessAudit(
      this.prisma,
      actor.id,
      'READ_PATIENT_TIMELINE',
      'Patient',
      patientId,
    );

    const merged = mergeTimelineEvents(
      [
        encounters.map((row) => visitEvent(actor, row)),
        prescriptions.map((row) => prescriptionEvent(actor, row)),
        documents.map((record) => documentEvent(patientId, record)),
      ],
      query.limit,
    );
    return {
      items: merged.items.map((item) => ({
        ...item,
        occurredAt: item.occurredAt.toISOString(),
      })),
      nextCursor: merged.nextCursor,
    };
  }

  async uploadDocument(
    actor: AuthenticatedUser,
    familyId: string,
    patientId: string,
    dto: UploadBookDocumentDto,
    file: Express.Multer.File,
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: documentScope(actor, familyId, patientId),
      select: { id: true },
    });
    if (!patient)
      throw new NotFoundException('Không tìm thấy hồ sơ của thành viên này.');
    const verified = validateUploadedDocumentFile(file);
    let key: string;
    try {
      key = await this.storage.uploadFile(
        {
          ...file,
          mimetype: verified.contentType,
          originalname: `document.${verified.extension}`,
        },
        documentFolder(patientId),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Chưa tải được tài liệu lên kho lưu trữ.',
      );
    }
    const stored = await this.prisma.$transaction(async (tx) => {
      const record = await tx.patientDocument.create({
        data: {
          ...dto,
          patientId,
          fileUrl: key,
          fileSizeKb: Math.ceil(verified.buffer.length / 1024),
          recordedDate: new Date(`${dto.recordedDate}T00:00:00Z`),
        },
        select: documentSelect,
      });
      await writeBusinessAudit(
        tx,
        actor.id,
        'UPLOAD_PATIENT_DOCUMENT',
        'PatientDocument',
        record.id,
      );
      return record;
    });
    return documentInfo(patientId, stored);
  }

  async downloadDocument(
    actor: AuthenticatedUser,
    familyId: string,
    patientId: string,
    id: string,
  ) {
    const record = await this.prisma.patientDocument.findFirst({
      where: { id, patient: documentScope(actor, familyId, patientId) },
      select: { fileUrl: true },
    });
    const extension =
      record && storedDocumentExtension(patientId, record.fileUrl);
    if (!record || !extension)
      throw new NotFoundException('Không tìm thấy tệp của thành viên này.');
    const { bytes } = await this.storage.downloadFile(record.fileUrl);
    await writeBusinessAudit(
      this.prisma,
      actor.id,
      'DOWNLOAD_PATIENT_DOCUMENT',
      'PatientDocument',
      id,
    );
    return { bytes, extension };
  }

  async visitDetail(actor: AuthenticatedUser, id: string, patientId?: string) {
    const isDoctor = actor.role === 'DOCTOR';
    const prescriptionSelect = {
      id: true,
      prescriptionCode: true,
      status: true,
      instructions: true,
      clinicalContext: true,
      prescribedDate: true,
      validUntil: true,
      recordSnapshot: true,
      discontinuedMedications: true,
      replacementReason: true,
      replaces: { select: { id: true, prescriptionCode: true } },
      replacedBy: { select: { id: true, prescriptionCode: true } },
      details: {
        omit: { prescriptionId: true, lineNumber: true },
        orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
      },
    } satisfies Prisma.PrescriptionSelect;
    const visit = await this.prisma.encounter.findFirst({
      where: { id, ...visitScope(actor) },
      select: {
        ...visitSelect,
        visitScope: true,
        participants: {
          select: { patient: { select: { ...patientSelect, familyId: true, gender: true } } },
        },
        doctor: {
          select: {
            doctorName: true,
            facility: { select: { facilityName: true, address: true } },
            user: { select: { phone: true } },
          },
        },
        contract: {
          select: {
            familyId: true,
            familyUnit: {
              select: {
                representativeUser: {
                  select: {
                    id: true,
                    fullName: true,
                    role: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        clinicalEmrs: {
          where: patientId ? { patientId } : undefined,
          orderBy: [{ createdAt: 'asc' }],
          take: 1,
          select: {
            id: true,
            patientId: true,
            patient: { select: { ...patientSelect, familyId: true, gender: true } },
            chiefComplaint: true,
            anamnesis: true,
            informantName: true,
            informantRelation: true,
            personalHistory: true,
            familyHistory: true,
            medicationAdherence: true,
            generalExam: true,
            clinicalFindings: true,
            icd10Code: true,
            icd10Diagnosis: true,
            treatmentPlan: true,
            selfCareNotes: true,
            progression: true,
            followUpDate: true,
            isFinalized: true,
            finalizedAt: true,
            diagnoses: {
              orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                icd10Code: true,
                nameSnapshot: true,
                isPrimary: true,
                lineNumber: true,
              },
            },
            homeMedications: {
              orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                medicationName: true,
                source: true,
                assessment: true,
                notes: true,
                lineNumber: true,
              },
            },
            vitalSigns: {
              orderBy: [{ recordedAt: 'desc' }],
              take: 1,
              select: {
                systolicBp: true,
                diastolicBp: true,
                heartRate: true,
                temperature: true,
                spo2: true,
                respiratoryRate: true,
                weightKg: true,
                heightCm: true,
                recordedAt: true,
              },
            },
            prescriptions: {
              where: isDoctor ? undefined : { recipientUserId: actor.id },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: prescriptionSelect,
            },
          },
        },
      },
    });
    const clinicalEmr = visit?.clinicalEmrs[0] ?? null;
    const resolvedPatient =
      clinicalEmr?.patient ??
      (patientId
        ? visit?.participants.find((p) => p.patient.id === patientId)?.patient
        : visit?.participants[0]?.patient) ??
      null;
    if (!visit || !resolvedPatient || resolvedPatient.familyId !== visit.contract.familyId) {
      throw new NotFoundException(
        'Không tìm thấy trang khám trong phạm vi của bạn.',
      );
    }
    const { clinicalEmrs: _emrs, participants, contract, doctor, ...entry } = visit;
    const recipient = contract.familyUnit.representativeUser;
    const prescription = clinicalEmr?.prescriptions[0];
    const mapVitals = (
      row: {
        systolicBp: number | null;
        diastolicBp: number | null;
        heartRate: number | null;
        temperature: unknown;
        spo2: number | null;
        respiratoryRate: number | null;
        weightKg: unknown;
        heightCm?: unknown;
        recordedAt: Date;
      },
      source: 'DRAFT' | 'PREVIOUS',
    ) => ({
      systolicBp: row.systolicBp,
      diastolicBp: row.diastolicBp,
      heartRate: row.heartRate,
      temperature:
        row.temperature !== null && row.temperature !== undefined
          ? Number(row.temperature)
          : null,
      spo2: row.spo2,
      respiratoryRate: row.respiratoryRate,
      weightKg:
        row.weightKg !== null && row.weightKg !== undefined
          ? Number(row.weightKg)
          : null,
      ...(row.heightCm !== undefined
        ? {
            heightCm:
              row.heightCm !== null ? Number(row.heightCm) : null,
          }
        : {}),
      recordedAt: row.recordedAt,
      source,
    });
    const emrVital = clinicalEmr?.vitalSigns?.[0];
    let vitals: ReturnType<typeof mapVitals> | null = null;
    if (emrVital && (isDoctor || clinicalEmr?.isFinalized)) {
      vitals = mapVitals(emrVital, 'DRAFT');
    } else if (isDoctor) {
      const previousVital = await this.prisma.vitalSign.findFirst({
        where: { patientId: resolvedPatient.id },
        orderBy: { recordedAt: 'desc' },
        select: {
          systolicBp: true,
          diastolicBp: true,
          heartRate: true,
          temperature: true,
          spo2: true,
          respiratoryRate: true,
          weightKg: true,
          heightCm: true,
          recordedAt: true,
        },
      });
      if (previousVital) {
        vitals = mapVitals(previousVital, 'PREVIOUS');
      }
    }
    // Đơn đang dùng = đơn ISSUED gần nhất của người bệnh ở lần khám trước,
    // chưa bị đơn nào thay (replacedBy = null). Dùng để kê đơn nối tiếp.
    const activePrescriptionRecord = isDoctor
      ? await this.prisma.prescription.findFirst({
          where: {
            status: 'ISSUED',
            replacedBy: { is: null },
            clinicalEmr: {
              patientId: resolvedPatient.id,
              encounterId: { not: visit.id },
            },
          },
          orderBy: [{ prescribedDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            prescriptionCode: true,
            status: true,
            prescribedDate: true,
            validUntil: true,
            details: {
              omit: { prescriptionId: true, lineNumber: true },
              orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
            },
          },
        })
      : null;
    if (clinicalEmr) {
      await writeBusinessAudit(
        this.prisma,
        actor.id,
        'READ_VISIT_RECORD',
        'ClinicalEmr',
        clinicalEmr.id,
      );
    }
    const sameEmrHistory = clinicalEmr?.prescriptions.slice(1) ?? [];
    const seenIds = new Set<string>();
    const sameEmrById = new Map<string, NonNullable<typeof prescription>>();
    if (prescription) {
      seenIds.add(prescription.id);
    }
    for (const item of sameEmrHistory) {
      seenIds.add(item.id);
      sameEmrById.set(item.id, item);
    }
    const chainedPredecessors: NonNullable<typeof prescription>[] = [];
    let cursorReplacesId: string | null = prescription?.replaces?.id ?? null;
    while (cursorReplacesId && chainedPredecessors.length < 10) {
      if (seenIds.has(cursorReplacesId)) {
        const inSameEmr = sameEmrById.get(cursorReplacesId);
        if (!inSameEmr) break;
        cursorReplacesId = inSameEmr.replaces?.id ?? null;
        continue;
      }
      const prev = await this.prisma.prescription.findFirst({
        where: {
          id: cursorReplacesId,
          clinicalEmr: { patientId: resolvedPatient.id },
          ...(isDoctor ? {} : { recipientUserId: actor.id }),
        },
        select: prescriptionSelect,
      });
      if (!prev) break;
      seenIds.add(prev.id);
      chainedPredecessors.push(prev);
      cursorReplacesId = prev.replaces?.id ?? null;
    }
    const prescriptionView = (record: NonNullable<typeof prescription>) => ({
      ...record,
      status:
        record.status === 'ISSUED' &&
        record.validUntil &&
        record.validUntil.toISOString().slice(0, 10) <
          new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
          ? 'EXPIRED'
          : record.status,
    });
    return {
      ...entry,
      participants: participants.map((p) => ({
        id: p.patient.id,
        fullName: p.patient.fullName,
      })),
      patient: {
        id: resolvedPatient.id,
        fullName: resolvedPatient.fullName,
        dateOfBirth: resolvedPatient.dateOfBirth,
        relationshipToHead: resolvedPatient.relationshipToHead,
      },
      doctorName: doctor.doctorName,
      facility: { ...doctor.facility, phone: doctor.user.phone },
      recipient:
        isDoctor &&
        recipient.role === 'FAMILY_REP' &&
        recipient.status === 'ACTIVE'
          ? { id: recipient.id, name: recipient.fullName }
          : null,
      isFinalized: clinicalEmr?.isFinalized ?? false,
      finalizedAt: clinicalEmr?.finalizedAt ?? null,
      exam: clinicalEmr
        ? {
            chiefComplaint: clinicalEmr.chiefComplaint,
            anamnesis: clinicalEmr.anamnesis ?? null,
            informantName: clinicalEmr.informantName ?? null,
            informantRelation: clinicalEmr.informantRelation ?? null,
            personalHistory: clinicalEmr.personalHistory ?? null,
            familyHistory: clinicalEmr.familyHistory ?? null,
            medicationAdherence: clinicalEmr.medicationAdherence ?? null,
            generalExam: clinicalEmr.generalExam ?? null,
            clinicalFindings: clinicalEmr.clinicalFindings,
            icd10Code: clinicalEmr.icd10Code,
            icd10Diagnosis: clinicalEmr.icd10Diagnosis,
            treatmentPlan: clinicalEmr.treatmentPlan,
            selfCareNotes: clinicalEmr.selfCareNotes ?? null,
          }
        : null,
      diagnoses: clinicalEmr?.diagnoses ?? [],
      homeMedications: clinicalEmr?.homeMedications ?? [],
      followUpDate: clinicalEmr?.followUpDate ?? null,
      progression: clinicalEmr?.progression ?? null,
      prescription: prescription ? prescriptionView(prescription) : null,
      prescriptionHistory: [...sameEmrHistory, ...chainedPredecessors].map(
        prescriptionView,
      ),
      activePrescription: activePrescriptionRecord,
      vitals,
    };
  }

  private async resolveDoctorVisit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    encounterId: string,
  ) {
    const vietnamNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const visit = await tx.encounter.findFirst({
      where: {
        id: encounterId,
        ...doctorVisitScope(actor.id, vietnamNow),
      },
      select: {
        id: true,
        contractId: true,
        encounterStatus: true,
        contract: { select: { familyId: true } },
      },
    });
    if (!visit) {
      const pendingVisit = await tx.encounter.findFirst({
        where: {
          id: encounterId,
          doctor: activePrescribingDoctor(actor.id),
        },
        select: { encounterStatus: true },
      });
      if (pendingVisit?.encounterStatus === 'CONFIRMED') {
        const msg = 'Chưa đến giờ khám, chưa thể ghi thông tin buổi khám.';
        throw new BaseApiException({
          errorCode: EncounterRecordErrorCode.VISIT_NOT_STARTED,
          status: HttpStatus.CONFLICT,
          message: msg,
          detail: msg,
          conditions: [
            {
              code: 'VISIT_NOT_STARTED',
              condition: 'Buổi khám phải đến giờ bắt đầu',
              message: msg,
            },
          ],
        });
      }
      throw new NotFoundException(
        'Không tìm thấy buổi khám trong phạm vi của bạn.',
      );
    }
    if (
      visit.encounterStatus === 'DISPUTED' ||
      visit.encounterStatus === 'NO_SHOW' ||
      visit.encounterStatus === 'CANCELLED'
    ) {
      throw new ConflictException({
        code: 'VISIT_LOCKED',
        message:
          'Ca khám đang bị khóa (khiếu nại/vắng mặt), không thể ghi thông tin buổi khám.',
      });
    }
    return visit;
  }

  async homeEnvironment(actor: AuthenticatedUser, encounterId: string) {
    const visit = await this.prisma.encounter.findFirst({
      where: {
        id: encounterId,
        doctor: activePrescribingDoctor(actor.id),
      },
      select: {
        id: true,
        homeEnvironment: {
          select: {
            id: true,
            encounterId: true,
            visitAddress: true,
            primaryInformantName: true,
            housingNotes: true,
            fallRisk: true,
            waterSource: true,
            smokingInHouse: true,
            pets: true,
            notes: true,
            updatedAt: true,
          },
        },
        participants: {
          select: {
            patientId: true,
            attendanceStatus: true,
            absenceReason: true,
            patient: {
              select: { id: true, fullName: true },
            },
          },
        },
      },
    });
    if (!visit) {
      throw new NotFoundException(
        'Không tìm thấy buổi khám trong phạm vi của bạn.',
      );
    }
    return {
      encounterId: visit.id,
      homeEnvironment: visit.homeEnvironment ?? null,
      participants: visit.participants.map((p) => ({
        patientId: p.patientId,
        fullName: p.patient.fullName,
        attendanceStatus: p.attendanceStatus,
        absenceReason: p.absenceReason,
      })),
    };
  }

  async saveHomeEnvironment(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: SaveHomeEnvironmentDto,
  ) {
    const participantsInput = dto.participants ?? [];
    for (let i = 0; i < participantsInput.length; i += 1) {
      const p = participantsInput[i];
      if (p.attendanceStatus === 'ABSENT') {
        const reason = (p.absenceReason ?? '').trim();
        if (reason.length < 3 || reason.length > 255) {
          throw new BaseApiException({
            errorCode: ValidationErrorCode.VALIDATION_FAILED,
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            message: 'Vui lòng ghi lý do vắng mặt.',
            detail: 'Vui lòng ghi lý do vắng mặt.',
            invalidParams: [
              {
                field: `participants[${i}].absenceReason`,
                issue:
                  reason.length === 0
                    ? ValidationIssue.REQUIRED
                    : reason.length < 3
                      ? ValidationIssue.MIN_LENGTH
                      : ValidationIssue.MAX_LENGTH,
                message: 'Vui lòng ghi lý do vắng mặt.',
              },
            ],
          });
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const visit = await this.resolveDoctorVisit(tx, actor, encounterId);

      const envFields = [
        'visitAddress',
        'primaryInformantName',
        'housingNotes',
        'fallRisk',
        'waterSource',
        'smokingInHouse',
        'pets',
        'notes',
      ] as const;

      const previousEnv = dto.copyFromPreviousVisit
        ? await tx.encounterHomeEnvironment.findFirst({
            where: {
              encounter: {
                contractId: visit.contractId,
                id: { not: encounterId },
              },
            },
            orderBy: [
              { encounter: { scheduledDate: 'desc' } },
              { encounter: { scheduledTime: 'desc' } },
              { updatedAt: 'desc' },
            ],
            select: {
              visitAddress: true,
              primaryInformantName: true,
              housingNotes: true,
              fallRisk: true,
              waterSource: true,
              smokingInHouse: true,
              pets: true,
              notes: true,
            },
          })
        : null;

      const envPayload: Record<string, unknown> = {};
      for (const field of envFields) {
        if (dto[field] !== undefined) {
          envPayload[field] = dto[field];
        } else if (previousEnv && previousEnv[field] !== undefined) {
          envPayload[field] = previousEnv[field];
        }
      }

      const homeEnvironment = await tx.encounterHomeEnvironment.upsert({
        where: { encounterId },
        create: {
          encounterId,
          ...envPayload,
        },
        update: envPayload,
      });

      const savedParticipants = [];
      if (participantsInput.length > 0) {
        const patientIds = Array.from(
          new Set(participantsInput.map((p) => p.patientId)),
        );
        const members = await tx.patient.findMany({
          where: {
            id: { in: patientIds },
            familyId: visit.contract.familyId,
          },
          select: { id: true },
        });
        const memberSet = new Set(members.map((m) => m.id));
        if (patientIds.some((pid) => !memberSet.has(pid))) {
          throw new NotFoundException(
            'Không tìm thấy thành viên trong gia đình của buổi khám này.',
          );
        }

        const existingParticipants = await tx.encounterParticipant.findMany({
          where: {
            encounterId,
            patientId: { in: patientIds },
          },
          select: { patientId: true, attendanceStatus: true },
        });
        const existingMap = new Map(
          existingParticipants.map((e) => [e.patientId, e.attendanceStatus]),
        );

        for (const p of participantsInput) {
          const existingStatus = existingMap.get(p.patientId);
          if (p.attendanceStatus === 'ABSENT' && existingStatus === 'EXAMINED') {
            throw new BaseApiException({
              errorCode: EncounterRecordErrorCode.VISIT_RECORD_LOCKED,
              status: HttpStatus.CONFLICT,
              message: 'Thành viên đã được khám, không thể chuyển sang vắng mặt.',
              detail: 'Thành viên đã được khám, không thể chuyển sang vắng mặt.',
            });
          }
          if (
            existingStatus === 'EXAMINED' &&
            (p.attendanceStatus === 'PLANNED' || p.attendanceStatus === 'PRESENT')
          ) {
            // Giữ nguyên trạng thái EXAMINED của thành viên đã chốt hồ sơ khám
            continue;
          }
          const absenceReason =
            p.attendanceStatus === 'ABSENT' ? p.absenceReason!.trim() : null;
          const saved = await tx.encounterParticipant.upsert({
            where: {
              encounterId_patientId: {
                encounterId,
                patientId: p.patientId,
              },
            },
            create: {
              encounterId,
              patientId: p.patientId,
              attendanceStatus: p.attendanceStatus,
              absenceReason,
            },
            update: {
              attendanceStatus: p.attendanceStatus,
              absenceReason,
            },
          });
          savedParticipants.push(saved);
        }
      }

      return { homeEnvironment, participants: savedParticipants };
    });
  }
}
