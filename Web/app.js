// ============================================================
// ADC Monitor Dashboard - Production
// FPGA Spartan-6 + ADS1115 (4 channel) → Arduino → Web Serial
// Format input: "+12345,+12345,+12345,+12345\r\n"
// ============================================================
'use strict';

// ============ Constants ============
const LSB_MV          = 0.125;         // ADS1115 PGA ±4.096V → 0.125 mV/LSB
const FULL_SCALE_MV   = 4096;
const BAUD_RATE       = 9600;
const MAX_BUFFER      = 3000;          // 5 menit @ 10 Hz per channel
const LOG_MAX_LINES   = 500;
const CH_NAMES        = ['AIN0', 'AIN1', 'AIN2', 'AIN3'];
const CH_COLORS       = ['#58a6ff', '#3fb950', '#d29922', '#f85149'];
const CHART_PAD       = { top: 18, right: 12, bottom: 30, left: 60 };

// ============ DOM ============
const $ = (id) => document.getElementById(id);
const dom = {
    btnConnect:    $('btn-connect'),
    btnDisconnect: $('btn-disconnect'),
    statusDot:     $('status-dot'),
    statusText:    $('status-text'),
    liveDot:       $('live-dot'),
    liveRate:      $('live-rate'),
    valMv:         $('val-mv'),
    valV:          $('val-v'),
    valRaw:        $('val-raw'),
    valBuf:        $('val-buf'),
    cardChLabel:   $('card-ch-label'),
    chartChLabel:  $('chart-ch-label'),
    canvas:        $('chart'),
    tooltip:       $('tooltip'),
    pauseBadge:    $('pause-badge'),
    btnPause:      $('btn-pause'),
    pauseIcon:     $('pause-icon'),
    pauseLabel:    $('pause-label'),
    zoomSelect:    $('zoom-select'),
    overlayToggle: $('overlay-toggle'),
    btnExport:     $('btn-export'),
    log:           $('log'),
    btnClear:      $('btn-clear'),
    autoscroll:    $('autoscroll'),
    chTabs:        document.querySelectorAll('.ch-tab'),
    allCards:      document.querySelectorAll('.all-card'),
    nodes: {
        sensor:  $('node-sensor'),
        ads:     $('node-ads'),
        fpga:    $('node-fpga'),
        arduino: $('node-arduino'),
        web:     $('node-web')
    },
    arrows: document.querySelectorAll('.arrow')
};

const ctx = dom.canvas.getContext('2d');

// ============ Connection state machine ============
const ConnState = {
    IDLE:          'idle',
    CONNECTING:    'connecting',
    CONNECTED:     'connected',
    DISCONNECTING: 'disconnecting'
};

// ============ State ============
const state = {
    samples: [[], [], [], []],
    latest:  [null, null, null, null],
    activeCh: 0,
    overlay:  false,
    zoomSec:  20,
    isPaused: false,
    pauseEndMs: 0,
    panOffsetMs: 0,
    drag: { active: false, startX: 0, startPan: 0 },
    mouse: { x: null, y: null, inside: false },
    serial: {
        port: null,
        reader: null,
        keepReading: false,
        buffer: '',
        readPromise: null,
        connState: ConnState.IDLE
    },
    rateCounter: { count: 0, lastTime: Date.now(), rate: 0 },
    liveTimer: null
};

// ============ Render scheduling (avoid redundant draws) ============
let renderQueued = false;
function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        drawChart();
    });
}

// ============ Web Serial ============
function checkSerialSupport() {
    if (!('serial' in navigator)) {
        dom.btnConnect.disabled = true;
        dom.btnConnect.textContent = '❌ Web Serial tidak didukung';
        setStatus('Pakai Chrome / Edge untuk Web Serial API', 'error');
        return false;
    }
    return true;
}

function setConnState(s) {
    state.serial.connState = s;
    // UI follows state — single source of truth
    switch (s) {
        case ConnState.IDLE:
            dom.btnConnect.disabled = false;
            dom.btnDisconnect.disabled = true;
            break;
        case ConnState.CONNECTING:
            dom.btnConnect.disabled = true;
            dom.btnDisconnect.disabled = true;
            break;
        case ConnState.CONNECTED:
            dom.btnConnect.disabled = true;
            dom.btnDisconnect.disabled = false;
            break;
        case ConnState.DISCONNECTING:
            dom.btnConnect.disabled = true;
            dom.btnDisconnect.disabled = true;
            break;
    }
}

