import { useEffect, useMemo, useRef, useState } from 'react';
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
import { CH_COLORS, CH_NAMES, rawToMv } from '../lib/adc.js';

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip, Legend, Filler);

const WINDOWS = [
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

function fmtTime(value, paused, refEnd, windowMs) {
  if (paused) {
    const d = new Date(value);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    if (windowMs < 2000) {
      return `${ss}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }
    return `${hh}:${mm}:${ss}`;
  }
  const dt = (value - refEnd) / 1000;
  if (windowMs < 2000) return dt.toFixed(2) + 's';
  if (windowMs < 10000) return dt.toFixed(1) + 's';
  return Math.round(dt) + 's';
}

export default function LeakChart({ samples, channel, tripRaw, leak }) {
  const color = CH_COLORS[channel];
  const chartRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startPan: 0 });

  const [windowSec, setWindowSec] = useState(20);
  const [isPaused, setIsPaused] = useState(false);
  const [panOffsetMs, setPanOffsetMs] = useState(0);
  const [pauseEndMs, setPauseEndMs] = useState(0);
  const [, setTick] = useState(0);

  // Keep the time axis scrolling in live mode even without re-render from props
  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [isPaused]);

  // Space = pause/resume (global, ignore form fields)
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused((p) => {
          if (!p) setPauseEndMs(Date.now());
          setPanOffsetMs(0);
          return !p;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePause = () => {
    setIsPaused((p) => {
      if (!p) setPauseEndMs(Date.now());
      setPanOffsetMs(0);
      return !p;
    });
  };

  // View window
  const windowMs = windowSec * 1000;
  const refEnd = isPaused ? pauseEndMs : Date.now();
  const viewEnd = refEnd + panOffsetMs;
  const viewStart = viewEnd - windowMs;

  // Drag-to-pan (only when paused)
  const onPointerDown = (e) => {
    if (!isPaused) return;
    dragRef.current = { active: true, startX: e.clientX, startPan: panOffsetMs };
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.active || !isPaused) return;
    const chart = chartRef.current;
    if (!chart || !chart.chartArea) return;
    const pxPerMs = chart.chartArea.width / windowMs;
    const dx = e.clientX - drag.startX;
    let p = drag.startPan - dx / pxPerMs;
    if (p > 0) p = 0;
    if (samples.length) {
      const minPan = samples[0].t - pauseEndMs + windowMs * 0.1;
      if (p < minPan) p = minPan;
    }
    setPanOffsetMs(p);
  };
  const onPointerUp = () => {
    dragRef.current.active = false;
  };
  const resetPan = () => setPanOffsetMs(0);

  const exportCsv = () => {
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

  const data = useMemo(() => {
    const tripMv = Number.isFinite(tripRaw) ? rawToMv(tripRaw) : null;
    return {
      datasets: [
        {
          label: `${CH_NAMES[channel]} (mV)`,
          data: samples.map((s) => ({ x: s.t, y: s.mv })),
          borderColor: color,
          backgroundColor: color + '22',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.25,
        },
        ...(tripMv !== null
          ? [
              {
                label: 'Threshold bocor',
                data: [
                  { x: viewStart, y: tripMv },
                  { x: viewEnd, y: tripMv },
                ],
                borderColor: '#f85149',
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
              },
            ]
          : []),
      ],
    };
  }, [samples, channel, tripRaw, color, viewStart, viewEnd]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: viewStart,
          max: viewEnd,
          ticks: {
            color: '#8b949e',
            maxTicksLimit: 8,
            autoSkip: true,
            callback: (value) => fmtTime(value, isPaused, refEnd, windowMs),
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
              const d = new Date(items[0].parsed.x);
              return d.toLocaleTimeString('id-ID', { hour12: false });
            },
            label: (c) => `${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)} mV`,
          },
        },
      },
    }),
    [viewStart, viewEnd, isPaused, refEnd, windowMs]
  );

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
          onClick={togglePause}
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
              setWindowSec(parseFloat(e.target.value));
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
      </div>

      {/* Chart */}
      <div
        className={`relative h-[320px] ${isPaused ? (dragRef.current.active ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={resetPan}
      >
        <Line ref={chartRef} data={data} options={options} />
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
