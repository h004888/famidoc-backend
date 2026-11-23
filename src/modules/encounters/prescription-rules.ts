// Phụ lục VII, Thông tư 26/2025/TT-BYT (đơn thường, không áp dụng thuốc N/H).
// https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/26-byt.pdf
const longTermCodes =
  `B18.1 B20 B21 B22 B23 B24 Z21 C50 C34 C73 D56 D57 D58 D59 D60 D61 D66 D67 D75.2 D76.2 D86 D89.2
E03 E05 E20.8 E21 E24 E26 E27 E31 E83.0 E87.6 E89.0 E22 E23.0 E25 E30.1 E35.1 E83.1 E85 G70 P05.1 Q87.1
F00 F02 F03 F04 F06 F07 F10 F20 F21 F22 F25 F31 F32 F33 F34 F40 F41 F42 F43.1 F43.2 F45 F60 F61 F62 F68
F70 F71 F72 F73 F74 F75 F76 F77 F78 F79 F80 F81 F82 F83 F84 F85 F86 F87 F88 F89 F90 F91 F92 F93 F94 F95 F96 F97 F98
F01 G13 G20 G21 G24 G30 G35 G40 G04 G09 G12 G36.0 G37.3 G50.0 G51.3 G53.0 G54 G61 G71 G72 G80 I69 Q03 Q90 Q91 H46 Q85.0
H04.1 H16 H20 H21 H30 H33.4 H34.8 H35 H40 H44.5 H44.1 T26.2 Z94.7 I20 I21 I22 I23 I25 I31.1 I74 I80 I10 I42 Q25.7 Q26
J45 J84 C96.6 J17.2 K75.4 K74.3 K59.0 K25 K26 Q44.7 S35.3 K76.6 E80.5 Q44.2 K76.0 E72.2 Q44.4 K80 I82.0 R18 K83.5 D73.1 K76.9 K71.0 I81 E74.0 R16.0 R77.0 K86.2 Q44.5 Q44.6 K21.0
L10 L12 L13.0 L14 L20 L30 L26 L40 L44.0 L52 L88 L98.4 L41 L50 M32 M02.8 M02.9 M05 M07.3 M10 M11 M16 M17 M30 M31 M33 M34 M35 M43 M45 M47 M50 M75 M80 M84.1 M84.4 M85.0 M86 M87.0 M89.0 M90.7 M95 M00 M03 M06 M08 M09 M13 M15 M18 M19 M24 M36 M49 M51 M53 M54 M60 M61 M65 M79.3 M79.7 M81 M82 M83 M88
N01 N02 N03 N04 N08 N18 N06 N07 N20 N25 N13 D69.0 N92.2 T95 Z69.64 Z69.65 Z94`.split(
    /\s+/,
  );

export function eligibleForLongTermPrescription(value: string): boolean {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]\d{2}(?:\.\d{1,4})?$/.test(code)) return false;
  if (/^E1[0-4](?:\.(?![01])\d+)?$/.test(code)) return true;
  if (/^F11\.[2-9]$/.test(code) || /^F19\.[2-8]$/.test(code)) return true;
  return longTermCodes.some(
    (prefix) =>
      code === prefix ||
      code.startsWith(`${prefix}.`) ||
      (prefix.includes('.') && code.startsWith(prefix)),
  );
}

export function patientAgeMonths(
  dateOfBirth: string | Date,
  date: string | Date,
): number | null {
  const birth = new Date(dateOfBirth);
  const at = new Date(date);
  if (
    !Number.isFinite(birth.getTime()) ||
    !Number.isFinite(at.getTime()) ||
    birth > at
  )
    return null;
  return (
    (at.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    at.getUTCMonth() -
    birth.getUTCMonth() -
    (at.getUTCDate() < birth.getUTCDate() ? 1 : 0)
  );
}

export function prescriptionDrugName(drug: {
  medicationName: string;
  activeIngredient?: string | null;
  medicationType?: string;
}): string {
  const name = drug.medicationName.trim();
  const ingredient = drug.activeIngredient?.trim();
  return (!drug.medicationType ||
    drug.medicationType === 'SINGLE_INGREDIENT') &&
    ingredient &&
    !name.toLocaleLowerCase().startsWith(ingredient.toLocaleLowerCase())
    ? `${ingredient} (${name})`
    : name;
}

export type PrescriptionSnapshot = {
  version: 1;
  patient: {
    id: string;
    fullName: string;
    dateOfBirth: string;
    gender: string;
    ageMonths: number;
  };
  doctorName: string;
  facility: { facilityName: string; address: string | null; phone: string };
  exam: {
    chiefComplaint: string;
    clinicalFindings: string;
    icd10Code: string;
    icd10Diagnosis: string;
    treatmentPlan: string;
  };
};
