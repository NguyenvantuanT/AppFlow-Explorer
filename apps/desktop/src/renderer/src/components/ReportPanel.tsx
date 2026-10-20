import { coverageReport, unresolvedReport, UNRESOLVED_CATEGORY_LABELS, type EdgeStatus, type UiStateKind, type UnresolvedCategory } from '@appflow/model';
import { useMemo, type ReactNode } from 'react';
import { useDialogFocus } from '../lib/a11y';
import { useExplorer } from '../store';
import { CloseIcon, CodeIcon, LinkIcon, PhoneIcon } from './icons';
import { STATUS_META } from './StatusBadge';

export const UI_STATE_LABEL: Record<UiStateKind, string> = {
  loading: 'Loading',
  empty: 'Empty',
  error: 'Error',
  data: 'Loads data',
  auth: 'Authentication',
  dialog: 'Dialog',
  bottomSheet: 'Bottom sheet',
  tabs: 'Tabs',
};

function Stat({ label, value, of, hint }: { label: string; value: number; of?: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/60 px-3 py-2.5" title={hint}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[18px] font-semibold text-white">
        {value}
        {of !== undefined && <span className="text-[12px] font-normal text-muted"> / {of}</span>}
      </div>
    </div>
  );
}

function Heading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 mt-5 flex items-center gap-2 text-[13px] font-semibold text-ink">
      {children}
      {count !== undefined && <span className="rounded bg-raised px-1.5 font-mono text-[10px] text-ink-2">{count}</span>}
    </h3>
  );
}

/**
 * What the analysis covered and what it could not resolve. Counts are of real
 * entities, not a score; every unresolved item links to its code.
 */
