import { useEffect, useRef, useState } from 'react';
import { agentApi, type SampleProject } from '../agent/client';
import { useExplorer } from '../store';
import { PhoneIcon } from './icons';

const FRAMEWORK_LABEL: Record<SampleProject['framework'], string> = { flutter: 'Flutter', android: 'Android', ios: 'iOS', 'react-native': 'React Native' };

let loaded: Promise<SampleProject[]> | undefined;

/** Sample projects, loaded once; empty outside the desktop app. */
export function useSampleProjects(): SampleProject[] {
  const [samples, setSamples] = useState<SampleProject[]>([]);
  useEffect(() => {
    let live = true;
    loaded ??= agentApi.sampleProjects().catch(() => []);
    void loaded.then((s) => live && setSamples(s));
    return () => {
      live = false;
    };
  }, []);
  return samples;
}

function FrameworkTag({ framework }: { framework: SampleProject['framework'] }) {
  return <span className="shrink-0 rounded border border-[#2a5a8a] bg-[#0f2a44] px-1.5 py-px text-[10px] font-semibold text-[#7cc4ff]">{FRAMEWORK_LABEL[framework]}</span>;
}

/** Welcome screen: real sample projects, analyzed like an opened folder. */
export function SampleList() {
  const samples = useSampleProjects();
  const openProjectPath = useExplorer((s) => s.openProjectPath);
  if (!samples.length) return null;
  return (
    <section className="mt-8" data-testid="sample-projects">
      <h2 className="text-[13px] font-semibold text-ink">Sample projects</h2>
      <p className="mt-0.5 text-[12px] text-ink-2">Real source folders, analyzed on this computer like any project you open.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {samples.map((s) => (
          <button key={s.id} type="button" onClick={() => void openProjectPath(s.path)} title={s.path} className="rounded-lg border border-line bg-panel px-3 py-2.5 text-left hover:border-line-strong hover:bg-raised">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-ink">{s.name}</span>
              <FrameworkTag framework={s.framework} />
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-2">{s.detail}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Top bar: switch to another sample project. */
export function SamplesMenu({ disabled }: { disabled?: boolean }) {
  const samples = useSampleProjects();
  const openProjectPath = useExplorer((s) => s.openProjectPath);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!samples.length) return null;
  return (
    <div ref={ref} className="relative mr-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Open a sample project"
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <PhoneIcon size={13} /> Samples
      </button>
      {open && (
        <div role="menu" aria-label="Sample projects" className="absolute right-0 top-9 z-40 w-[340px] rounded-lg border border-line bg-panel p-1.5 shadow-2xl">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void openProjectPath(s.path);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-raised focus:bg-raised"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                <FrameworkTag framework={s.framework} />
              </div>
              <div className="truncate text-[11px] text-muted">{s.detail}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
