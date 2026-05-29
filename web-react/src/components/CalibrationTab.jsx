import {
  CH_NAMES,
  SENS_MIN,
  SENS_MAX,
  rawToMv,
  calcThreshold,
  alarmTripPoint,
} from '../lib/adc.js';

function Field({ label, value, unit }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{unit}</div>
    </div>
  );
}

export default function CalibrationTab({
  channel,
  onChannel,
  cal,
  latest,
  onSensChange,
  onReset,
  onSave,
  onLoad,
  saveState,
}) {
  const { min, max, sens } = cal;
  const hasRange = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const threshold = hasRange ? calcThreshold(min, max, sens) : NaN;
  const trip = hasRange ? alarmTripPoint(min, max, sens) : NaN;

  return (
    <div className="space-y-4">
      {/* Channel picker */}
      <div className="card">
        <div className="mb-2 text-sm text-muted">Channel kalibrasi</div>
        <div className="grid grid-cols-4 gap-2">
          {CH_NAMES.map((name, ch) => (
            <button
              key={ch}
              onClick={() => onChannel(ch)}
              className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                channel === ch ? 'border-accent bg-accent/10' : 'border-border hover:bg-border'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Sensitivity slider */}
      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-muted">Sensitivity</span>
          <span className="font-mono text-lg font-semibold">{sens}%</span>
        </div>
        <input
          type="range"
          min={SENS_MIN}
          max={SENS_MAX}
          step={1}
          value={sens}
          onChange={(e) => onSensChange(Number(e.target.value))}
          className="w-full accent-[#58a6ff]"
        />
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>{SENS_MIN}%</span>
          <span>{SENS_MAX}%</span>
        </div>
        <p className="mt-3 text-xs text-muted">
          threshold = sensitivity% × (maxVal − minVal). Alarm bocor jika
          current − minVal &gt; threshold.
        </p>
      </div>

      {/* Live tracked values */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field
          label="Current"
          value={latest ? latest.raw : '—'}
          unit={latest ? `${latest.mv.toFixed(1)} mV` : 'raw'}
        />
        <Field
          label="minVal"
          value={Number.isFinite(min) ? min : '—'}
          unit={Number.isFinite(min) ? `${rawToMv(min).toFixed(1)} mV` : 'raw'}
        />
        <Field
          label="maxVal"
          value={Number.isFinite(max) ? max : '—'}
          unit={Number.isFinite(max) ? `${rawToMv(max).toFixed(1)} mV` : 'raw'}
        />
        <Field
          label="Threshold"
          value={Number.isFinite(threshold) ? threshold.toFixed(0) : '—'}
          unit={Number.isFinite(threshold) ? `${rawToMv(threshold).toFixed(1)} mV` : 'raw'}
        />
      </div>

      <div className="card">
        <div className="text-xs uppercase tracking-wide text-muted">
          Trip point (alarm aktif di atas nilai ini)
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold">
          {Number.isFinite(trip) ? `${trip.toFixed(0)} raw` : '—'}
          {Number.isFinite(trip) && (
            <span className="ml-2 text-base text-muted">
              ({rawToMv(trip).toFixed(1)} mV)
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={onSave} disabled={!hasRange}>
          💾 Simpan ke EEPROM
        </button>
        <button className="btn-secondary" onClick={onLoad}>
          ⤓ Muat dari EEPROM
        </button>
        <button className="btn-secondary" onClick={onReset}>
          ♻ Reset min/max
        </button>
        {saveState && <span className="self-center text-sm text-ok">{saveState}</span>}
      </div>
    </div>
  );
}
