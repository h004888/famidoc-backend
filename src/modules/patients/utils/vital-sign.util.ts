export interface VitalMetricSnapshot {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  bloodGlucose?: number | null;
}

const VITAL_METRIC_KEYS: Array<keyof VitalMetricSnapshot> = [
  'systolicBp',
  'diastolicBp',
  'heartRate',
  'temperature',
  'spo2',
  'respiratoryRate',
  'bloodGlucose',
];

/**
 * Returns true if at least one physiological metric has a numeric value.
 */
export function hasAnyVitalMetric(metrics: VitalMetricSnapshot): boolean {
  return VITAL_METRIC_KEYS.some(
    (key) => metrics[key] !== undefined && metrics[key] !== null,
  );
}

/**
 * Evaluates clinical warning thresholds server-side for vital sign readings.
 */
export function computeVitalAbnormalAlert(metrics: VitalMetricSnapshot): boolean {
  const {
    systolicBp,
    diastolicBp,
    heartRate,
    temperature,
    spo2,
    respiratoryRate,
    bloodGlucose,
  } = metrics;

  if (systolicBp !== undefined && systolicBp !== null && (systolicBp >= 140 || systolicBp < 90)) {
    return true;
  }
  if (diastolicBp !== undefined && diastolicBp !== null && (diastolicBp >= 90 || diastolicBp < 60)) {
    return true;
  }
  if (heartRate !== undefined && heartRate !== null && (heartRate > 110 || heartRate < 50)) {
    return true;
  }
  if (temperature !== undefined && temperature !== null && (temperature >= 38.0 || temperature < 35.5)) {
    return true;
  }
  if (spo2 !== undefined && spo2 !== null && spo2 < 95) {
    return true;
  }
  if (
    respiratoryRate !== undefined &&
    respiratoryRate !== null &&
    (respiratoryRate > 24 || respiratoryRate < 12)
  ) {
    return true;
  }
  if (bloodGlucose !== undefined && bloodGlucose !== null && (bloodGlucose >= 11.1 || bloodGlucose < 3.9)) {
    return true;
  }

  return false;
}
