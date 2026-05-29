import { CH_COLORS, CH_NAMES } from '../lib/adc.js';
import { ConnState, serialSupported } from '../hooks/useSerial.js';

export default function ConnectGate({ connState, error, channel, onChannel, onConnect }) {
  const supported = serialSupported();
  const connecting = connState === ConnState.CONNECTING;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md">
        <div className="mb-1 text-center text-xl font-semibold">
          Sistem Deteksi Arus Bocor
        </div>
        <p className="mb-6 text-center text-sm text-muted">
          FPGA FSM · UART · Web Monitoring
        </p>

        {!supported && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            Web Serial API tidak didukung browser ini. Gunakan Chrome / Edge.
          </div>
        )}

        <label className="mb-2 block text-sm text-muted">Pilih Channel</label>
        <div className="mb-6 grid grid-cols-4 gap-2">
          {CH_NAMES.map((name, ch) => (
            <button
              key={ch}
              onClick={() => onChannel(ch)}
              className={`rounded-lg border p-3 text-center transition-colors ${
                channel === ch
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-card hover:bg-border'
              }`}
            >
              <span
                className="mx-auto mb-1 block h-2 w-2 rounded-full"
                style={{ background: CH_COLORS[ch] }}
              />
              <span className="text-sm font-medium">{name}</span>
            </button>
          ))}
        </div>

        <button
          className="btn-primary w-full"
          disabled={!supported || connecting}
          onClick={onConnect}
        >
          {connecting ? 'Menghubungkan…' : '🔌 Connect Serial Port'}
        </button>

        {error && (
          <p className="mt-3 text-center text-sm text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}
