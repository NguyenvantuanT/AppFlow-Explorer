import { useState } from 'react';
import { useExplorer } from '../store';
import { AlertIcon, RefreshIcon } from './icons';

/** Tells the user the map is older than the code, and offers a re-analysis. */
export function SourceChangesBanner() {
  const changes = useExplorer((s) => s.sourceChanges);
  const reanalyze = useExplorer((s) => s.reanalyze);
  const analyzing = useExplorer((s) => s.workspace.status === 'analyzing');
  const [details, setDetails] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!changes) return null;
  const key = JSON.stringify(changes.counts) + changes.added.join() + changes.removed.join() + changes.modified.join();
  if (dismissed === key) return null;
  const { added, removed, modified } = changes.counts;
  const parts = [modified && `${modified} edited`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(', ');
  const total = added + removed + modified;
  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12.5px] text-ink" data-testid="source-changes">
      <div className="flex items-center gap-2">
        <AlertIcon size={14} className="shrink-0 text-warning" />
        <span>
          {total} file{total === 1 ? '' : 's'} changed since this analysis ({parts}). The map may be out of date.
        </span>
        <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="text-primary hover:underline">
          {details ? 'Hide files' : 'Show files'}
        </button>
        <button
          type="button"
          disabled={analyzing}
          onClick={() => void reanalyze()}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 font-semibold text-white hover:bg-[#2f74e6] disabled:opacity-50"
        >
          <RefreshIcon size={13} /> {analyzing ? 'Re-analyzing…' : 'Re-analyze'}
        </button>
        <button type="button" onClick={() => setDismissed(key)} className="rounded-md px-2 py-1 text-ink-2 hover:bg-raised">
          Dismiss
        </button>
      </div>
      {details && (
        <ul className="mt-1.5 max-h-32 overflow-y-auto pl-6 font-mono text-[11.5px] text-ink-2">
          {changes.modified.map((p) => <li key={`m${p}`}>M {p}</li>)}
          {changes.added.map((p) => <li key={`a${p}`}>A {p}</li>)}
          {changes.removed.map((p) => <li key={`r${p}`}>D {p}</li>)}
          {total > changes.modified.length + changes.added.length + changes.removed.length && <li>…</li>}
        </ul>
      )}
    </div>
  );
}