async function connectSerial() {
    if (state.serial.connState !== ConnState.IDLE) return;
    setConnState(ConnState.CONNECTING);
    setStatus('Requesting port...', 'idle');

    let port = null;
    try {
        port = await navigator.serial.requestPort();
        await port.open({
            baudRate: BAUD_RATE,
            dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'
        });
    } catch (err) {
        console.error('Connect failed:', err);
        setStatus('Error: ' + err.message, 'error');
        // If port was opened but something else failed, try to close
        if (port) { try { await port.close(); } catch {} }
        setConnState(ConnState.IDLE);
        return;
    }

    state.serial.port = port;
    state.serial.buffer = '';
    state.serial.keepReading = true;
    setStatus('Connected — receiving 4-channel data...', 'ok');
    activateAllArrows();
    setConnState(ConnState.CONNECTED);

    // Track the read loop promise for clean shutdown
    state.serial.readPromise = readLoop().catch(err => {
        console.error('Read loop crashed:', err);
    });
}

async function readLoop() {
    const decoder = new TextDecoder();
    let reader = null;

    try {
        reader = state.serial.port.readable.getReader();
        state.serial.reader = reader;

        while (state.serial.keepReading) {
            const { value, done } = await reader.read();
            if (done) break;
            state.serial.buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = state.serial.buffer.indexOf('\n')) !== -1) {
                const line = state.serial.buffer.slice(0, nl).replace(/\r$/, '');
                state.serial.buffer = state.serial.buffer.slice(nl + 1);
                if (line.length > 0) processLine(line);
            }
        }
    } catch (err) {
        // err is expected when reader.cancel() called during disconnect
        if (state.serial.keepReading) {
            // Unexpected error (USB unplug, etc.) → trigger forced cleanup
            console.error('Read loop error:', err);
            setStatus('Connection lost: ' + err.message, 'error');
            // Schedule forced cleanup (don't await — we are inside the loop)
            queueMicrotask(() => forcedDisconnect());
        }
    } finally {
        if (reader) {
            try { reader.releaseLock(); } catch {}
        }
        state.serial.reader = null;
    }
}

async function disconnectSerial() {
    if (state.serial.connState !== ConnState.CONNECTED) return;
    setConnState(ConnState.DISCONNECTING);
    setStatus('Disconnecting...', 'idle');

    state.serial.keepReading = false;

    // 1. Cancel pending read — this aborts the in-flight reader.read() with an error
    if (state.serial.reader) {
        try {
            await state.serial.reader.cancel();
        } catch (err) {
            console.warn('reader.cancel():', err);
        }
    }

    // 2. Wait for read loop to fully exit (release lock) — with 3s timeout
    if (state.serial.readPromise) {
        try {
            await Promise.race([
                state.serial.readPromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('readLoop wait timeout')), 3000))
            ]);
        } catch (err) {
            console.warn('readLoop wait:', err.message);
        }
        state.serial.readPromise = null;
    }

    // 3. Now safe to close port (reader has released lock)
    if (state.serial.port) {
        try {
            await state.serial.port.close();
        } catch (err) {
            console.warn('port.close():', err);
        }
    }

    cleanupAfterDisconnect('Disconnected', 'idle');
}

function forcedDisconnect() {
    // Called when port dies unexpectedly (USB unplug, OS error)
    if (state.serial.connState === ConnState.IDLE ||
        state.serial.connState === ConnState.DISCONNECTING) return;

    state.serial.keepReading = false;

    // Best-effort cleanup, don't wait
    if (state.serial.reader) {
        try { state.serial.reader.cancel().catch(() => {}); } catch {}
    }
    if (state.serial.port) {
        try { state.serial.port.close().catch(() => {}); } catch {}
    }

    cleanupAfterDisconnect('Disconnected (port lost)', 'error');
}

function cleanupAfterDisconnect(statusMsg, statusType) {
    state.serial.port = null;
    state.serial.reader = null;
    state.serial.buffer = '';
    state.serial.keepReading = false;
    state.serial.readPromise = null;

    setStatus(statusMsg, statusType);
    setConnState(ConnState.IDLE);
    deactivateAllNodes();
    deactivateAllArrows();
    dom.liveDot.classList.remove('active');
}

