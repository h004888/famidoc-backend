import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
} from '@prisma/client';
import { AutoScheduleFirstVisitService } from '../services/impl/auto-schedule-first-visit.service';
import { calculateCadenceDates } from '../services/impl/encounters.service.impl';
import { parseEncounterScheduleMeta } from '../utils/encounter-schedule-meta.util';
import { SlotLedgerService } from '../../scheduling/slot-ledger.service';

describe('AutoScheduleFirstVisitService (Two-Slot Auto-Confirm & Exceptions)', () => {
  let service: AutoScheduleFirstVisitService;
  let mockTx: any;
  let ledger: jest.Mocked<Pick<SlotLedgerService, 'confirmContract' | 'attachEncounter' | 'listOccupied' | 'listFamilyBusyDates' | 'hold' | 'releaseContractHolds'>>;

  const baseContract = {
    id: 'contract-1',
    contractNumber: 'MC-2026-001',
    doctorId: 'doctor-1',
    familyId: 'family-1',
    remainingHomeVisits: 2,
    remainingTelehealth: 2,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: new Date('2027-01-05T00:00:00.000Z'),
    servicePackage: {
      durationMonths: 12,
      periodicVisitsQuota: 2,
    },
    familyUnit: {
      homeAddress: '12 Kim Mã, Ba Đình, Hà Nội',
      representativeUserId: 'user-fam-1',
      representativeUser: { fullName: 'Nguyễn Văn An' },
    },
    doctor: {
      doctorName: 'BS. Trần Thanh Mai',
      user: { id: 'user-doc-1' },
    },
    facility: { userId: 'user-fac-1' },
    members: [{ patientId: 'pat-1' }, { patientId: 'pat-2' }],
  };

  beforeEach(() => {
    ledger = {
      confirmContract: jest.fn().mockResolvedValue([]),
      attachEncounter: jest.fn().mockResolvedValue(undefined),
      listOccupied: jest.fn().mockResolvedValue([]),
      listFamilyBusyDates: jest.fn().mockResolvedValue([]),
      hold: jest.fn().mockResolvedValue(undefined),
      releaseContractHolds: jest.fn().mockResolvedValue(undefined),
    };
    service = new AutoScheduleFirstVisitService(ledger as unknown as SlotLedgerService);
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue(baseContract),
      },
      encounter: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `enc-${Math.random()}`, ...data }),
        ),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
  });

  const heldBookings = [
    { id: 'bk-1', doctorId: 'doctor-1', contractId: 'contract-1', encounterId: null, status: 'BOOKED', date: '2026-01-06', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
    { id: 'bk-2', doctorId: 'doctor-1', contractId: 'contract-1', encounterId: null, status: 'BOOKED', date: '2026-01-13', slotWindow: 'AFTERNOON', visitType: 'VIDEO' },
    { id: 'bk-3', doctorId: 'doctor-1', contractId: 'contract-1', encounterId: null, status: 'BOOKED', date: '2026-01-20', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
    { id: 'bk-4', doctorId: 'doctor-1', contractId: 'contract-1', encounterId: null, status: 'BOOKED', date: '2026-01-27', slotWindow: 'AFTERNOON', visitType: 'VIDEO' },
  ];

  it('(a) chỉ xác nhận ca khám tại nhà → tạo 2 encounter HOME_VISIT, bỏ qua ca video', async () => {
    ledger.confirmContract.mockResolvedValueOnce(heldBookings as any);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(ledger.confirmContract).toHaveBeenCalledTimes(1);
    expect(ledger.confirmContract).toHaveBeenCalledWith(mockTx, 'contract-1', {
      doctorId: 'doctor-1',
      minDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      onlyVisitType: 'HOME_VISIT',
    });
    expect(ledger.hold).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(mockTx.encounter.create).toHaveBeenCalledTimes(2);
    expect(ledger.attachEncounter).toHaveBeenCalledTimes(2);

    const datas = mockTx.encounter.create.mock.calls.map((c: any) => c[0].data);
    expect(datas.map((d: any) => d.encounterType)).toEqual([
      EncounterType.HOME_VISIT,
      EncounterType.HOME_VISIT,
    ]);
    expect(datas[0]).toEqual(
      expect.objectContaining({
        contractId: 'contract-1',
        doctorId: 'doctor-1',
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope: EncounterVisitScope.FAMILY,
        encounterStatus: EncounterStatus.CONFIRMED,
        slotWindow: 'MORNING',
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
      }),
    );
    expect(datas[1].scheduledDate.toISOString().slice(0, 10)).toBe('2026-01-20');
    expect(datas[0].scheduledDate.toISOString().slice(0, 10)).toBe('2026-01-06');

    const parsed = parseEncounterScheduleMeta(datas[0]);
    expect(parsed.scheduleStage).toBe('CONFIRMED');
    expect(parsed.milestoneIndex).toBe(1);
    expect(parsed.totalMilestones).toBe(2);

    const attachedPairs = ledger.attachEncounter.mock.calls.map((c) => c[1]);
    expect(attachedPairs).toEqual(['bk-1', 'bk-3']);
    expect(mockTx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.notification.createMany.mock.calls[0][0].data.every(
      (n: any) => n.type === 'ENCOUNTER_AUTO_CONFIRMED',
    )).toBe(true);
  });

  it('(b) không còn HELD (hold hết hạn) → chạy lại planner, hold rồi confirmContract', async () => {
    ledger.confirmContract
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(heldBookings as any);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(ledger.listOccupied).toHaveBeenCalledTimes(1);
    expect(ledger.hold).toHaveBeenCalledTimes(1);
    const holdArg = ledger.hold.mock.calls[0][1];
    expect(holdArg.doctorId).toBe('doctor-1');
    expect(holdArg.contractId).toBe('contract-1');
    expect(holdArg.slots).toHaveLength(2);
    expect(holdArg.slots.every((s: any) => s.visitType === 'HOME_VISIT')).toBe(true);
    expect(ledger.confirmContract).toHaveBeenCalledTimes(2);
    expect(
      ledger.hold.mock.invocationCallOrder[0] < ledger.confirmContract.mock.invocationCallOrder[1],
    ).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('(c) planner INSUFFICIENT_DAYS → không tạo encounter, báo MANUAL_SLOT_REQUIRED cho bác sĩ', async () => {
    ledger.confirmContract.mockResolvedValueOnce([]);
    // Mọi ngày làm việc trong hợp đồng đã bị bác sĩ kín cả 2 ca
    const occupied: any[] = [];
    for (let d = new Date('2026-01-05T00:00:00.000Z'); d < new Date('2027-01-05T00:00:00.000Z'); d = new Date(d.getTime() + 86400000)) {
      const iso = d.toISOString().slice(0, 10);
      occupied.push({ date: iso, slotWindow: 'MORNING', contractId: 'other', status: 'BOOKED' });
      occupied.push({ date: iso, slotWindow: 'AFTERNOON', contractId: 'other', status: 'BOOKED' });
    }
    ledger.listOccupied.mockResolvedValueOnce(occupied);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
    expect(ledger.hold).not.toHaveBeenCalled();
    expect(mockTx.notification.createMany).toHaveBeenCalledTimes(1);
    const notes = mockTx.notification.createMany.mock.calls[0][0].data;
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-doc-1',
          type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        }),
        expect.objectContaining({
          userId: 'user-fam-1',
          type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        }),
      ]),
    );
    expect(notes.some((n: any) => n.type === 'ENCOUNTER_AUTO_CONFIRMED')).toBe(false);
    expect(notes[0].content).toContain('0/2');
  });

  it('(d) không truy vấn encounter theo từng ngày (hết N+1)', async () => {
    ledger.confirmContract.mockResolvedValueOnce(heldBookings as any);

    await service.scheduleOnContractActivated(mockTx, 'contract-1');

    // count chỉ được gọi 1 lần: kiểm tra idempotency theo hợp đồng
    expect(mockTx.encounter.count).toHaveBeenCalledTimes(1);
    expect(mockTx.encounter.findMany).not.toHaveBeenCalled();
  });

  it('AF1: skips auto-scheduling when contract has 0 remainingHomeVisits (Online-only package)', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      remainingHomeVisits: 0,
      remainingTelehealth: 10,
    });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });

  it('EF1: notifies facility & family and skips when homeAddress is missing or placeholder or doctorId missing', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      homeVisitAddress: null,
      familyUnit: { ...baseContract.familyUnit, homeAddress: 'Chưa cập nhật địa chỉ' },
    });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-fac-1',
          type: 'ENCOUNTER_AUTO_SCHEDULE_MISSING_DATA',
        }),
      ]),
    });
  });

  it('auto-schedules when contract.members is empty (post-payment member onboarding) and contract.homeVisitAddress is valid', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      homeVisitAddress: 'Số 10 Nguyễn Trãi, Phường Thượng Đình, Thành phố Hà Nội',
      familyUnit: { ...baseContract.familyUnit, homeAddress: 'Chưa cập nhật địa chỉ' },
      members: [],
    });
    mockTx.patient = {
      findMany: jest.fn().mockResolvedValue([{ id: 'pat-head' }]),
    };
    ledger.confirmContract.mockResolvedValueOnce(heldBookings as any);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toHaveLength(2);
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: 'ENCOUNTER_AUTO_CONFIRMED',
        }),
      ]),
    });
    expect(mockTx.encounter.create.mock.calls[0][0].data.participants).toEqual({
      create: [{ patientId: 'pat-head' }],
    });
  });

  it('EF2: đã đủ buổi khám tại nhà đang hiệu lực → không xếp thêm', async () => {
    mockTx.encounter.count.mockResolvedValueOnce(2);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
    expect(ledger.confirmContract).not.toHaveBeenCalled();
  });

  it('R4: đã có 1/2 buổi → chỉ xếp tiếp 1 buổi, đánh số 2/2', async () => {
    mockTx.encounter.count.mockResolvedValueOnce(1);
    ledger.confirmContract.mockResolvedValueOnce(heldBookings as any);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toHaveLength(1);
    const parsed = parseEncounterScheduleMeta(mockTx.encounter.create.mock.calls[0][0].data);
    expect(parsed.milestoneIndex).toBe(2);
    expect(parsed.totalMilestones).toBe(2);
  });

  it('R7: "ngày mai" tính theo giờ Việt Nam (03:00 sáng 28/11 VN → mốc 29/11)', async () => {
    ledger.confirmContract.mockResolvedValueOnce(heldBookings as any);

    await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
      new Date('2026-11-27T20:00:00.000Z'),
    );
    expect(ledger.confirmContract.mock.calls[0][2]).toEqual(
      expect.objectContaining({ minDate: '2026-11-29' }),
    );
  });

  it('calculateCadenceDates rải đều 10 buổi trong gói 1 tháng (không dồn về endDate - 1) và không trùng ngày nghỉ/lễ', () => {
    const start = new Date('2026-05-01T00:00:00.000Z');
    const end = new Date('2026-06-01T00:00:00.000Z');
    const dates = calculateCadenceDates(start, 1, 10, end);

    expect(dates).toHaveLength(10);
    const isoList = dates.map((d) => d.toISOString().slice(0, 10));
    expect(new Set(isoList).size).toBe(10);
    expect(isoList.every((iso) => iso >= '2026-05-01' && iso < '2026-06-01')).toBe(true);
    expect(isoList).not.toContain('2026-05-01'); // Ngày lễ 05-01

    const spanDays = (dates[9].getTime() - dates[0].getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThanOrEqual(20);
  });

  it('calculateCadenceDates rải đều 12 buổi cho gói 12 tháng, tất cả < endDate và không rơi vào Chủ nhật', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2027-01-01T00:00:00.000Z');
    const dates = calculateCadenceDates(start, 12, 12, end);

    expect(dates).toHaveLength(12);
    const isoList = dates.map((d) => d.toISOString().slice(0, 10));
    expect(new Set(isoList).size).toBe(12);
    expect(dates.every((d) => d.getTime() < end.getTime())).toBe(true);
    expect(dates.every((d) => d.getUTCDay() !== 0)).toBe(true);
  });

  it('(e) chỉ còn 1/2 ca khám tại nhà (HELD kia bị giành) → chỉ lập lại phần thiếu, không nhân đôi', async () => {
    ledger.confirmContract
      .mockResolvedValueOnce(heldBookings.slice(0, 2) as any)
      .mockResolvedValueOnce(heldBookings.slice(2) as any);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(ledger.hold).toHaveBeenCalledTimes(1);
    const holdArg = ledger.hold.mock.calls[0][1];
    expect(holdArg.slots).toHaveLength(1);
    expect(holdArg.slots[0].visitType).toBe('HOME_VISIT');
    expect(result).toHaveLength(2);
  });

  it('(f) replan gặp SLOT_TAKEN → báo bác sĩ xếp tay, không ném lỗi', async () => {
    const { ConflictException } = await import('@nestjs/common');
    ledger.confirmContract.mockResolvedValue([]);
    ledger.hold.mockRejectedValueOnce(new ConflictException({ code: 'SLOT_TAKEN' }));

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(result).toHaveLength(0);
    expect(mockTx.notification.createMany).toHaveBeenCalled();
  });

  it('(g) thiếu bác sĩ/địa chỉ → nhả HELD của hợp đồng', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({ ...baseContract, doctorId: null });

    await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(ledger.releaseContractHolds).toHaveBeenCalledWith(mockTx, 'contract-1');
  });

  it('(h) replan né ngày gia đình đã có lượt ở hợp đồng khác (listFamilyBusyDates)', async () => {
    const busy = ['2026-03-10', '2026-03-11', '2026-03-12'];
    ledger.listFamilyBusyDates.mockResolvedValueOnce(busy);
    ledger.confirmContract
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(heldBookings as any);

    await service.scheduleOnContractActivated(mockTx, 'contract-1', new Date('2026-03-01T00:00:00.000Z'));

    expect(ledger.listFamilyBusyDates).toHaveBeenCalledWith(
      mockTx,
      'family-1',
      expect.any(String),
      expect.any(String),
      { excludeContractId: 'contract-1' },
    );
    const slots = ledger.hold.mock.calls[0][1].slots as Array<{ date: string }>;
    expect(slots.some((x) => busy.includes(x.date))).toBe(false);
  });

  it('(i) hold SLOT_TAKEN giữa chừng → nhả phần đã giữ dở, không xác nhận lẻ', async () => {
    const { ConflictException } = await import('@nestjs/common');
    ledger.confirmContract.mockResolvedValueOnce([]);
    ledger.hold.mockRejectedValueOnce(new ConflictException({ code: 'SLOT_TAKEN' }));

    await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(ledger.releaseContractHolds).toHaveBeenCalledWith(mockTx, 'contract-1');
  });
});
