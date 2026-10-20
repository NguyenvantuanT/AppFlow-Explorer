import { edgeStatus, type AnalysisWarning, type NavigationEdge, type Screen, type SourceLocation } from '@appflow/model';
import { useState, type ReactNode } from 'react';
import { Wireframe } from '../canvas/PhoneNode';
import { RuntimePanel } from './RuntimePanel';
import { useExplorer } from '../store';
import { ArrowIcon, CloseIcon, CodeIcon, WidgetIcon } from './icons';
import { STATUS_META, StatusBadge } from './StatusBadge';

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
        {title}
        {count !== undefined && <span className="rounded bg-raised px-1.5 font-mono text-[10px] text-ink-2">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-baseline gap-2 py-0.5">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

export function SourceLink({ location }: { location: SourceLocation }) {
  const openCode = useExplorer((s) => s.openCode);
  return (
    <button
      type="button"
      onClick={() => openCode(location)}
      className="group inline-flex max-w-full items-center gap-1 text-left font-mono text-[11.5px] text-primary hover:underline"
      title="Open in code viewer"
    >
      <CodeIcon size={12} className="shrink-0" />
      <span className="truncate">
        {location.fileId}:{location.line}
      </span>
    </button>
  );
}

function EdgeRow({ edge, direction }: { edge: NavigationEdge; direction: 'in' | 'out' }) {
  const index = useExplorer((s) => s.index);
  const select = useExplorer((s) => s.select);
  const otherId = direction === 'out' ? edge.to : edge.from;
  const other = otherId ? index.screensById.get(otherId) : undefined;
  return (
    <button
      type="button"
      onClick={() => select({ kind: 'edge', id: edge.id }, { focus: true, openCode: 'follow' })}
      className="flex w-full flex-col gap-1 rounded-md border border-line bg-bg/40 px-2.5 py-2 text-left hover:border-line-strong hover:bg-raised"
    >
      <div className="flex w-full items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
          {direction === 'in' && <span className="truncate">{other?.name}</span>}
          <ArrowIcon size={12} className="shrink-0 text-muted" />
          {direction === 'out' && (
            <span className={`truncate ${other ? '' : 'italic text-warning'}`}>{other?.name ?? 'Unknown destination'}</span>
          )}
        </span>
        <span className="ml-auto">
          <StatusBadge status={edgeStatus(edge)} compact />
        </span>
      </div>
      <div className="truncate text-[11.5px] text-ink-2">
        <span className="mr-1 font-mono text-[10px] uppercase text-muted">{edge.kind}</span>
        {edge.trigger.description}
      </div>
    </button>
  );
}

function ScreenDetails({ screen }: { screen: Screen }) {
  const index = useExplorer((s) => s.index);
  const incoming = index.incoming.get(screen.id) ?? [];
  const outgoing = index.outgoing.get(screen.id) ?? [];
  const openCode = useExplorer((s) => s.openCode);
  const moduleName = useExplorer((s) => s.project.modules?.find((m) => m.id === screen.moduleId)?.name);
  const state = screen.states[0];

  return (
    <>
      <div className="px-4 pb-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-white">{screen.widgetClass}</h2>
            <div className="truncate font-mono text-[12px] text-ink-2">{screen.route ?? 'No named route'}</div>
            {screen.platformKind && (
              <div className="mt-0.5 truncate text-[11.5px] text-muted">
                {PLATFORM_KIND_LABEL[screen.platformKind]}
                {moduleName && ` · ${moduleName}`}
              </div>
            )}
          </div>
          {screen.isEntryPoint ? (
            <span className="shrink-0 rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Start screen</span>
          ) : screen.kind !== 'page' ? (
            <span className="shrink-0 rounded-md bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-2">
              {screen.kind === 'dialog' ? 'Dialog' : 'Bottom sheet'}
            </span>
          ) : null}
        </div>

        <div className="mx-auto mt-4 w-[176px] rounded-[26px] border-2 border-[#33446a] bg-[#05070d] p-[5px] shadow-xl">
          <div className="aspect-[360/780] overflow-hidden rounded-[20px] bg-panel-2">
            {state?.screenshot ? (
              <img src={state.screenshot.uri} alt={`${screen.name} preview`} className="h-full w-full object-cover" />
            ) : (
              <Wireframe screen={screen} />
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">
          {!state?.screenshot
            ? 'Not captured from the running app yet'
            : state.provenance === 'runtime'
              ? `Runtime capture${state.screenshot.device ? ` · ${state.screenshot.device}` : ''}`
              : 'Mock illustration — not a real capture'}
        </p>
      </div>

      <Section title="Navigation from" count={incoming.length}>
        {incoming.length === 0 ? (
          <p className="text-muted">{screen.isEntryPoint ? 'Start screen — launched directly.' : 'No incoming navigation found.'}</p>
        ) : (
          <div className="space-y-1.5">
            {incoming.map((e) => (
              <EdgeRow key={e.id} edge={e} direction="in" />
            ))}
          </div>
        )}
      </Section>

      <Section title="Navigation to" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <p className="text-muted">No outgoing navigation found.</p>
        ) : (
          <div className="space-y-1.5">
            {outgoing.map((e) => (
              <EdgeRow key={e.id} edge={e} direction="out" />
            ))}
          </div>
        )}
      </Section>

      <Section title="Associated file">
        <SourceLink location={screen.location} />
      </Section>

      <Section title="Key widgets" count={screen.keyWidgets.length}>
        {screen.keyWidgets.length === 0 ? (
          <p className="text-muted">No notable widgets identified.</p>
        ) : (
          <ul className="space-y-0.5">
            {screen.keyWidgets.map((w) => (
              <li key={w.name}>
                <button
                  type="button"
                  disabled={!w.location}
                  onClick={() => w.location && openCode(w.location)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <WidgetIcon size={12} className="shrink-0 text-muted" />
                  <span className="truncate font-mono text-[12px] text-ink">{w.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted">{w.handlers?.length ? w.handlers.join(', ') : w.kind}</span>
                  {w.location && <span className="shrink-0 font-mono text-[10px] text-muted">L{w.location.line}</span>}
                </button>
                {w.assetIds?.map((a) => (
                  <div key={a} className="truncate pl-7 font-mono text-[10.5px] text-muted" title={a}>
                    ↳ {a}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!!screen.evidence?.length && (
        <Section title="Identified by" count={screen.evidence.length}>
          <ul className="space-y-1.5">
            {screen.evidence.slice(0, 6).map((ev, i) => (
              <li key={i} className="text-[11.5px]">
                <div className="flex items-center gap-1.5">
                  <EvidenceTag source={ev.source} />
                  <span className="min-w-0 truncate text-ink-2" title={ev.detail}>
                    {ev.detail}
                  </span>
                </div>
                {ev.location && (
                  <div className="pl-1">
                    <SourceLink location={ev.location} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

const PLATFORM_KIND_LABEL: Record<NonNullable<Screen['platformKind']>, string> = {
  widget: 'Flutter widget',
  activity: 'Android activity',
  fragment: 'Android fragment',
  composable: 'Jetpack Compose destination',
  'view-controller': 'UIKit view controller',
  'swiftui-view': 'SwiftUI view',
  'storyboard-scene': 'Storyboard scene (no custom class)',
  component: 'React Native component',
};

function EvidenceTag({ source }: { source: 'runtime' | 'declared' | 'static' }) {
  const style = source === 'runtime' ? 'bg-primary/15 text-primary' : source === 'declared' ? 'bg-[#c4b5fd]/15 text-[#c4b5fd]' : 'bg-inferred/15 text-inferred';
  return <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${style}`}>{source === 'runtime' ? 'Runtime' : source === 'declared' ? 'Config' : 'Code'}</span>;
}

function EdgeDetails({ edge }: { edge: NavigationEdge }) {
  const index = useExplorer((s) => s.index);
  const select = useExplorer((s) => s.select);
  const status = edgeStatus(edge);
  const from = index.screensById.get(edge.from);
  const to = edge.to ? index.screensById.get(edge.to) : undefined;

  const screenButton = (screen: Screen | undefined, fallback: string) =>
    screen ? (
      <button
        type="button"
        className="truncate font-semibold text-white hover:text-primary hover:underline"
        onClick={() => select({ kind: 'screen', id: screen.id }, { focus: true, openCode: 'follow' })}
      >
        {screen.name}
      </button>
    ) : (
      <span className="italic text-warning">{fallback}</span>
    );

  return (
    <>
      <div className="px-4 pb-3 pt-4">
        <div className="mb-2 flex items-center gap-2 text-[15px]">
          {screenButton(from, 'Unknown screen')}
          <ArrowIcon size={14} className="shrink-0 text-muted" />
          {screenButton(to, 'Unknown destination')}
        </div>
        <StatusBadge status={status} />
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{STATUS_META[status].description}</p>
        {status === 'inferred' && (
          <p className="mt-2 rounded-md border border-inferred/30 bg-inferred/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
            This flow is <strong className="text-ink">not verified</strong>. It was derived from source code and has not been observed in the running app.
          </p>
        )}
        {status === 'declared' && (
          <p className="mt-2 rounded-md border border-[#c4b5fd]/30 bg-[#c4b5fd]/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
            Declared in the project&apos;s navigation configuration. It has <strong className="text-ink">not been observed</strong> in the running app.
          </p>
        )}
        {edge.unresolvedKind && (
          <p className="mt-2 text-[11.5px] text-muted">
            Reason: {edge.unresolvedKind === 'dynamic' ? 'destination computed at runtime' : edge.unresolvedKind === 'unsupported' ? 'unsupported navigation pattern' : 'destination not found'}
          </p>
        )}
        {edge.unresolvedReason && (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
            {edge.unresolvedReason}
          </p>
        )}
      </div>

      <Section title="Trigger">
        <Field label="Action">{edge.trigger.description}</Field>
        <Field label="Kind">
          <span className="font-mono text-[12px]">{edge.kind}</span>
        </Field>
        {edge.trigger.widget && (
          <Field label="Widget">
            <span className="font-mono text-[12px]">{edge.trigger.widget}</span>
          </Field>
        )}
        {edge.trigger.handler && (
          <Field label="Handler">
            <span className="font-mono text-[12px]">{edge.trigger.handler}</span>
          </Field>
        )}
        {edge.trigger.location && (
          <Field label="Source">
            <SourceLink location={edge.trigger.location} />
          </Field>
        )}
      </Section>

      <Section title="Evidence" count={edge.evidence.length}>
        {edge.evidence.length === 0 ? (
          <p className="text-muted">No supporting evidence recorded.</p>
        ) : (
          <ul className="space-y-2">
            {edge.evidence.map((ev, i) => (
              <li key={i} className="rounded-md border border-line bg-bg/50 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <EvidenceTag source={ev.source} />
                  {ev.confidence && <span className="text-[10px] text-muted">{ev.confidence} confidence</span>}
                  {ev.observedAt && <span className="text-[10px] text-muted">{new Date(ev.observedAt).toLocaleString()}</span>}
                </div>
                <div className="break-words font-mono text-[11.5px] text-ink">{ev.detail}</div>
                {ev.location && (
                  <div className="mt-1">
                    <SourceLink location={ev.location} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ProjectOverview() {
  const project = useExplorer((s) => s.project);
  const index = useExplorer((s) => s.index);
  const select = useExplorer((s) => s.select);
  const entries = project.screens.filter((s) => s.isEntryPoint);
  // Runtime capture comes later; for analyzed projects every screen is uncaptured, so only the demo lists them.
  const uncaptured = project.source === 'mock' ? project.screens.filter((s) => !s.states.some((st) => st.screenshot)) : [];
  const unresolved = project.edges.filter((e) => edgeStatus(e) === 'unresolved');

  return (
    <>
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold text-white">{project.name}</h2>
        <p className="mt-1 text-[12px] text-ink-2">Select a screen or connection on the canvas to inspect it.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            ['Screens', project.screens.length],
            ['Flows', project.edges.length],
            ['Files', project.files.length],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-line bg-bg/50 px-2.5 py-2">
              <div className="text-[18px] font-semibold text-white">{value}</div>
              <div className="text-[11px] text-muted">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <Section title="Navigation confidence">
        {(['verified', 'declared', 'inferred', 'unresolved'] as const).map((st) => (
          <div key={st} className="flex items-center justify-between py-1">
            <StatusBadge status={st} />
            <span className="font-mono text-ink">{index.statusCounts[st]}</span>
          </div>
        ))}
      </Section>

      {!!project.modules?.length && (
        <Section title="Modules" count={project.modules.length}>
          <ul className="space-y-1">
            {project.modules.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-[12px]">
                <span className="truncate text-ink" title={m.path || '(project root)'}>
                  {m.name}
                </span>
                <span className="shrink-0 rounded bg-raised px-1.5 text-[10px] text-ink-2">{m.kind}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-muted">{m.dependencies.length} deps</span>
              </li>
            ))}
          </ul>
          {project.frameworks && (
            <p className="mt-2 text-[11px] text-muted">{project.frameworks.map((f) => `${f.name}${f.version ? ` ${f.version}` : ''}`).join(' · ')}</p>
          )}
        </Section>
      )}

      {!!project.adapters?.length && (
        <Section title="Analysis adapters">
          {project.adapters.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-0.5 text-[12px]" title={a.capabilities.join('\n')}>
              <span className="text-ink">{a.name}</span>
              <span className={a.status === 'complete' ? 'text-success' : a.status === 'failed' ? 'text-danger' : 'text-warning'}>{a.status}</span>
            </div>
          ))}
          {!!project.excludedSensitiveFiles && <p className="mt-1.5 text-[11px] text-muted">{project.excludedSensitiveFiles} sensitive file(s) skipped, never read.</p>}
        </Section>
      )}

      {!!project.warnings?.length && <WarningsSection warnings={project.warnings} />}

      <Section title="Entry points" count={entries.length}>
        {entries.map((s) => (
          <button
            key={s.id}
            type="button"
            className="block w-full truncate rounded px-2 py-1 text-left text-ink hover:bg-raised"
            onClick={() => select({ kind: 'screen', id: s.id }, { focus: true })}
          >
            {s.name} <span className="font-mono text-[11px] text-muted">{s.route}</span>
          </button>
        ))}
      </Section>

      {(unresolved.length > 0 || uncaptured.length > 0) && (
        <Section title="Needs attention" count={unresolved.length + uncaptured.length}>
          {unresolved.slice(0, 25).map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.unresolvedReason}
              className="block w-full truncate rounded px-2 py-1 text-left text-warning hover:bg-raised"
              onClick={() => select({ kind: 'edge', id: e.id }, { focus: true })}
            >
              Unresolved: {index.screensById.get(e.from)?.name} → ?
            </button>
          ))}
          {unresolved.length > 25 && <p className="px-2 text-[11px] text-muted">+{unresolved.length - 25} more</p>}
          {uncaptured.map((s) => (
            <button
              key={s.id}
              type="button"
              className="block w-full truncate rounded px-2 py-1 text-left text-ink-2 hover:bg-raised"
              onClick={() => select({ kind: 'screen', id: s.id }, { focus: true })}
            >
              Not captured: {s.name}
            </button>
          ))}
        </Section>
      )}
    </>
  );
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function WarningsSection({ warnings }: { warnings: AnalysisWarning[] }) {
  const openCode = useExplorer((s) => s.openCode);
  const sorted = [...warnings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const w of warnings) counts[w.severity]++;
  return (
    <Section title="Analysis warnings" count={warnings.length}>
      <p className="mb-2 text-[11px] text-muted">
        {counts.error} errors · {counts.warning} warnings · {counts.info} notes
      </p>
      <ul className="space-y-1.5" data-testid="warnings">
        {sorted.slice(0, 40).map((w) => (
          <li key={w.id}>
            <button
              type="button"
              disabled={!w.location}
              onClick={() => w.location && openCode(w.location)}
              title={w.location ? `${w.location.fileId}:${w.location.line}` : undefined}
              className="flex w-full gap-2 rounded px-1.5 py-1 text-left text-[11.5px] leading-snug hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${w.severity === 'error' ? 'bg-danger' : w.severity === 'warning' ? 'bg-warning' : 'bg-muted'}`} />
              <span className="text-ink-2">{w.message}</span>
            </button>
          </li>
        ))}
      </ul>
      {sorted.length > 40 && <p className="mt-1 text-[11px] text-muted">+{sorted.length - 40} more</p>}
    </Section>
  );
}

export function DetailsPanel() {
  const selection = useExplorer((s) => s.selection);
  const index = useExplorer((s) => s.index);
  const select = useExplorer((s) => s.select);
  const toggleRightPanel = useExplorer((s) => s.toggleRightPanel);
  const showRuntime = useExplorer((s) => s.project.source === 'analysis' && (s.project.platforms ?? [s.project.framework]).includes('flutter'));
  const [tab, setTab] = useState<'details' | 'runtime'>('details');

  let content: ReactNode;
  if (selection?.kind === 'screen' && index.screensById.has(selection.id)) {
    content = <ScreenDetails screen={index.screensById.get(selection.id)!} />;
  } else if (selection?.kind === 'edge' && index.edgesById.has(selection.id)) {
    content = <EdgeDetails edge={index.edgesById.get(selection.id)!} />;
  } else {
    content = <ProjectOverview />;
  }

  const hasSource =
    (selection?.kind === 'screen' && index.screensById.has(selection.id)) ||
    (selection?.kind === 'edge' && !!index.edgesById.get(selection.id)?.trigger.location);

  const tabClass = (active: boolean) => `h-full border-b-2 px-1 text-[13px] font-semibold ${active ? 'border-primary text-white' : 'border-transparent text-muted hover:text-ink'}`;

  return (
    <aside className="flex h-full flex-col border-l border-line bg-panel" aria-label="Details">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4">
        <button type="button" className={tabClass(tab === 'details')} onClick={() => setTab('details')}>
          {selection?.kind === 'screen' ? 'Screen Details' : selection?.kind === 'edge' ? 'Navigation' : 'Overview'}
        </button>
        {showRuntime && (
          <button type="button" className={tabClass(tab === 'runtime')} onClick={() => setTab('runtime')}>
            Run &amp; Capture
          </button>
        )}
        <button type="button" onClick={toggleRightPanel} aria-label="Close details panel" className="ml-auto rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <CloseIcon size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 text-[12.5px]">{tab === 'runtime' && showRuntime ? <RuntimePanel /> : content}</div>
      {tab === 'details' && hasSource && selection && (
        <div className="shrink-0 border-t border-line p-3">
          <button
            type="button"
            onClick={() => select(selection, { openCode: true })}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[13px] font-semibold text-white hover:bg-[#2f74e6]"
          >
            <CodeIcon size={15} /> Open in Code Editor
          </button>
        </div>
      )}
    </aside>
  );
}