export function ReportPanel() {
  const open = useExplorer((s) => s.reportOpen);
  const setOpen = useExplorer((s) => s.setReportOpen);
  const project = useExplorer((s) => s.project);
  const select = useExplorer((s) => s.select);
  const openCode = useExplorer((s) => s.openCode);
  const ref = useDialogFocus<HTMLDivElement>(open);
  const coverage = useMemo(() => (open ? coverageReport(project) : null), [open, project]);
  const unresolved = useMemo(() => (open ? unresolvedReport(project) : null), [open, project]);
  const names = useMemo(() => new Map(project.screens.map((s) => [s.id, s.name])), [project]);

  if (!open || !coverage || !unresolved) return null;

  const close = () => setOpen(false);
  const goToEdge = (edgeId: string) => {
    select({ kind: 'edge', id: edgeId }, { focus: true, openCode: true });
    close();
  };
  const goToScreen = (screenId: string) => {
    select({ kind: 'screen', id: screenId }, { focus: true });
    close();
  };
  const categories = (Object.keys(UNRESOLVED_CATEGORY_LABELS) as UnresolvedCategory[]).filter((c) => unresolved.byCategory[c] > 0);
  const stateKinds = (Object.keys(UI_STATE_LABEL) as UiStateKind[]).filter((k) => coverage.uiStates[k] > 0);
  const statuses = (Object.keys(coverage.edges.byStatus) as EdgeStatus[]).filter((s) => coverage.edges.byStatus[s] > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-6 pt-[6vh]" onMouseDown={close}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}
        className="flex max-h-[86vh] w-[760px] max-w-full flex-col rounded-xl border border-line-strong bg-panel shadow-2xl"
        data-testid="report-panel"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 id="report-title" className="text-[15px] font-semibold text-white">
            Analysis report
          </h2>
          <span className="truncate text-[12px] text-muted">{project.name}</span>
          <button type="button" onClick={close} aria-label="Close report" className="ml-auto rounded p-1 text-muted hover:bg-raised hover:text-ink">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-5">
          <Heading>Coverage</Heading>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Screens" value={coverage.screens.total} hint={`${coverage.screens.byKind.page} pages, ${coverage.screens.byKind.dialog} dialogs, ${coverage.screens.byKind.bottomSheet} bottom sheets`} />
            <Stat label="Reachable from start" value={coverage.screens.reachable} of={coverage.screens.total} hint="Through connections with a known destination." />
            <Stat label="With UI states in code" value={coverage.screens.withDiscoveredStates} of={coverage.screens.total} />
            <Stat label="Captured at runtime" value={coverage.screens.captured} of={coverage.screens.total} />
            <Stat label="Connections" value={coverage.edges.total} />
            <Stat label="Unresolved" value={coverage.edges.byStatus.unresolved} of={coverage.edges.total} />
            <Stat label="Deep links resolved" value={coverage.deepLinks.resolved} of={coverage.deepLinks.total} />
            <Stat label="Source files with findings" value={coverage.files.sourceWithFindings} of={coverage.files.source} />
          </div>

          {statuses.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-label="Connections by status">
              {statuses.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[s].color }} aria-hidden />
                  {STATUS_META[s].short} <span className="font-mono text-ink">{coverage.edges.byStatus[s]}</span>
                </span>
              ))}
            </div>
          )}
          {stateKinds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="UI states found in code">
              {stateKinds.map((k) => (
                <span key={k} className="rounded border border-line px-1.5 py-px text-[11px] text-ink-2">
                  {UI_STATE_LABEL[k]} <span className="font-mono text-ink">{coverage.uiStates[k]}</span>
                </span>
              ))}
            </div>
          )}

          <Heading count={unresolved.flows.length}>Unresolved flows</Heading>
          {unresolved.flows.length === 0 ? (
            <p className="text-muted">Every connection found has a known destination.</p>
          ) : (
            categories.map((c) => (
              <div key={c} className="mb-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {UNRESOLVED_CATEGORY_LABELS[c]} · {unresolved.byCategory[c]}
                </div>
                <ul className="space-y-1">
                  {unresolved.flows
                    .filter((f) => f.category === c)
                    .map((f) => (
                      <li key={f.edgeId}>
                        <button
                          type="button"
                          onClick={() => goToEdge(f.edgeId)}
                          className="w-full rounded-md border border-warning/25 bg-warning/5 px-2.5 py-1.5 text-left hover:border-warning/50"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink">{f.fromName}</span>
                            <span className="truncate text-ink-2">{f.trigger}</span>
                            {f.location && (
                              <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] text-primary">
                                <CodeIcon size={11} /> {f.location.fileId}:{f.location.line}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-muted">{f.reason}</div>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}

          <Heading count={coverage.screens.unreachable.length}>Not reachable from a start screen</Heading>
          {coverage.screens.unreachable.length === 0 ? (
            <p className="text-muted">Every screen can be reached from a start screen.</p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-ink-2">Reached through an unresolved connection, a deep link or a notification — or no longer used.</p>
              <ul className="flex flex-wrap gap-1.5">
                {coverage.screens.unreachable.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => goToScreen(id)} className="flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[12px] text-ink hover:bg-raised">
                      <PhoneIcon size={11} className="text-muted" /> {names.get(id) ?? id}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(project.deepLinks?.length ?? 0) > 0 && (
            <>
              <Heading count={project.deepLinks!.length}>Deep links</Heading>
              <ul className="space-y-1">
                {project.deepLinks!.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5">
                    <LinkIcon size={12} className="shrink-0 text-muted" />
                    <span className="truncate font-mono text-[12px] text-ink">{d.url}</span>
                    <span className="shrink-0 text-[10.5px] text-muted">{d.platform}</span>
                    {d.screenId ? (
                      <button type="button" onClick={() => goToScreen(d.screenId!)} className="ml-auto shrink-0 text-[12px] text-primary hover:underline">
                        → {names.get(d.screenId) ?? d.screenId}
                      </button>
                    ) : (
                      <span className="ml-auto shrink-0 text-[11.5px] text-warning" title={d.unresolvedReason}>
                        Destination unknown
                      </span>
                    )}
                    {d.location && (
                      <button type="button" onClick={() => (openCode(d.location!), close())} aria-label={`Open ${d.location.fileId} line ${d.location.line}`} className="shrink-0 rounded p-0.5 text-primary hover:bg-raised">
                        <CodeIcon size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(coverage.warnings.errors > 0 || coverage.warnings.warnings > 0) && (
            <p className="mt-4 text-[12px] text-ink-2">
              The analysis reported {coverage.warnings.errors} error(s) and {coverage.warnings.warnings} warning(s); see Limitations on the canvas.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