// ============ Data parsing ============
function processLine(line) {
    appendLog(line);

    const parts = line.split(',');
    if (parts.length !== 4) return;

    const values = parts.map(p => {
        const m = p.match(/^([+-])(\d{1,6})$/);
        if (!m) return NaN;
        return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
    });
    if (values.some(v => Number.isNaN(v))) return;

    const t = Date.now();
    for (let ch = 0; ch < 4; ch++) {
        const raw = values[ch];
        const mv = raw * LSB_MV;
        state.latest[ch] = { raw, mv, t };
        state.samples[ch].push({ t, mv, raw });
        if (state.samples[ch].length > MAX_BUFFER) {
            state.samples[ch].shift();
        }
    }

    updateMiniValues();
    updateActiveCards();
    updateSampleRate();
    flashLive();
    requestRender();
}

// ============ Sample rate ============
function updateSampleRate() {
    state.rateCounter.count++;
    const now = Date.now();
    const dt = now - state.rateCounter.lastTime;
    if (dt >= 1000) {
        state.rateCounter.rate = (state.rateCounter.count * 1000) / dt;
        state.rateCounter.count = 0;
        state.rateCounter.lastTime = now;
        dom.liveRate.textContent = state.rateCounter.rate.toFixed(1) + ' Hz';
    }
}

function flashLive() {
    dom.liveDot.classList.add('active');
    if (state.liveTimer) clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(() => dom.liveDot.classList.remove('active'), 300);
}

// ============ UI Updates ============
function updateMiniValues() {
    for (let ch = 0; ch < 4; ch++) {
        const v = state.latest[ch];
        if (!v) continue;
        $('mini-' + ch).textContent = v.mv.toFixed(1) + ' mV';
        $('all-' + ch).textContent  = v.mv.toFixed(2);
        const pct = Math.max(0, Math.min(100, (v.mv / FULL_SCALE_MV) * 100));
        $('bar-' + ch).style.width = pct + '%';
    }
    dom.valBuf.textContent = state.samples[0].length;
}

function updateActiveCards() {
    const v = state.latest[state.activeCh];
    if (!v) return;
    dom.valRaw.textContent = v.raw.toString().padStart(6, ' ');
    dom.valMv.textContent  = v.mv.toFixed(2);
    dom.valV.textContent   = (v.mv / 1000).toFixed(4);
}

function setActiveChannel(ch) {
    state.activeCh = ch;
    dom.chTabs.forEach((t, i) => t.classList.toggle('active', i === ch));
    dom.cardChLabel.textContent  = CH_NAMES[ch];
    dom.chartChLabel.textContent = state.overlay ? 'All Channels' : CH_NAMES[ch];
    updateActiveCards();
    requestRender();
}

// ============ Log ============
function appendLog(line) {
    const d = new Date();
    const ts = d.toLocaleTimeString('id-ID', { hour12: false }) +
               '.' + String(d.getMilliseconds()).padStart(3, '0');
    dom.log.textContent += `[${ts}]  ${line}\n`;
    const lines = dom.log.textContent.split('\n');
    if (lines.length > LOG_MAX_LINES) {
        dom.log.textContent = lines.slice(-LOG_MAX_LINES).join('\n');
    }
    if (dom.autoscroll.checked) {
        dom.log.scrollTop = dom.log.scrollHeight;
    }
}

// ============ Status / Flow Diagram ============
function setStatus(text, type) {
    dom.statusText.textContent = text;
    dom.statusDot.className = 'status-dot';
    if (type === 'ok')    dom.statusDot.classList.add('connected');
    if (type === 'error') dom.statusDot.classList.add('error');
}

function activateAllArrows()   { dom.arrows.forEach(a => a.classList.add('active'));    }
function deactivateAllArrows() { dom.arrows.forEach(a => a.classList.remove('active')); }
function deactivateAllNodes()  { Object.values(dom.nodes).forEach(n => n.classList.remove('active')); }

