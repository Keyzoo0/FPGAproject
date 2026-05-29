const NODES = [
  { icon: '⚡', label: 'Analog Sensors', sub: ['A0–A3', '0–4 V'] },
  { icon: '📊', label: 'ADS1115', sub: ['16-bit ADC', 'I²C @ 100kHz'] },
  { icon: '🟪', label: 'FPGA Spartan-6', sub: ['I²C Master', 'UART TX'] },
  { icon: '🟦', label: 'Arduino Uno', sub: ['UART → USB', '@ 9600 baud'] },
  { icon: '🌐', label: 'Web Dashboard', sub: ['Web Serial API'] },
];

export default function SignalFlow() {
  return (
    <section className="card">
      <h2 className="mb-4 text-sm font-semibold">Signal Flow</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {NODES.map((n, i) => (
          <div key={n.label} className="flex flex-1 items-center gap-2">
            <div className="flow-node mx-auto">
              <div className="mb-2 text-3xl">{n.icon}</div>
              <div className="text-sm font-semibold">{n.label}</div>
              <div className="mt-1 text-[11px] leading-tight text-muted">
                {n.sub.map((s) => (
                  <div key={s}>{s}</div>
                ))}
              </div>
            </div>
            {i < NODES.length - 1 && <div className="flow-arrow" />}
          </div>
        ))}
      </div>
    </section>
  );
}
