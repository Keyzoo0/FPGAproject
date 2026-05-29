const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'info', label: 'Info' },
];

export default function Tabs({ active, onChange }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            active === t.id ? 'bg-accent text-black' : 'text-muted hover:text-text'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
