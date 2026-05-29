import { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { CH_COLORS, CH_NAMES, rawToMv, nowMs } from '../lib/adc.js';

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip, Legend, Filler);

const WINDOWS = [
  { v: 0.05, label: '50 ms' },
  { v: 0.1, label: '100 ms' },
  { v: 0.2, label: '200 ms' },
  { v: 0.5, label: '0.5 s' },
  { v: 1, label: '1 s' },
  { v: 2, label: '2 s' },
  { v: 5, label: '5 s' },
  { v: 10, label: '10 s' },
  { v: 20, label: '20 s' },
  { v: 30, label: '30 s' },
  { v: 60, label: '1 min' },
  { v: 300, label: '5 min' },
];

// Sumbu-X diplot RELATIF terhadap timeOrigin agar angkanya kecil
// (epoch ms absolut ~1.7e12 membuat presisi float Chart.js kacau pada window kecil).
const BASE = typeof performance !== 'undefined' && performance.timeOrigin
  ? performance.timeOrigin
  : 0;

function fmtTime(value, paused, refEnd, windowMs) {
  if (paused) {
    const abs = value + BASE; // kembalikan ke epoch absolut untuk label jam
    const d = new Date(abs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    if (windowMs < 100) {
      const whole = Math.floor(abs);
      const ms = String(whole % 1000).padStart(3, '0');
      const sub = String(Math.round((abs - whole) * 100)).padStart(2, '0');
      return `${ss}.${ms}${sub}`;
    }
    if (windowMs < 2000) {
      return `${ss}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }
    return `${hh}:${mm}:${ss}`;
  }
  const dtMs = value - refEnd;
  if (windowMs < 100) return dtMs.toFixed(2) + ' ms';
  if (windowMs < 1000) return (dtMs / 1000).toFixed(3) + 's';
  if (windowMs < 10000) return (dtMs / 1000).toFixed(1) + 's';
  return Math.round(dtMs / 1000) + 's';
}

// Saat window < 1 s, grafik memakai buffer hasil resample 10 ms (sample-and-hold)
// agar punya titik tiap 0.01 s. Data asli tetap di samplesRef (untuk CSV & window panjang).
const RESAMPLE_MS = 10;
const RESAMPLE_MAX = 600; // ~6 s @ 100 Hz

export default function LeakChart({ samplesRef, latestRef, channel, tripRaw, minValRaw, maxValRaw, leak }) {
  const chartRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startPan: 0 });
  const resampleRef = useRef([]);
  const lastModeRef = useRef(null);
  const minRef = useRef(minValRaw);
  const maxRef = useRef(maxValRaw);

  const [windowSec, setWindowSec] = useState(20);
  const [isPaused, setIsPaused] = useState(false);
  const [panOffsetMs, setPanOffsetMs] = useState(0);

  // Mirror state into refs so the rAF draw loop & tick callback read latest
  const windowSecRef = useRef(windowSec);
  const isPausedRef = useRef(isPaused);
  const panOffsetRef = useRef(panOffsetMs);
  const channelRef = useRef(channel);
  const tripRef = useRef(tripRaw);
  const pauseEndRef = useRef(0);
  const refEndRef = useRef(nowMs());
  const lastLenRef = useRef(-1);
  const lastChRef = useRef(-1);
  const prevViewRef = useRef({ vs: null, ve: null, len: -1, ch: -1 });

  useEffect(() => { windowSecRef.current = windowSec; }, [windowSec]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { panOffsetRef.current = panOffsetMs; }, [panOffsetMs]);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  useEffect(() => { tripRef.current = tripRaw; }, [tripRaw]);
  useEffect(() => { minRef.current = minValRaw; }, [minValRaw]);
  useEffect(() => { maxRef.current = maxValRaw; }, [maxValRaw]);

  // ---- Single imperative draw loop (decoupled from React re-renders) ----
  useEffect(() => {
    let raf;
    const draw = () => {
      const chart = chartRef.current;
      if (chart) {
        const windowMs = windowSecRef.current * 1000;
        // semua nilai waktu relatif terhadap BASE (timeOrigin)
        const refEnd = (isPausedRef.current ? pauseEndRef.current : nowMs()) - BASE;
        refEndRef.current = refEnd;
        const viewEnd = refEnd + panOffsetRef.current;
        const viewStart = viewEnd - windowMs;
        const ch = channelRef.current;
        // < 1 s → pakai buffer resample 10 ms; selain itu pakai data asli
        const useResample = windowSecRef.current < 1;
        const samples = useResample ? resampleRef.current : samplesRef.current;

        // Skip redraw entirely when nothing visible has changed (e.g. paused & idle)
        const pv = prevViewRef.current;
        if (
          pv.vs === viewStart && pv.ve === viewEnd &&
          pv.len === samples.length && pv.ch === ch && pv.mode === useResample
        ) {
          raf = requestAnimationFrame(draw);
          return;
        }
        prevViewRef.current = { vs: viewStart, ve: viewEnd, len: samples.length, ch, mode: useResample };

        const ds0 = chart.data.datasets[0];
        // Rebuild point array only when buffer / channel / mode changed
        if (samples.length !== lastLenRef.current || ch !== lastChRef.current || useResample !== lastModeRef.current) {
          ds0.data = samples.map((s) => ({ x: s.t - BASE, y: s.mv }));
          ds0.borderColor = CH_COLORS[ch];
          ds0.backgroundColor = CH_COLORS[ch] + '22';
          ds0.label = `${CH_NAMES[ch]} (mV)`;
          lastLenRef.current = samples.length;
          lastChRef.current = ch;
          lastModeRef.current = useResample;
        }

        const ds1 = chart.data.datasets[1];
        const trip = tripRef.current;
        if (Number.isFinite(trip)) {
          const ty = rawToMv(trip);
          ds1.data = [{ x: viewStart, y: ty }, { x: viewEnd, y: ty }];
          ds1.hidden = false;
        } else {
          ds1.data = [];
          ds1.hidden = true;
        }

        chart.options.scales.x.min = viewStart;
        chart.options.scales.x.max = viewEnd;

        // Y axis konstan: (minVal − 5) .. 2 × maxVal (fallback autoscale bila belum ada)
        const maxMv = Number.isFinite(maxRef.current) ? rawToMv(maxRef.current) : null;
        const minMv = Number.isFinite(minRef.current) ? rawToMv(minRef.current) : null;
        if (maxMv !== null && maxMv > 0) {
          chart.options.scales.y.min = (minMv !== null ? minMv : 0) - 5;
          chart.options.scales.y.max = 2 * maxMv;
        } else {
          chart.options.scales.y.min = undefined;
          chart.options.scales.y.max = undefined;
        }

        chart.update('none');
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [samplesRef]);

  // ---- Resampler 10 ms (aktif hanya saat window < 1 s & tidak paused) ----
  useEffect(() => {
    if (windowSec >= 1 || isPaused) return;
    // backfill dari data asli terakhir supaya grafik tidak kosong saat mulai
    const cutoff = nowMs() - 2000;
    resampleRef.current = samplesRef.current
      .filter((s) => s.t >= cutoff)
      .map((s) => ({ t: s.t, mv: s.mv, raw: s.raw }));
    const id = setInterval(() => {
      const l = latestRef.current;
      if (!l) return;
      const buf = resampleRef.current;
      buf.push({ t: nowMs(), mv: l.mv, raw: l.raw }); // tahan nilai terakhir
      if (buf.length > RESAMPLE_MAX) buf.splice(0, buf.length - RESAMPLE_MAX);
    }, RESAMPLE_MS);
    return () => clearInterval(id);
  }, [windowSec, isPaused, samplesRef, latestRef]);

  // Space = pause/resume
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        doTogglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doTogglePause() {
    setIsPaused((p) => {
      const next = !p;
      isPausedRef.current = next;
      if (next) pauseEndRef.current = nowMs();
      panOffsetRef.current = 0;
      setPanOffsetMs(0);
      return next;
    });
  }

  // ---- Drag-to-pan (paused only) ----
  const onPointerDown = (e) => {
    if (!isPausedRef.current) return;
    dragRef.current = { active: true, startX: e.clientX, startPan: panOffsetRef.current };
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.active || !isPausedRef.current) return;
    const chart = chartRef.current;
    if (!chart || !chart.chartArea) return;
    const windowMs = windowSecRef.current * 1000;
    const pxPerMs = chart.chartArea.width / windowMs;
    const dx = e.clientX - drag.startX;
    let p = drag.startPan - dx / pxPerMs;
    if (p > 0) p = 0;
    const samples = windowSecRef.current < 1 ? resampleRef.current : samplesRef.current;
    if (samples.length) {
      const minPan = samples[0].t - pauseEndRef.current + windowMs * 0.1;
      if (p < minPan) p = minPan;
    }
    panOffsetRef.current = p;
    setPanOffsetMs(p);
  };
  const onPointerUp = () => { dragRef.current.active = false; };
  const resetPan = () => { panOffsetRef.current = 0; setPanOffsetMs(0); };

  const exportCsv = () => {
    const samples = samplesRef.current;
    if (!samples.length) return;
    const rows = ['timestamp_ms,iso_time,channel,raw,mv'];
    for (const s of samples) {
      rows.push(
        [s.t, new Date(s.t).toISOString(), channel, s.raw, s.mv.toFixed(3)].join(',')
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `leak_${CH_NAMES[channel]}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Stable initial data & options (never replaced → no fight with rAF) ----
  const initialDataRef = useRef(null);
  if (!initialDataRef.current) {
    const color = CH_COLORS[channel];
    initialDataRef.current = {
      datasets: [
        {
          label: `${CH_NAMES[channel]} (mV)`,
          data: [],
          borderColor: color,
          backgroundColor: color + '22',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.25,
        },
        {
          label: 'Threshold bocor',
          data: [],
          borderColor: '#f85149',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }

  const optionsRef = useRef(null);
  if (!optionsRef.current) {
    optionsRef.current = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            color: '#8b949e',
            maxTicksLimit: 8,
            autoSkip: true,
            callback: (value) =>
              fmtTime(value, isPausedRef.current, refEndRef.current, windowSecRef.current * 1000),
          },
          grid: { color: '#21262d' },
        },
        y: {
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' },
          title: { display: true, text: 'mV', color: '#8b949e' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const v = items[0].parsed.x + BASE; // relatif → epoch absolut
              const d = new Date(v);
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              const ss = String(d.getSeconds()).padStart(2, '0');
              const whole = Math.floor(v);
              const ms = String(whole % 1000).padStart(3, '0');
              const sub = String(Math.round((v - whole) * 100)).padStart(2, '0');
              return `${hh}:${mm}:${ss}.${ms}${sub}`;
            },
            label: (c) => `${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)} mV`,
          },
        },
      },
    };
  }

  return (
    <div className={`card space-y-3 ${leak ? 'border-danger' : ''}`}>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">
          Time Series — {CH_NAMES[channel]}
        </h3>

        <button
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
            isPaused ? 'border-warn bg-warn/15 text-warn' : 'border-border hover:bg-border'
          }`}
          onClick={doTogglePause}
          title="Pause / Resume (Space)"
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <label className="flex items-center gap-1 text-sm text-muted">
          Window:
          <select
            className="rounded-md border border-border bg-card px-2 py-1 text-text"
            value={windowSec}
            onChange={(e) => {
              const w = parseFloat(e.target.value);
              setWindowSec(w);
              windowSecRef.current = w;
              panOffsetRef.current = 0;
              setPanOffsetMs(0);
            }}
          >
            {WINDOWS.map((w) => (
              <option key={w.v} value={w.v}>
                {w.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border"
          onClick={exportCsv}
          title="Export buffered data ke CSV"
        >
          💾 Export CSV
        </button>

        {windowSec < 1 && (
          <span className="rounded bg-accent/15 px-2 py-1 text-xs text-accent">
            resample 10&nbsp;ms
          </span>
        )}
      </div>

      {/* Chart */}
      <div
        className={`relative h-[320px] ${
          isPaused ? (dragRef.current.active ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={resetPan}
      >
        <Line ref={chartRef} data={initialDataRef.current} options={optionsRef.current} />
        {isPaused && (
          <span className="pointer-events-none absolute right-3 top-2 rounded bg-warn/20 px-2 py-0.5 text-xs font-semibold text-warn">
            ⏸ PAUSED
          </span>
        )}
      </div>

      <p className="text-xs text-muted">
        Tip: <kbd className="rounded border border-border px-1">Space</kbd> pause/resume ·
        seret untuk pan (saat paused) · double-click reset pan · hover untuk nilai
      </p>
    </div>
  );
}
