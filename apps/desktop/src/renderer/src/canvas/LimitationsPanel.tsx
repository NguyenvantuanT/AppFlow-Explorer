import { flowLimitations } from '@appflow/model';
import { useMemo, useState } from 'react';
import { AlertIcon, ChevronIcon, InfoIcon } from '../components/icons';
import { useExplorer } from '../store';

/**
 * What the map does not know: unknown destinations, unverified flows,
 * ambiguous observations, stale corrections. Always reachable from the canvas.
 */
export function LimitationsPanel({ hiddenByFilters }: { hiddenByFilters: { screens: number; edges: number } }) {
  const project = useExplorer((s) => s.project);
  const ambiguous = useExplorer((s) => s.ambiguous);
  const stale = useExplorer((s) => s.staleCorrections);
  const hiddenByUser = useExplorer((s) => s.hiddenEdges.length);
  const select = useExplorer((s) => s.select);
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () => flowLimitations(project, { ambiguous, stale, hiddenByUser, hiddenByFilters }),
    [project, ambiguous, stale, hiddenByUser, hiddenByFilters],
  );
  if (!items.length || project.screens.length === 0) return null;
  const warnings = items.filter((i) => i.severity === 'warning').length;

  return (
    <div className="absolute bottom-4 left-1/2 z-10 w-[min(560px,calc(100%-480px))] min-w-[280px] -translate-x-1/2" data-testid="limitations">
      {open && (
        <ul className="mb-2 max-h-[300px] space-y-1 overflow-y-auto rounded-lg border border-line bg-panel/95 p-2 text-[12px] shadow-xl backdrop-blur">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={!item.edgeIds?.length}
                onClick={() => item.edgeIds?.[0] && select({ kind: 'edge', id: item.edgeIds[0] }, { focus: true })}
                className="flex w-full gap-2 rounded px-2 py-1.5 text-left leading-snug hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
                title={item.edgeIds?.length ? 'Show on the map' : undefined}
              >
                {item.severity === 'warning' ? (
                  <AlertIcon size={13} className="mt-0.5 shrink-0 text-warning" />
                ) : (
                  <InfoIcon size={13} className="mt-0.5 shrink-0 text-[#a3b3d4]" />
                )}
                <span className="text-ink-2">{item.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-auto flex items-center gap-2 rounded-lg border border-line bg-panel/95 px-3 py-1.5 text-[12px] text-ink-2 shadow-xl backdrop-blur hover:text-ink"
      >
        {warnings ? <AlertIcon size={13} className="text-warning" /> : <InfoIcon size={13} />}
        What this map does not know
        <span className="rounded bg-raised px-1.5 font-mono text-[10.5px]">{items.length}</span>
        <ChevronIcon size={12} className={open ? 'rotate-90' : '-rotate-90'} />
      </button>
    </div>
  );
}
