import { featureLabel, featureOfPath, type NavigationEdge, type NavigationKind, type Screen } from '@appflow/model';
import { useMemo, useState } from 'react';
import { useExplorer } from '../store';

const inputClass = 'w-full rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[12px] text-ink outline-none focus:border-primary';
const buttonClass = 'rounded-md border border-line-strong px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent';

function useSortedScreens() {
  const screens = useExplorer((s) => s.project.screens);
  return useMemo(() => [...screens].sort((a, b) => a.name.localeCompare(b.name)), [screens]);
}

/** Corrections on one connection: hide it, delete it (if added by hand), or pick an unknown destination. */
export function EdgeCorrections({ edge }: { edge: NavigationEdge }) {
  const hideEdge = useExplorer((s) => s.hideEdge);
  const resolveEdge = useExplorer((s) => s.resolveEdge);
  const screens = useSortedScreens();
  const added = !!edge.correction?.addedByUser;
  const canResolve = edge.to === null || !!edge.correction?.resolvedByUser;

  return (
    <div className="space-y-2.5">
      {canResolve && (
        <label className="block">
          <span className="mb-1 block text-muted">{edge.to === null ? 'Set the destination you know is right' : 'Destination (chosen by you)'}</span>
          <select className={inputClass} value={edge.to ?? ''} onChange={(e) => resolveEdge(edge.id, e.target.value || null)} aria-label="Destination">
            <option value="">{edge.to === null ? 'Unknown — choose a screen…' : 'Clear — back to unknown'}</option>
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className={buttonClass} onClick={() => hideEdge(edge.id)}>
        {added ? 'Delete this connection' : 'Mark as incorrect (hide)'}
      </button>
      <p className="text-[11px] leading-relaxed text-muted">
        Corrections are saved on this computer, kept when the project is re-analyzed, and shown as “Set by you”. They never count as verified.
      </p>
    </div>
  );
}

const KINDS: NavigationKind[] = ['push', 'replace', 'reset', 'modal', 'tab', 'pop'];

/** Corrections on one screen: its feature group, and connections the analysis missed. */
export function ScreenCorrections({ screen }: { screen: Screen }) {
  const addEdge = useExplorer((s) => s.addEdge);
  const setFeature = useExplorer((s) => s.setFeature);
  const select = useExplorer((s) => s.select);
  const graph = useExplorer((s) => s.graph);
  const override = useExplorer((s) => s.corrections.featureOverrides[screen.id]);
  const screens = useSortedScreens();
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<NavigationKind>('push');
  const detected = featureOfPath(screen.location.fileId);
  const features = useMemo(() => [...new Set(graph.nodes.filter((n) => n.type === 'screen').map((n) => n.feature))].sort(), [graph]);
  const [featureDraft, setFeatureDraft] = useState(override ?? detected);

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-muted">Feature group</span>
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            list={`features-${screen.id}`}
            value={featureDraft}
            onChange={(e) => setFeatureDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setFeature(screen.id, featureDraft === detected ? null : featureDraft)}
            aria-label="Feature group"
          />
          <datalist id={`features-${screen.id}`}>
            {features.map((f) => (
              <option key={f} value={f}>
                {featureLabel(f)}
              </option>
            ))}
          </datalist>
          <button type="button" className={buttonClass} onClick={() => setFeature(screen.id, featureDraft === detected ? null : featureDraft)}>
            Set
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Detected from the folder: <span className="text-ink-2">{featureLabel(detected)}</span>
          {override && (
            <>
              {' · '}
              <button type="button" className="text-primary hover:underline" onClick={() => (setFeature(screen.id, null), setFeatureDraft(detected))}>
                use detected
              </button>
            </>
          )}
        </p>
      </div>

      <div>
        <span className="mb-1 block text-muted">Add a connection analysis missed</span>
        <div className="space-y-1.5">
          <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Connection destination">
            <option value="">Goes to…</option>
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <input className={inputClass} placeholder="Action, e.g. Tap Sign in" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Connection action" />
            <select className={`${inputClass} w-[96px]`} value={kind} onChange={(e) => setKind(e.target.value as NavigationKind)} aria-label="Navigation kind">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={!to}
            onClick={() => {
              const id = addEdge({ from: screen.id, to, label, kind });
              setTo('');
              setLabel('');
              select({ kind: 'edge', id }, { focus: true });
            }}
          >
            Add connection
          </button>
        </div>
      </div>
    </div>
  );
}

/** Overview of the user's corrections: hidden connections can be restored. */
export function CorrectionsOverview() {
  const corrections = useExplorer((s) => s.corrections);
  const hidden = useExplorer((s) => s.hiddenEdges);
  const stale = useExplorer((s) => s.staleCorrections);
  const index = useExplorer((s) => s.index);
  const restoreEdge = useExplorer((s) => s.restoreEdge);
  const resetCorrections = useExplorer((s) => s.resetCorrections);
  const name = (id: string | null) => (id ? (index.screensById.get(id)?.name ?? id) : 'Unknown destination');

  const total = corrections.hiddenEdges.length + corrections.addedEdges.length + Object.keys(corrections.edgeTargets).length + Object.keys(corrections.featureOverrides).length;
  if (!total) return <p className="text-muted">None. Select a screen or connection to add, hide or complete connections.</p>;

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-ink-2">
        {corrections.addedEdges.length} added · {Object.keys(corrections.edgeTargets).length} destination(s) set · {corrections.hiddenEdges.length} hidden ·{' '}
        {Object.keys(corrections.featureOverrides).length} regrouped
      </p>
      {hidden.length > 0 && (
        <ul className="space-y-1">
          {hidden.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded border border-line bg-bg/40 px-2 py-1 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-ink-2" title={e.trigger.description}>
                {name(e.from)} → {name(e.to)} <span className="text-muted">· {e.trigger.label}</span>
              </span>
              <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => restoreEdge(e.correction!.key)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {stale.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11.5px] text-ink-2">
          <div className="mb-1 font-medium text-warning">{stale.length} correction(s) no longer match the latest analysis</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {stale.slice(0, 8).map((s) => (
              <li key={`${s.kind}:${s.key}`}>{s.reason}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className={buttonClass} onClick={() => window.confirm('Remove all of your corrections for this project?') && resetCorrections()}>
        Remove all corrections
      </button>
    </div>
  );
}
