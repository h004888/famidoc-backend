import {
  enrichEncounterWithScheduleMeta,
  parseEncounterScheduleMeta,
  serializeEncounterScheduleMeta,
  stripScheduleMetaPrefix,
} from '../utils/encounter-schedule-meta.util';

describe('encounter-schedule-meta.util', () => {
  it('serializes and parses CADENCE_DRAFT metadata with milestone indices and note', () => {
    const encoded = serializeEncounterScheduleMeta(
      { stage: 'CADENCE_DRAFT', milestoneIndex: 2, totalMilestones: 4 },
      'Khám định kỳ lần 2/4',
    );
    const parsed = parseEncounterScheduleMeta({
      encounterStatus: 'REQUESTED',
      category: 'PERIODIC_ROUTINE',
      cancelReason: encoded,
    });

    expect(parsed).toEqual({
      scheduleStage: 'CADENCE_DRAFT',
      milestoneIndex: 2,
      totalMilestones: 4,
      displayNotes: 'Khám định kỳ lần 2/4',
    });
  });

  it('re-serializing strips existing metadata prefix instead of duplicating it', () => {
    const first = serializeEncounterScheduleMeta(
      { stage: 'CADENCE_DRAFT', milestoneIndex: 1, totalMilestones: 4 },
      'Ghi chú ban đầu',
    );
    const second = serializeEncounterScheduleMeta(
      { stage: 'AWAITING_FAMILY_CONFIRM', milestoneIndex: 1, totalMilestones: 4 },
      first,
    );

    expect(second.match(/\[SCHEDULE_META:/g)?.length).toBe(1);
    expect(stripScheduleMetaPrefix(second)).toBe('Ghi chú ban đầu');
  });

  it('maps non-REQUESTED statuses directly to their status stage while keeping milestone metadata', () => {
    const encoded = serializeEncounterScheduleMeta(
      { stage: 'AWAITING_FAMILY_CONFIRM', milestoneIndex: 3, totalMilestones: 4 },
      'Bác sĩ đã chốt',
    );
    const enriched = enrichEncounterWithScheduleMeta({
      id: 'enc-1',
      encounterStatus: 'CONFIRMED',
      category: 'PERIODIC_ROUTINE',
      cancelReason: encoded,
    });

    expect(enriched.scheduleStage).toBe('CONFIRMED');
    expect(enriched.milestoneIndex).toBe(3);
    expect(enriched.totalMilestones).toBe(4);
    expect(enriched.displayNotes).toBe('Bác sĩ đã chốt');
  });

  it('falls back safely on legacy cancelReason rows without metadata prefix', () => {
    expect(
      parseEncounterScheduleMeta({
        encounterStatus: 'REQUESTED',
        category: 'PERIODIC_ROUTINE',
        cancelReason: 'Khám định kỳ gia đình lần 1/4 (khung dự thảo)',
      }).scheduleStage,
    ).toBe('CADENCE_DRAFT');

    expect(
      parseEncounterScheduleMeta({
        encounterStatus: 'REQUESTED',
        category: 'PERIODIC_ROUTINE',
        cancelReason: 'Bác sĩ đã chốt khung lịch khám định kỳ',
      }).scheduleStage,
    ).toBe('AWAITING_FAMILY_CONFIRM');

    expect(
      parseEncounterScheduleMeta({
        encounterStatus: 'REQUESTED',
        category: 'AD_HOC_ON_DEMAND',
        cancelReason: 'Bé sốt cao 39 độ',
      }),
    ).toEqual({
      scheduleStage: 'AWAITING_DOCTOR_REVIEW',
      milestoneIndex: null,
      totalMilestones: null,
      displayNotes: 'Bé sốt cao 39 độ',
    });
  });
});
