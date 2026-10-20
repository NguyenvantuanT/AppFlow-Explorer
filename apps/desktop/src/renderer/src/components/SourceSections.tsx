import { edgeSourceTargets, type NavigationEdge, type Screen, type SourceRole } from '@appflow/model';
import { useMemo } from 'react';
import { useExplorer } from '../store';
import { EditorButton } from './CodePanel';
import { SourceLink } from './DetailsPanel';

const ROLE_LABEL: Record<SourceRole, string> = {
  handler: 'Event handler',
  'navigation-call': 'Navigation call',
  'route-declaration': 'Route declaration',
  'destination-screen': 'Destination',
  evidence: 'Also seen at',
};

/**
 * Where a navigation lives in the code: the handler that runs it, then how its
 * destination was resolved. Unknown parts are listed with the reason instead
 * of being left out.
 */
export function EdgeSourceSection({ edge }: { edge: NavigationEdge }) {
  const project = useExplorer((s) => s.project);
  const targets = useMemo(() => edgeSourceTargets(edge, project), [edge, project]);
  return (
    <ul className="space-y-2" data-testid="edge-source">
      {targets.map((t, i) => (
        <li key={i} className={`rounded-md border px-2.5 py-2 ${t.uncertain ? 'border-warning/35 bg-warning/5' : 'border-line bg-bg/50'}`}>
          <div className="mb-0.5 flex items-center gap-2 text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-muted">{ROLE_LABEL[t.role]}</span>
            {i === 0 && t.location && <span className="rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">Best match</span>}
            {t.uncertain && <span className="rounded bg-warning/15 px-1.5 text-[10px] font-semibold text-warning">Uncertain</span>}
            {t.confidence && <span className="ml-auto text-[10px] text-muted">{t.confidence} confidence</span>}
          </div>
          <div className="break-words font-mono text-[11.5px] text-ink">{t.label}</div>
          {t.location ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <SourceLink location={t.location} />
              </span>
              <EditorButton target={t.location} compact />
            </div>
          ) : (
            <div className="mt-1 text-[11px] italic text-muted">No source location</div>
          )}
          {t.note && <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{t.note}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The screen's UI states: runtime captures (newest first) and illustrations, or why there are none. */
export function ScreenStatesSection({ screen }: { screen: Screen }) {
  if (!screen.states.length) {
    return <p className="text-muted">No screenshot yet. Capture it from the running app in Run &amp; Capture; the map shows a wireframe from code meanwhile.</p>;
  }
  return (
    <ul className="grid grid-cols-3 gap-2" data-testid="screen-states">
      {screen.states.map((st) => (
        <li key={st.id} className="min-w-0">
          <div className="aspect-[360/780] overflow-hidden rounded-md border border-line bg-panel-2">
            {st.screenshot ? <img src={st.screenshot.uri} alt={`${screen.name} – ${st.label}`} className="h-full w-full object-cover" /> : <div className="p-1 text-[10px] text-muted">No image</div>}
          </div>
          <div className="mt-1 truncate text-[11px] text-ink" title={st.label}>
            {st.label}
          </div>
          <div className="truncate text-[10px] text-muted">
            {st.provenance === 'runtime' ? 'Runtime capture' : 'Mock illustration'}
            {st.screenshot?.capturedAt && ` · ${new Date(st.screenshot.capturedAt).toLocaleString()}`}
            {st.screenshot?.device && ` · ${st.screenshot.device}`}
            {st.build && ` · ${st.build.mode}${st.build.flavor ? `/${st.build.flavor}` : ''}`}
          </div>
        </li>
      ))}
    </ul>
  );
}
