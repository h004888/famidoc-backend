import { computeProfileCompleteness } from '../utils/profile-completeness.util';

describe('computeProfileCompleteness', () => {
  it('returns missing dateOfBirth and gender when both are null', () => {
    expect(
      computeProfileCompleteness({ dateOfBirth: null, gender: null }),
    ).toEqual({
      isComplete: false,
      missing: ['dateOfBirth', 'gender'],
    });
  });

  it('returns missing only dateOfBirth when gender is present', () => {
    expect(
      computeProfileCompleteness({ dateOfBirth: null, gender: 'FEMALE' }),
    ).toEqual({
      isComplete: false,
      missing: ['dateOfBirth'],
    });
  });

  it('returns isComplete true and empty missing when both are present', () => {
    expect(
      computeProfileCompleteness({
        dateOfBirth: new Date('1990-01-01'),
        gender: 'MALE',
      }),
    ).toEqual({
      isComplete: true,
      missing: [],
    });
  });
});
