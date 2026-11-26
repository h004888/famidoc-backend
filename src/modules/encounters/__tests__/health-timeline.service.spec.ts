import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  MedicalBooksService,
  timelineVisitScope,
} from '../services/medical-books.service';
import {
  decodeTimelineCursor,
  encounterKeyset,
} from '../services/timeline.util';

describe('MedicalBooksService.patientTimeline', () => {
  const familyActor = { id: 'rep-1', role: 'FAMILY_REP' } as any;
  const doctorActor = { id: 'doc-user-1', role: 'DOCTOR' } as any;

  function makeService() {
    const prisma = {
      patient: { findFirst: jest.fn() },
      encounter: { findMany: jest.fn() },
      prescription: { findMany: jest.fn() },
      patientDocument: { findMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const service = new MedicalBooksService(prisma as any, {} as any);
    return { service, prisma };
  }

  it('throws NotFoundException when patient is out of scope and skips queries', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue(null);

    await expect(
      service.patientTimeline(familyActor, 'fam-1', 'pat-1', { limit: 20 }),
    ).rejects.toThrow(
      new NotFoundException('Không tìm thấy sổ khám của thành viên này.'),
    );
    expect(prisma.encounter.findMany).not.toHaveBeenCalled();
  });

  it('queries with family scopes, clinicalEmr relation, and writes READ_PATIENT_TIMELINE audit', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([]);
    prisma.prescription.findMany.mockResolvedValue([]);
    prisma.patientDocument.findMany.mockResolvedValue([]);

    const result = await service.patientTimeline(
      familyActor,
      'fam-1',
      'pat-1',
      { limit: 20 },
    );

    expect(result).toEqual({ items: [], nextCursor: null });

    const encCall = prisma.encounter.findMany.mock.calls[0][0];
    expect(encCall.where.AND[0]).toEqual(
      timelineVisitScope(familyActor, 'fam-1', 'pat-1'),
    );

    const rxCall = prisma.prescription.findMany.mock.calls[0][0];
    expect(rxCall.where.AND[0]).toEqual({
      clinicalEmr: {
        patientId: 'pat-1',
        encounter: timelineVisitScope(familyActor, 'fam-1', 'pat-1'),
      },
    });
    expect(rxCall.where.AND[1]).toEqual({ recipientUserId: 'rep-1' });
    expect(rxCall.select.clinicalEmr).toBeDefined();
    expect(rxCall.select.emr).toBeUndefined();

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'READ_PATIENT_TIMELINE',
        }),
      }),
    );
  });

  it('filters prescriptions by ISSUED/EXPIRED for DOCTOR', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([]);
    prisma.prescription.findMany.mockResolvedValue([]);
    prisma.patientDocument.findMany.mockResolvedValue([]);

    await service.patientTimeline(doctorActor, 'fam-1', 'pat-1', { limit: 20 });

    const rxCall = prisma.prescription.findMany.mock.calls[0][0];
    expect(rxCall.where.AND[1]).toEqual({
      status: { in: ['ISSUED', 'EXPIRED'] },
    });
  });

  it('maps encounter, document, and prescription events in descending order', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([
      {
        id: 'enc-1',
        encounterType: 'HOME_VISIT',
        scheduledDate: new Date('2026-11-20T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
        doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' },
        clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'Viêm họng cấp' }],
      },
    ]);
    prisma.patientDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        documentName: 'X-quang phổi',
        documentType: 'IMAGING_XRAY_CT',
        fileUrl: 'medical-books/pat-1/abc.png',
        recordedDate: new Date('2026-11-19T00:00:00.000Z'),
      },
    ]);
    prisma.prescription.findMany.mockResolvedValue([
      {
        id: 'rx-1',
        prescriptionCode: 'DT001',
        createdAt: new Date('2026-11-21T02:00:00.000Z'),
        clinicalEmr: {
          encounterId: 'enc-1',
          encounter: {
            doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' },
          },
        },
      },
    ]);

    const result = await service.patientTimeline(
      familyActor,
      'fam-1',
      'pat-1',
      { limit: 20 },
    );

    expect(result.items.map((item) => item.id)).toEqual([
      'rx-1',
      'enc-1',
      'doc-1',
    ]);
    expect(result.items[0]).toEqual({
      id: 'rx-1',
      type: 'PRESCRIPTION',
      occurredAt: '2026-11-21T02:00:00.000Z',
      title: 'Đơn thuốc',
      summary: 'Mã đơn DT001',
      actorName: 'BS. Minh',
      source: 'CLINICAL',
      link: { encounterId: 'enc-1' },
      canOpenDetail: true,
      attachments: [],
    });
    expect(result.items[1]).toEqual({
      id: 'enc-1',
      type: 'VISIT',
      occurredAt: '2026-11-20T08:30:00.000Z',
      title: 'Khám tại nhà',
      summary: 'Viêm họng cấp',
      actorName: 'BS. Minh',
      source: 'CLINICAL',
      link: { encounterId: 'enc-1' },
      canOpenDetail: true,
      attachments: [],
    });
    expect(result.items[2]).toEqual({
      id: 'doc-1',
      type: 'DOCUMENT',
      occurredAt: '2026-11-19T00:00:00.000Z',
      title: 'X-quang phổi',
      summary: null,
      actorName: null,
      source: 'FAMILY_UPLOAD',
      link: { documentId: 'doc-1' },
      canOpenDetail: false,
      attachments: [
        {
          id: 'doc-1',
          name: 'X-quang phổi',
          downloadAvailable: true,
          isImage: true,
        },
      ],
    });
  });

  it('sets canOpenDetail only for doctor own encounters and prescriptions (D4)', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([
      {
        id: 'enc-own',
        encounterType: 'TELEHEALTH',
        scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
        doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' },
        clinicalEmrs: [{ isFinalized: false, icd10Diagnosis: 'Chưa chốt' }],
      },
      {
        id: 'enc-other',
        encounterType: 'FACILITY_VISIT',
        scheduledDate: new Date('2026-11-20T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        doctor: { doctorName: 'BS. Lan', userId: 'doc-user-2' },
        clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'Tăng huyết áp' }],
      },
    ]);
    prisma.prescription.findMany.mockResolvedValue([
      {
        id: 'rx-other',
        prescriptionCode: 'DT002',
        createdAt: new Date('2026-11-20T10:00:00.000Z'),
        clinicalEmr: {
          encounterId: 'enc-other',
          encounter: {
            doctor: { doctorName: 'BS. Lan', userId: 'doc-user-2' },
          },
        },
      },
    ]);
    prisma.patientDocument.findMany.mockResolvedValue([]);

    const result = await service.patientTimeline(
      doctorActor,
      'fam-1',
      'pat-1',
      { limit: 20 },
    );

    const encOwn = result.items.find((i) => i.id === 'enc-own')!;
    const encOther = result.items.find((i) => i.id === 'enc-other')!;
    const rxOther = result.items.find((i) => i.id === 'rx-other')!;

    expect(encOwn.canOpenDetail).toBe(true);
    expect(encOther.canOpenDetail).toBe(false);
    expect(encOther.summary).toBe('Tăng huyết áp');
    expect(encOther.actorName).toBe('BS. Lan');
    expect(rxOther.canOpenDetail).toBe(false);
  });

  it('paginates with cursor keysets and rejects invalid cursor', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([
      {
        id: 'enc-2',
        encounterType: 'HOME_VISIT',
        scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
        doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' },
        clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'A' }],
      },
      {
        id: 'enc-1',
        encounterType: 'HOME_VISIT',
        scheduledDate: new Date('2026-11-20T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' },
        clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'B' }],
      },
    ]);
    prisma.prescription.findMany.mockResolvedValue([]);
    prisma.patientDocument.findMany.mockResolvedValue([]);

    const page1 = await service.patientTimeline(familyActor, 'fam-1', 'pat-1', {
      limit: 1,
    });

    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    expect(prisma.encounter.findMany.mock.calls[0][0].take).toBe(2);
    expect(prisma.prescription.findMany.mock.calls[0][0].take).toBe(2);
    expect(prisma.patientDocument.findMany.mock.calls[0][0].take).toBe(2);

    await service.patientTimeline(familyActor, 'fam-1', 'pat-1', {
      limit: 1,
      cursor: page1.nextCursor!,
    });

    expect(prisma.encounter.findMany.mock.calls[1][0].where.AND[1]).toEqual(
      encounterKeyset(decodeTimelineCursor(page1.nextCursor!)),
    );

    await expect(
      service.patientTimeline(familyActor, 'fam-1', 'pat-1', {
        limit: 1,
        cursor: 'rac',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
