import type { Gender } from '@prisma/client';

export type ProfileMissingField = 'dateOfBirth' | 'gender';

export interface ProfileCompleteness {
  isComplete: boolean;
  missing: ProfileMissingField[];
}

export function computeProfileCompleteness(patient: {
  dateOfBirth: Date | string | null;
  gender: Gender | null;
}): ProfileCompleteness {
  const missing: ProfileMissingField[] = [];
  if (!patient.dateOfBirth) missing.push('dateOfBirth');
  if (!patient.gender) missing.push('gender');
  return {
    isComplete: missing.length === 0,
    missing,
  };
}

export function isFutureBirthDate(rawDate: string): boolean {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const dobIso = parsed.toISOString().slice(0, 10);
  const todayVn = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
  return dobIso > todayVn;
}
