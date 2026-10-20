import type { EdgeStatus } from '@appflow/model';

export const STATUS_META: Record<
  EdgeStatus,
  { label: string; short: string; color: string; dash?: string; badgeDash?: string; description: string }
> = {
  verified: {
    label: 'Verified at runtime',
    short: 'Verified',
    color: 'var(--color-primary)',
    description: 'Observed while exploring the running app.',
  },
  declared: {
    label: 'Declared in config',
    short: 'Declared',
    color: '#a78bfa',
    description: 'Explicit navigation configuration (route table, navigation graph, storyboard segue) — not observed at runtime.',
  },
  inferred: {
    label: 'Inferred from code',
    short: 'Inferred',
    color: 'var(--color-inferred)',
    dash: '6 5',
    badgeDash: '4 2',
    description: 'Found by static analysis only — not verified at runtime.',
  },
  unresolved: {
    label: 'Unresolved',
    short: 'Unresolved',
    color: 'var(--color-warning)',
    dash: '2 5',
    badgeDash: '2 2',
    description: 'The destination could not be determined automatically.',
  },
};

export function StatusBadge({ status, compact = false }: { status: EdgeStatus; compact?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.description}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)` }}
    >
      <svg width="14" height="6" aria-hidden>
        <line x1="0" y1="3" x2="14" y2="3" stroke={meta.color} strokeWidth="2" strokeDasharray={meta.badgeDash} />
      </svg>
      {compact ? meta.short : meta.label}
    </span>
  );
}