// ============ Pause / Resume ============
function togglePause() {
    state.isPaused = !state.isPaused;
    if (state.isPaused) {
        state.pauseEndMs = Date.now();
        state.panOffsetMs = 0;
        dom.pauseIcon.textContent = '▶';
        dom.pauseLabel.textContent = 'Resume';
        dom.btnPause.classList.add('active');
        dom.pauseBadge.classList.add('show');
        dom.canvas.classList.add('pannable');
    } else {
        state.panOffsetMs = 0;
        dom.pauseIcon.textContent = '⏸';
        dom.pauseLabel.textContent = 'Pause';
        dom.btnPause.classList.remove('active');
        dom.pauseBadge.classList.remove('show');
        dom.canvas.classList.remove('pannable');
    }
    requestRender();
}

// ============ View window calc ============
function getViewWindow() {
    const zoomMs = state.zoomSec * 1000;
    const refEnd = state.isPaused ? state.pauseEndMs : Date.now();
    const viewEnd = refEnd + state.panOffsetMs;
    const viewStart = viewEnd - zoomMs;
    return { viewStart, viewEnd, zoomMs };
}

function clampPan() {
    const zoomMs = state.zoomSec * 1000;
    const refEnd = state.pauseEndMs;
    const allSamples = state.samples.flat();
    if (allSamples.length === 0) return;
    const oldest = Math.min(...state.samples.map(arr => arr.length ? arr[0].t : Infinity));
    if (!isFinite(oldest)) return;
    // Right boundary: don't pan past pause time
    if (state.panOffsetMs > 0) state.panOffsetMs = 0;
    // Left boundary: don't pan before oldest sample
    const minPan = oldest - refEnd + zoomMs * 0.1; // small headroom
    if (state.panOffsetMs < minPan) state.panOffsetMs = minPan;
}

// ============ Chart rendering ============
function getCanvasSize() {
    const rect = dom.canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
}

function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dom.canvas.width  = Math.round(rect.width * dpr);
    dom.canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestRender();
}

function visibleSamples(arr, viewStart, viewEnd) {
    if (!arr.length) return [];
    // Find indices via binary-search-light (samples are sorted by t)
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].t < viewStart) lo = mid + 1;
        else hi = mid;
    }
    const startIdx = Math.max(0, lo - 1);
    // Linear scan from startIdx until > viewEnd
    const out = [];
    for (let i = startIdx; i < arr.length; i++) {
        if (arr[i].t > viewEnd) break;
        out.push(arr[i]);
    }
    return out;
}

function tickStep(rangeMs) {
    // Pick nice tick step ~5-8 ticks
    const candidates = [
        50, 100, 200, 500,
        1000, 2000, 5000,
        10000, 15000, 30000,
        60000, 120000, 300000,
        600000
    ];
    const target = rangeMs / 6;
    for (const c of candidates) if (c >= target) return c;
    return candidates[candidates.length - 1];
}

function formatXLabel(t, isPausedMode, refEnd, stepMs) {
    if (isPausedMode) {
        const d = new Date(t);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        if (stepMs < 100) {
            // Show 2 decimal places (10ms resolution)
            const ms = String(d.getMilliseconds()).padStart(3, '0');
            return `${ss}.${ms}`;
        }
        if (stepMs < 1000) {
            const ms = String(d.getMilliseconds()).padStart(3, '0');
            return `${hh}:${mm}:${ss}.${ms}`;
        }
        return `${hh}:${mm}:${ss}`;
    } else {
        const dt = (t - refEnd) / 1000;
        if (stepMs < 100) return dt.toFixed(2) + 's';
        if (stepMs < 1000) return dt.toFixed(1) + 's';
        return Math.round(dt) + 's';
    }
}

