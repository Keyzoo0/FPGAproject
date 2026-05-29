import LeakChart from './LeakChart.jsx';
import { CH_NAMES, rawToMv, mvToV } from '../lib/adc.js';

function Stat({ title, value, unit }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="text-xs text-muted">{unit}</div>
    </div>
  );
}

export default function DashboardTab({ channel, latest, samplesRef, latestRef, alarm, tripRaw }) {
  const mv = latest ? latest.mv : null;
  const v = latest ? mvToV(latest.mv) : null;
  const raw = latest ? latest.raw : null;

  return (
    <div className="space-y-4">
      {/* Alarm banner */}
      <div
        className={`rounded-xl border p-4 text-center ${
          alarm.leak
            ? 'alarm-pulse border-danger bg-danger/15 text-danger'
            : 'border-ok/40 bg-ok/10 text-ok'
        }`}
      >
        <div className="text-2xl font-bold">
          {alarm.leak ? '⚠ WARNING — ARUS BOCOR' : '✓ ARUS NORMAL'}
        </div>
        <div className="mt-1 text-sm opacity-80">
          {CH_NAMES[channel]} · threshold ={' '}
          {Number.isFinite(alarm.threshold) ? rawToMv(alarm.threshold).toFixed(1) : '—'} mV
          {' '}· current Δ ={' '}
          {Number.isFinite(alarm.delta) ? rawToMv(alarm.delta).toFixed(1) : '—'} mV
        </div>
      </div>

      {/* Reading cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat title={`Voltage ${CH_NAMES[channel]}`} value={mv === null ? '—' : mv.toFixed(2)} unit="mV" />
        <Stat title="Voltage" value={v === null ? '—' : v.toFixed(4)} unit="V" />
        <Stat title="ADC Raw" value={raw === null ? '—' : raw} unit="16-bit" />
      </div>

      {/* Chart */}
      <LeakChart
        samplesRef={samplesRef}
        latestRef={latestRef}
        channel={channel}
        tripRaw={tripRaw}
        leak={alarm.leak}
      />
    </div>
  );
}
