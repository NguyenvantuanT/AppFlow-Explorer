import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isActive } from '../store/runtimeStore';
import { useExplorer, useRuntime } from '../store';
import { CloseIcon, PhoneIcon } from './icons';

const STATUS_STYLE: Record<string, string> = {
  starting: 'text-primary',
  building: 'text-primary',
  installing: 'text-primary',
  running: 'text-success',
  failed: 'text-danger',
  stopped: 'text-muted',
};

function Block({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const select = 'w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary disabled:opacity-50';

export function RuntimePanel() {
  const workspace = useExplorer((s) => s.workspace);
  const project = useExplorer((s) => s.project);
  const select_ = useExplorer((s) => s.select);
  const rt = useRuntime();
  const projectId = workspace.projectId;
  const logRef = useRef<HTMLDivElement>(null);
  const [assignTo, setAssignTo] = useState<string>('');

  useEffect(() => {
    if (projectId && project.source === 'analysis') void useRuntime.getState().open(projectId);
  }, [projectId, project.source]);

  // Poll the session while it builds/runs.
  const active = isActive(rt.session);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void useRuntime.getState().poll(), 1000);
    return () => clearInterval(t);
  }, [active, rt.session?.id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rt.logs.length]);

  const screens = project.screens;
  const capturedIds = useMemo(() => new Set(rt.captures.map((c) => c.screenId).filter(Boolean)), [rt.captures]);
  const unassigned = rt.captures.filter((c) => !c.screenId);
  const notCaptured = screens.filter((s) => !capturedIds.has(s.id));

  if (project.source !== 'analysis' || !projectId) {
    return <p className="p-4 text-[12.5px] text-ink-2">Open and analyze a real Flutter project to run it and capture its screens. The demo project cannot be run.</p>;
  }

  const online = rt.devices.filter((d) => d.state === 'online');
  const canRun = !!rt.deviceId && online.some((d) => d.id === rt.deviceId) && !!rt.options?.flutter && (!rt.options.flavors.length || !!rt.flavor) && !active;
  const running = rt.session?.status === 'running';

  return (
    <div className="pb-4 text-[12.5px]">
      {rt.error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-ink">
          <span className="flex-1">{rt.error}</span>
          <button type="button" onClick={rt.clearError} aria-label="Dismiss" className="text-muted hover:text-ink">
            <CloseIcon size={12} />
          </button>
        </div>
      )}
      {rt.busy && <p className="px-4 pt-3 text-[12px] text-primary">{rt.busy}</p>}

      <Block title="Device" right={<button type="button" onClick={() => void rt.refreshDevices()} className="text-[11.5px] text-primary hover:underline">Refresh</button>}>
        {rt.host && !rt.host.iosSupported && <p className="mb-2 text-[11.5px] text-muted">iOS simulators need a macOS host with Xcode; only Android is available here.</p>}
        {rt.host?.problems.map((p) => <p key={p} className="mb-1 text-[11.5px] text-warning">{p}</p>)}
        {rt.devices.length === 0 ? (
          <p className="text-muted">No devices found. Create an emulator in Android Studio (Device Manager) or connect a phone.</p>
        ) : (
          <ul className="space-y-1">
            {rt.devices.map((d) => (
              <li key={d.id}>
                <label className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${rt.deviceId === d.id ? 'border-primary bg-primary/10' : 'border-line'}`}>
                  <input type="radio" name="device" checked={rt.deviceId === d.id} disabled={d.state !== 'online'} onChange={() => rt.setChoice({ deviceId: d.id })} />
                  <span className={`h-2 w-2 shrink-0 rounded-full ${d.state === 'online' ? 'bg-success' : d.state === 'stopped' ? 'bg-muted' : 'bg-warning'}`} />
                  <span className="min-w-0 flex-1 truncate text-ink">{d.name}</span>
                  <span className="shrink-0 text-[10.5px] text-muted">{d.osVersion ?? d.platform} · {d.state}</span>
                  {d.state === 'stopped' && (
                    <button type="button" onClick={() => void rt.boot(d.id)} className="shrink-0 rounded border border-line-strong px-1.5 text-[11px] text-ink hover:bg-raised">
                      Start
                    </button>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Build">
        {rt.options?.flutter ? (
          <p className="mb-2 text-[11.5px] text-ink-2">
            Flutter {rt.options.flutter.version ?? '?'} · {rt.options.flutter.source === 'fvm-project-sdk' ? 'project FVM SDK' : rt.options.flutter.source === 'fvm' ? 'fvm' : 'flutter on PATH'}
            {rt.options.flutter.pinnedVersion && ` · pinned ${rt.options.flutter.pinnedVersion}`}
          </p>
        ) : (
          rt.options && <p className="mb-2 text-[11.5px] text-danger">Flutter was not found. Install Flutter or FVM and restart AppFlow.</p>
        )}
        {rt.options?.flutter?.warnings.map((w) => <p key={w} className="mb-1 text-[11.5px] text-warning">{w}</p>)}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted">
            Mode
            <select className={select} value={rt.mode} disabled={active} onChange={(e) => rt.setChoice({ mode: e.target.value as 'debug' })}>
              {(rt.options?.modes ?? ['debug']).map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-muted">
            Flavor
            <select className={select} value={rt.flavor ?? ''} disabled={active || !rt.options?.flavors.length} onChange={(e) => rt.setChoice({ flavor: e.target.value || null })}>
              {!rt.options?.flavors.length && <option value="">none</option>}
              {rt.options?.flavors.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-[11px] text-muted">
            Entry point
            <select className={select} value={rt.target ?? ''} disabled={active} onChange={(e) => rt.setChoice({ target: e.target.value || null })}>
              {rt.options?.targets.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        {rt.mode !== 'debug' && <p className="mt-2 text-[11.5px] text-warning">Automatic screen detection needs a debug build; captures will have to be assigned by hand.</p>}
        <div className="mt-3 flex gap-2">
          {active ? (
            <button type="button" onClick={() => void rt.stop()} className="flex-1 rounded-md border border-line-strong py-2 text-[12.5px] text-ink hover:bg-raised">
              Stop app
            </button>
          ) : (
            <button type="button" disabled={!canRun} onClick={() => void rt.run()} className="flex-1 rounded-md bg-primary py-2 text-[12.5px] font-semibold text-white hover:bg-[#2f74e6] disabled:bg-primary/40 disabled:text-white/60">
              {rt.session?.status === 'failed' ? 'Retry build & launch' : 'Build & launch…'}
            </button>
          )}
        </div>
      </Block>

      {rt.session && (
        <Block title="Session" right={<span className={`text-[11.5px] font-semibold ${STATUS_STYLE[rt.session.status]}`}>{rt.session.status}</span>}>
          {rt.session.phase && active && <p className="mb-1 truncate text-[11.5px] text-ink-2">{rt.session.phase}</p>}
          {rt.session.error && <p className="mb-2 rounded border border-danger/30 bg-danger/10 p-2 text-[11.5px] text-ink">{rt.session.error}</p>}
          <div ref={logRef} className="h-44 overflow-auto rounded-md border border-line bg-[#070b14] p-2 font-mono text-[10.5px] leading-[15px]" data-testid="session-logs">
            {rt.logs.length === 0 ? (
              <span className="text-muted">Waiting for output…</span>
            ) : (
              rt.logs.map((l) => (
                <div key={l.seq} className={l.stream === 'stderr' ? 'text-danger' : l.stream === 'event' ? 'text-primary' : 'text-ink-2'}>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </Block>
      )}

      <Block title="Capture">
        {running && rt.session?.currentScreen && <p className="mb-2 text-[11.5px] text-ink-2">Now showing: <span className="font-mono text-ink">{rt.session.currentScreen}</span> (from the live widget tree)</p>}
        <label className="text-[11px] text-muted">
          Assign to
          <select className={select} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">{running && rt.session?.build.mode === 'debug' ? 'Detect automatically' : 'Leave unassigned'}</option>
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.widgetClass}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={!running && !online.length} onClick={() => void rt.capture(assignTo || undefined)} className="flex-1 rounded-md border border-line-strong py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40">
            Capture current screen
          </button>
        </div>
        <label className={`mt-2 flex items-center gap-2 text-[12px] ${running && rt.session?.vmServiceUri ? 'text-ink' : 'text-muted'}`}>
          <input type="checkbox" disabled={!running || !rt.session?.vmServiceUri} checked={!!rt.session?.autoCapture} onChange={(e) => void rt.setAutoCapture(e.target.checked)} />
          Auto-capture each new screen while I navigate
        </label>
        <p className="mt-1 text-[11px] text-muted">AppFlow does not tap through the app for you: navigate in the emulator; screens you reach are captured.</p>
      </Block>

      <Block title="Coverage">
        <p className="text-ink">
          <span className="font-semibold text-success">{screens.length - notCaptured.length}</span> of {screens.length} discovered screens captured
          {unassigned.length > 0 && <span className="text-warning"> · {unassigned.length} unassigned capture{unassigned.length > 1 ? 's' : ''}</span>}
        </p>
        <p className="mt-1 text-[11px] text-muted">A screen counts as captured only when a screenshot is assigned to it. Launching the app does not capture anything by itself.</p>
        {!!rt.captures.length && (
          <div className="mt-3 grid grid-cols-2 gap-2" data-testid="captures">
            {[...rt.captures].reverse().map((c) => (
              <CaptureCard key={c.id} id={c.id} />
            ))}
          </div>
        )}
        {notCaptured.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-ink-2">Not captured yet ({notCaptured.length})</summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
              {notCaptured.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => select_({ kind: 'screen', id: s.id }, { focus: true })} className="w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] text-ink-2 hover:bg-raised">
                    <PhoneIcon size={10} className="mr-1 inline" />
                    {s.widgetClass}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Block>
    </div>
  );
}

function CaptureCard({ id }: { id: string }) {
  const capture = useRuntime((s) => s.captures.find((c) => c.id === id));
  const image = useRuntime((s) => s.images[id]);
  const loadImage = useRuntime((s) => s.loadImage);
  const assign = useRuntime((s) => s.assign);
  const remove = useRuntime((s) => s.remove);
  const screens = useExplorer((s) => s.project.screens);
  useEffect(() => {
    void loadImage(id);
  }, [id, loadImage]);
  if (!capture) return null;
  return (
    <div className={`overflow-hidden rounded-md border ${capture.screenId ? 'border-line' : 'border-warning/60'}`}>
      <div className="aspect-[9/16] bg-bg">{image ? <img src={image} alt="" className="h-full w-full object-contain" /> : null}</div>
      <div className="space-y-1 p-1.5">
        <select className="w-full rounded border border-line bg-bg px-1 py-0.5 text-[10.5px] text-ink" value={capture.screenId ?? ''} onChange={(e) => void assign(capture.id, e.target.value || null)} aria-label="Assign capture to screen">
          <option value="">Unassigned</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.widgetClass}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span title={capture.association.detail}>{capture.association.method === 'auto' ? 'auto-detected' : capture.association.method === 'manual' ? 'assigned' : 'unassigned'}</span>
          <button type="button" onClick={() => void remove(capture.id)} className="hover:text-danger">
            Delete
          </button>
        </div>
        <div className="truncate text-[10px] text-muted" title={`${capture.device.name} · ${capture.width}×${capture.height}${capture.pixelRatio ? ` @${capture.pixelRatio}x` : ''}`}>
          {new Date(capture.capturedAt).toLocaleTimeString()} · {capture.device.name}
        </div>
      </div>
    </div>
  );
}