function drawChart() {
    const { w, h } = getCanvasSize();
    const W = w, H = h;
    ctx.clearRect(0, 0, W, H);

    const { viewStart, viewEnd, zoomMs } = getViewWindow();
    const plotL = CHART_PAD.left;
    const plotR = W - CHART_PAD.right;
    const plotT = CHART_PAD.top;
    const plotB = H - CHART_PAD.bottom;
    const plotW = plotR - plotL;
    const plotH = plotB - plotT;

    // Plot background
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(plotL, plotT, plotW, plotH);

    // Channels to draw
    const channels = state.overlay ? [0, 1, 2, 3] : [state.activeCh];

    // Collect visible samples and compute Y range
    const visible = channels.map(ch => visibleSamples(state.samples[ch], viewStart, viewEnd));
    const allMv = visible.flat().map(s => s.mv);
    if (allMv.length === 0) {
        drawAxes(plotL, plotR, plotT, plotB, viewStart, viewEnd, zoomMs, 0, FULL_SCALE_MV);
        ctx.fillStyle = '#8b949e';
        ctx.font = '14px monospace';
        const msg = 'Waiting for data...';
        const tm = ctx.measureText(msg);
        ctx.fillText(msg, (plotL + plotR) / 2 - tm.width / 2, (plotT + plotB) / 2);
        return;
    }

    let minV = Math.min(...allMv);
    let maxV = Math.max(...allMv);
    if (maxV - minV < 10) {
        const mid = (maxV + minV) / 2;
        minV = mid - 5; maxV = mid + 5;
    }
    const pad = (maxV - minV) * 0.1;
    minV -= pad; maxV += pad;
    const yRange = maxV - minV;

    // Axes & grid
    drawAxes(plotL, plotR, plotT, plotB, viewStart, viewEnd, zoomMs, minV, maxV);

    // Plot each channel
    const xOf = t => plotL + ((t - viewStart) / zoomMs) * plotW;
    const yOf = v => plotB - ((v - minV) / yRange) * plotH;

    visible.forEach((samples, idx) => {
        if (samples.length < 1) return;
        const ch = channels[idx];
        const color = CH_COLORS[ch];

        // Filled area (only in single channel mode, not overlay)
        if (!state.overlay && samples.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(xOf(samples[0].t), plotB);
            samples.forEach(s => ctx.lineTo(xOf(s.t), yOf(s.mv)));
            ctx.lineTo(xOf(samples[samples.length - 1].t), plotB);
            ctx.closePath();
            ctx.fillStyle = color + '20';
            ctx.fill();
        }

        // Line
        ctx.beginPath();
        samples.forEach((s, i) => {
            const x = xOf(s.t); const y = yOf(s.mv);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Last point dot
        const last = samples[samples.length - 1];
        const lx = xOf(last.t), ly = yOf(last.mv);
        if (lx >= plotL && lx <= plotR) {
            ctx.beginPath();
            ctx.arc(lx, ly, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#0a0d12';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    // Crosshair (only when mouse inside chart and not dragging)
    if (state.mouse.inside && !state.drag.active &&
        state.mouse.x >= plotL && state.mouse.x <= plotR &&
        state.mouse.y >= plotT && state.mouse.y <= plotB) {
        drawCrosshair(plotL, plotR, plotT, plotB, viewStart, viewEnd, minV, maxV, channels, visible);
    }

    // Legend (overlay mode)
    if (state.overlay) drawLegend(plotR, plotT, channels);

    // Statistics overlay
    drawStats(plotL, plotT, channels, visible);
}

function drawAxes(plotL, plotR, plotT, plotB, viewStart, viewEnd, zoomMs, minV, maxV) {
    // Y-axis grid + labels (5 ticks)
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
        const v = minV + ((maxV - minV) / 4) * (4 - i);
        const y = plotT + ((plotB - plotT) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(0), plotL - 6, y);
    }

    // X-axis grid + labels
    const stepMs = tickStep(zoomMs);
    const firstTick = Math.ceil(viewStart / stepMs) * stepMs;
    const refEnd = state.isPaused ? state.pauseEndMs : Date.now();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let t = firstTick; t <= viewEnd; t += stepMs) {
        const x = plotL + ((t - viewStart) / zoomMs) * (plotR - plotL);
        if (x < plotL || x > plotR) continue;
        ctx.strokeStyle = '#21262d';
        ctx.beginPath();
        ctx.moveTo(x, plotT);
        ctx.lineTo(x, plotB);
        ctx.stroke();
        ctx.fillStyle = '#8b949e';
        ctx.fillText(formatXLabel(t, state.isPaused, refEnd, stepMs), x, plotB + 6);
    }

    // Axis labels
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('mV', plotL - 50, plotT - 14);
    ctx.textAlign = 'right';
    ctx.fillText(state.isPaused ? 'time (absolute)' : 'time (s before now)', plotR, plotB + 18);
}

function drawCrosshair(plotL, plotR, plotT, plotB, viewStart, viewEnd, minV, maxV, channels, visible) {
    const zoomMs = viewEnd - viewStart;
    const tAt = viewStart + ((state.mouse.x - plotL) / (plotR - plotL)) * zoomMs;

    // Vertical line
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(state.mouse.x, plotT);
    ctx.lineTo(state.mouse.x, plotB);
    ctx.stroke();
    ctx.setLineDash([]);

    // Find nearest sample per channel
    const yRange = maxV - minV;
    const tooltipLines = [];
    const d = new Date(tAt);
    const ts = String(d.getHours()).padStart(2,'0') + ':' +
               String(d.getMinutes()).padStart(2,'0') + ':' +
               String(d.getSeconds()).padStart(2,'0') + '.' +
               String(d.getMilliseconds()).padStart(3,'0');
    tooltipLines.push('⏱  ' + ts);

    let dotY = state.mouse.y;
    channels.forEach((ch, idx) => {
        const samples = visible[idx];
        if (!samples.length) return;
        // Binary search nearest
        let lo = 0, hi = samples.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (samples[mid].t < tAt) lo = mid + 1;
            else hi = mid;
        }
        const a = samples[Math.max(0, lo - 1)];
        const b = samples[lo];
        const near = (Math.abs(a.t - tAt) < Math.abs(b.t - tAt)) ? a : b;
        const y = plotB - ((near.mv - minV) / yRange) * (plotB - plotT);

        // Marker
        ctx.beginPath();
        ctx.arc(state.mouse.x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = CH_COLORS[ch];
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        tooltipLines.push(`${CH_NAMES[ch]}: ${near.mv.toFixed(2)} mV  (raw ${near.raw})`);
        if (ch === state.activeCh) dotY = y;
    });

    // Tooltip
    const rect = dom.canvas.getBoundingClientRect();
    const tipX = state.mouse.x + 12;
    const tipY = Math.max(plotT, dotY - 10);
    const flipped = tipX > plotR - 200;
    dom.tooltip.style.display = 'block';
    dom.tooltip.style.left = (flipped ? state.mouse.x - 220 : tipX) + 'px';
    dom.tooltip.style.top  = tipY + 'px';
    dom.tooltip.textContent = tooltipLines.join('\n');
}

function drawLegend(plotR, plotT, channels) {
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    let y = plotT + 6;
    channels.forEach(ch => {
        ctx.fillStyle = CH_COLORS[ch];
        ctx.fillRect(plotR - 70, y + 4, 12, 4);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(CH_NAMES[ch], plotR - 4, y);
        y += 16;
    });
}

function drawStats(plotL, plotT, channels, visible) {
    // Show min/max/mean for active channel (or all in overlay mode show count)
    const idx = state.overlay ? -1 : 0;
    let lines;
    if (idx === -1) {
        lines = ['samples: ' + visible[0].length];
    } else {
        const samples = visible[0];
        if (samples.length === 0) return;
        let min = Infinity, max = -Infinity, sum = 0;
        for (const s of samples) {
            if (s.mv < min) min = s.mv;
            if (s.mv > max) max = s.mv;
            sum += s.mv;
        }
        const mean = sum / samples.length;
        lines = [
            'min:  ' + min.toFixed(1) + ' mV',
            'max:  ' + max.toFixed(1) + ' mV',
            'mean: ' + mean.toFixed(1) + ' mV',
            'n:    ' + samples.length
        ];
    }
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = plotL + 6;
    let y = plotT + 6;
    const w = 130, h = lines.length * 14 + 8;
    ctx.fillStyle = 'rgba(13,17,23,0.7)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#30363d';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#8b949e';
    lines.forEach((l, i) => ctx.fillText(l, x + 6, y + 4 + i * 14));
}

// ============ Mouse interaction ============
function onMouseMove(e) {
    const rect = dom.canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
    state.mouse.inside = true;

    if (state.drag.active && state.isPaused) {
        const dx = e.clientX - state.drag.startX;
        const { zoomMs } = getViewWindow();
        // pan: dragging right shifts view back in time
        const pxPerMs = (rect.width - CHART_PAD.left - CHART_PAD.right) / zoomMs;
        state.panOffsetMs = state.drag.startPan - dx / pxPerMs;
        clampPan();
    }
    requestRender();
}

function onMouseLeave() {
    state.mouse.inside = false;
    dom.tooltip.style.display = 'none';
    requestRender();
}

function onMouseDown(e) {
    if (!state.isPaused) return;
    state.drag.active = true;
    state.drag.startX = e.clientX;
    state.drag.startPan = state.panOffsetMs;
    dom.canvas.classList.add('panning');
    dom.canvas.classList.remove('pannable');
    dom.tooltip.style.display = 'none';
}

function onMouseUp() {
    if (state.drag.active) {
        state.drag.active = false;
        dom.canvas.classList.remove('panning');
        if (state.isPaused) dom.canvas.classList.add('pannable');
    }
}

function onDoubleClick() {
    state.panOffsetMs = 0;
    requestRender();
}

// ============ Export CSV ============
function exportCsv() {
    if (state.samples[0].length === 0) {
        alert('Buffer kosong - tidak ada data untuk di-export.');
        return;
    }
    const rows = [];
    rows.push('timestamp_ms,iso_time,ch0_raw,ch1_raw,ch2_raw,ch3_raw,ch0_mv,ch1_mv,ch2_mv,ch3_mv');
    const N = state.samples[0].length;
    for (let i = 0; i < N; i++) {
        const s0 = state.samples[0][i];
        const s1 = state.samples[1][i];
        const s2 = state.samples[2][i];
        const s3 = state.samples[3][i];
        if (!s0 || !s1 || !s2 || !s3) continue;
        const iso = new Date(s0.t).toISOString();
        rows.push([
            s0.t, iso,
            s0.raw, s1.raw, s2.raw, s3.raw,
            s0.mv.toFixed(3), s1.mv.toFixed(3), s2.mv.toFixed(3), s3.mv.toFixed(3)
        ].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `adc_data_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============ Event bindings ============
dom.btnConnect.addEventListener('click', connectSerial);
dom.btnDisconnect.addEventListener('click', disconnectSerial);
dom.btnPause.addEventListener('click', togglePause);
dom.btnExport.addEventListener('click', exportCsv);

dom.btnClear.addEventListener('click', () => {
    dom.log.textContent = '';
    state.samples.forEach(arr => arr.length = 0);
    requestRender();
});

dom.zoomSelect.addEventListener('change', (e) => {
    state.zoomSec = parseFloat(e.target.value);
    state.panOffsetMs = 0;
    requestRender();
});

dom.overlayToggle.addEventListener('change', (e) => {
    state.overlay = e.target.checked;
    dom.chartChLabel.textContent = state.overlay ? 'All Channels' : CH_NAMES[state.activeCh];
    requestRender();
});

dom.chTabs.forEach(tab => {
    tab.addEventListener('click', () => setActiveChannel(parseInt(tab.dataset.ch, 10)));
});

dom.allCards.forEach(card => {
    card.addEventListener('click', () => setActiveChannel(parseInt(card.dataset.ch, 10)));
});

dom.canvas.addEventListener('mousemove', onMouseMove);
dom.canvas.addEventListener('mouseleave', onMouseLeave);
dom.canvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
dom.canvas.addEventListener('dblclick', onDoubleClick);

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
    }
});

window.addEventListener('resize', resizeCanvas);

// ============ Live refresh tick (for live mode time axis) ============
// Even when no new data, we want time axis to scroll in live mode.
setInterval(() => {
    if (!state.isPaused && state.samples[0].length > 0) {
        requestRender();
    }
}, 100);

// ============ Auto cleanup on USB unplug / tab close ============
if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (e) => {
        // Fires when the connected device is physically unplugged
        if (e.target === state.serial.port) {
            console.warn('Serial device disconnected externally');
            forcedDisconnect();
        }
    });
}

// Best-effort cleanup when page closes/refreshes — release the port lock so
// next page load (or app) can open it without driver getting stuck.
function bestEffortCleanup() {
    if (state.serial.connState === ConnState.IDLE) return;
    state.serial.keepReading = false;
    try { if (state.serial.reader) state.serial.reader.cancel().catch(() => {}); } catch {}
    try { if (state.serial.port)   state.serial.port.close().catch(() => {});  } catch {}
}
window.addEventListener('beforeunload', bestEffortCleanup);
window.addEventListener('pagehide', bestEffortCleanup);

// ============ Init ============
checkSerialSupport();
resizeCanvas();
setStatus('Disconnected', 'idle');
setConnState(ConnState.IDLE);
