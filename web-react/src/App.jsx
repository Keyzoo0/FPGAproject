import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnState, serialSupported, useSerial } from './hooks/useSerial.js';
import {
  CH_NAMES,
  MAX_BUFFER,
  SENS_DEFAULT,
  rawToMv,
  evalAlarm,
  alarmTripPoint,
} from './lib/adc.js';
import ConnectGate from './components/ConnectGate.jsx';
import Tabs from './components/Tabs.jsx';
import DashboardTab from './components/DashboardTab.jsx';
import CalibrationTab from './components/CalibrationTab.jsx';
import InfoTab from './components/InfoTab.jsx';

const blankCal = () => ({
  0: { min: NaN, max: NaN, sens: SENS_DEFAULT },
  1: { min: NaN, max: NaN, sens: SENS_DEFAULT },
  2: { min: NaN, max: NaN, sens: SENS_DEFAULT },
  3: { min: NaN, max: NaN, sens: SENS_DEFAULT },
});

export default function App() {
  const [channel, setChannel] = useState(0);
  const [tab, setTab] = useState('dashboard');
  const [latest, setLatest] = useState(null);
  const [cal, setCal] = useState(blankCal);
  const [saveState, setSaveState] = useState('');

  // Buffer grafik di ref (di luar React state) supaya chart bisa di-update
  // imperatif via requestAnimationFrame, tidak memicu re-render tiap sampel.
  const samplesRef = useRef([]);
  // Nilai terbaru di ref (dipakai resampler 10 ms sisi-chart).
  const latestRef = useRef(null);

  const channelRef = useRef(channel);
  useEffect(() => { channelRef.current = channel; }, [channel]);

  // ---- Serial callbacks ----
  const onData = useCallback(({ ch, raw, t }) => {
    if (ch !== channelRef.current) return; // ignore frames from other channel
    const mv = rawToMv(raw);
    setLatest({ raw, mv, t });
    latestRef.current = { raw, mv, t };
    const buf = samplesRef.current;
    buf.push({ t, mv, raw });
    if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
    // live auto-track min/max (spec)
    setCal((prev) => {
      const c = prev[ch];
      const min = Number.isFinite(c.min) ? Math.min(c.min, raw) : raw;
      const max = Number.isFinite(c.max) ? Math.max(c.max, raw) : raw;
      if (min === c.min && max === c.max) return prev;
      return { ...prev, [ch]: { ...c, min, max } };
    });
  }, []);

  const onCalib = useCallback(({ ch, min, max, sens }) => {
    setCal((prev) => ({ ...prev, [ch]: { min, max, sens } }));
    setSaveState('Kalibrasi dimuat dari EEPROM ✓');
  }, []);

  const onLog = useCallback(() => {}, []);

  const { connState, error, connect, disconnect, send } = useSerial({
    onData,
    onCalib,
    onLog,
  });

  const connected = connState === ConnState.CONNECTED;

  // ---- Channel switching (stream + clear) ----
  const switchChannel = useCallback(
    (ch) => {
      setChannel(ch);
      samplesRef.current = [];
      latestRef.current = null;
      setLatest(null);
      if (connState === ConnState.CONNECTED) {
        send(`SEL:${ch}`);
        send(`GET:${ch}`);
      }
    },
    [connState, send]
  );

  const handleConnect = useCallback(async () => {
    const ok = await connect();
    if (ok) {
      send(`SEL:${channelRef.current}`);
      send(`GET:${channelRef.current}`);
    }
  }, [connect, send]);

  // ---- Calibration actions ----
  const onSensChange = useCallback(
    (sens) => setCal((prev) => ({ ...prev, [channel]: { ...prev[channel], sens } })),
    [channel]
  );

  const onReset = useCallback(
    () =>
      setCal((prev) => ({
        ...prev,
        [channel]: { ...prev[channel], min: NaN, max: NaN },
      })),
    [channel]
  );

  const onSave = useCallback(() => {
    const c = cal[channel];
    if (!Number.isFinite(c.min) || !Number.isFinite(c.max)) return;
    send(`SAVE:${channel},${Math.round(c.min)},${Math.round(c.max)},${c.sens}`);
    setSaveState('Tersimpan ke EEPROM ✓');
    setTimeout(() => setSaveState(''), 2500);
  }, [cal, channel, send]);

  const onLoad = useCallback(() => send(`GET:${channel}`), [channel, send]);

  // ---- Alarm eval ----
  const c = cal[channel];
  const alarm = latest
    ? evalAlarm(latest.raw, c.min, c.max, c.sens)
    : { leak: false, threshold: NaN, level: 0, delta: NaN };
  const tripRaw = Number.isFinite(c.min) && Number.isFinite(c.max)
    ? alarmTripPoint(c.min, c.max, c.sens)
    : NaN;

  // ---- Gate screen ----
  if (!connected) {
    return (
      <ConnectGate
        connState={connState}
        error={error}
        channel={channel}
        onChannel={setChannel}
        onConnect={handleConnect}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      {/* Header / status */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Deteksi Arus Bocor</h1>
          <p className="text-xs text-muted">
            FPGA · UART · Web Monitoring — {CH_NAMES[channel]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm">
            <span className="h-2 w-2 rounded-full bg-ok" />
            Connected
          </span>
          <button className="btn-secondary" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <Tabs active={tab} onChange={setTab} />

      {tab === 'dashboard' && (
        <DashboardTab
          channel={channel}
          latest={latest}
          samplesRef={samplesRef}
          latestRef={latestRef}
          alarm={alarm}
          tripRaw={tripRaw}
          maxValRaw={c.max}
        />
      )}
      {tab === 'calibration' && (
        <CalibrationTab
          channel={channel}
          onChannel={switchChannel}
          cal={cal[channel]}
          latest={latest}
          onSensChange={onSensChange}
          onReset={onReset}
          onSave={onSave}
          onLoad={onLoad}
          saveState={saveState}
        />
      )}
      {tab === 'info' && <InfoTab />}
    </div>
  );
}
