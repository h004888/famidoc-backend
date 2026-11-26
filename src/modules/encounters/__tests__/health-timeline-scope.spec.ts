import { timelineVisitScope } from '../services/medical-books.service';

describe('timelineVisitScope', () => {
  const familyActor = { id: 'rep-1', role: 'FAMILY_REP' } as any;
  const doctorActor = { id: 'doc-user-1', role: 'DOCTOR' } as any;

  it('restricts FAMILY_REP to finalized visits via visitScope and patient filter', () => {
    const scope = timelineVisitScope(familyActor, 'fam-1', 'pat-1');
    const andClauses = scope.AND as any[];

    expect(andClauses).toHaveLength(2);
    expect(andClauses[0]).toEqual(
      expect.objectContaining({
        clinicalEmrs: {
          some: expect.objectContaining({ isFinalized: true }),
        },
      }),
    );
    expect(andClauses[1]).toEqual({
      contract: { familyId: 'fam-1' },
      OR: [
        { participants: { some: { patientId: 'pat-1' } } },
        { clinicalEmrs: { some: { patientId: 'pat-1' } } },
      ],
    });
  });

  it('allows DOCTOR own visits or finalized visits of other doctors', () => {
    const scope = timelineVisitScope(doctorActor, 'fam-1', 'pat-1') as any;

    expect(scope.AND).toHaveLength(2);
    expect(scope.AND[0].OR).toHaveLength(2);
    expect(scope.AND[0].OR[0]).toMatchObject({
      doctor: expect.objectContaining({ userId: 'doc-user-1' }),
    });
    expect(scope.AND[0].OR[1]).toEqual({
      clinicalEmrs: { some: { patientId: 'pat-1', isFinalized: true } },
    });
    expect(scope.AND[1]).toEqual({
      contract: { familyId: 'fam-1' },
      OR: [
        { participants: { some: { patientId: 'pat-1' } } },
        { clinicalEmrs: { some: { patientId: 'pat-1' } } },
      ],
    });
  });
});
