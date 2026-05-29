// ============================================================
// Konstanta & konversi ADC + logika alarm arus bocor
// ADS1115 PGA ±4.096V → 16-bit signed
// ============================================================

export const LSB_MV = 0.125; // mV per LSB pada PGA ±4.096V
export const FULL_SCALE_MV = 4096;
export const BAUD_RATE = 9600;
export const MAX_BUFFER = 1200; // titik grafik yang disimpan di memori

export const CH_NAMES = ['AIN0', 'AIN1', 'AIN2', 'AIN3'];
export const CH_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149'];

// Batas sensitivity (persen) sesuai spesifikasi
export const SENS_MIN = 20;
export const SENS_MAX = 80;
export const SENS_DEFAULT = 50;

// raw ADC (LSB) → milivolt
export const rawToMv = (raw) => raw * LSB_MV;
// milivolt → volt
export const mvToV = (mv) => mv / 1000;

/**
 * Hitung nilai threshold (dalam satuan raw ADC).
 * threshold = sensitivity% × (maxVal − minVal)
 */
export function calcThreshold(minVal, maxVal, sensitivity) {
  const span = Math.max(0, maxVal - minVal);
  return (sensitivity / 100) * span;
}

/**
 * Evaluasi status alarm.
 * BOCOR jika: current − minVal > threshold
 * @returns {{ leak: boolean, threshold: number, level: number }}
 *   level = (current − minVal) / threshold  (0..1+ untuk progress bar)
 */
export function evalAlarm(current, minVal, maxVal, sensitivity) {
  const threshold = calcThreshold(minVal, maxVal, sensitivity);
  const delta = current - minVal;
  const leak = threshold > 0 && delta > threshold;
  const level = threshold > 0 ? delta / threshold : 0;
  return { leak, threshold, level, delta };
}

/** Nilai ADC absolut di mana alarm mulai aktif (raw). */
export function alarmTripPoint(minVal, maxVal, sensitivity) {
  return minVal + calcThreshold(minVal, maxVal, sensitivity);
}
