import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { writeBusinessAudit } from '../../../core/business/business-helpers';
import { PrismaService } from '../../../core/database/prisma.service';
import { StorageService } from '../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../core/validation/document-file.validator';
import type { UploadBookDocumentDto } from '../dtos/share-prescription.dto';
import {
  activePrescribingDoctor,
  doctorVisitScope,
} from './prescriptions.service';

const PAGE_SIZE = 12;
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
        clinicalEmrs: {
          some: {
            isFinalized: true,
            patient: { familyUnit: { representativeUserId: actor.id } },
          },
        },
      };
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
  const prefix = `${documentFolder(patientId)}/`;
  if (!key.startsWith(prefix)) return null;
  return /^[-\w]+\.(pdf|png|jpg)$/.exec(key.slice(prefix.length))?.[1] ?? null;
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
        AND: [
          scope,
          {
            contract: { familyId },
            OR: [
              { participants: { some: { patientId } } },
              { clinicalEmrs: { some: { patientId } } },
            ],
          },
        ],
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
            clinicalFindings: true,
            icd10Code: true,
            icd10Diagnosis: true,
            treatmentPlan: true,
            isFinalized: true,
            finalizedAt: true,
            prescriptions: {
              where: isDoctor ? undefined : { recipientUserId: actor.id },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                prescriptionCode: true,
                status: true,
                instructions: true,
                clinicalContext: true,
                prescribedDate: true,
                validUntil: true,
                recordSnapshot: true,
                replacementReason: true,
                replaces: { select: { id: true, prescriptionCode: true } },
                replacedBy: { select: { id: true, prescriptionCode: true } },
                details: {
                  omit: { prescriptionId: true, lineNumber: true },
                  orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
                },
              },
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
    if (clinicalEmr) {
      await writeBusinessAudit(
        this.prisma,
        actor.id,
        'READ_VISIT_RECORD',
        'ClinicalEmr',
        clinicalEmr.id,
      );
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
            clinicalFindings: clinicalEmr.clinicalFindings,
            icd10Code: clinicalEmr.icd10Code,
            icd10Diagnosis: clinicalEmr.icd10Diagnosis,
            treatmentPlan: clinicalEmr.treatmentPlan,
          }
        : null,
      prescription: prescription ? prescriptionView(prescription) : null,
      prescriptionHistory:
        clinicalEmr?.prescriptions.slice(1).map(prescriptionView) ?? [],
    };
  }
}
