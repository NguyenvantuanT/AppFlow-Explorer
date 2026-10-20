import type { ExportFormat } from '@appflow/model';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { agentApi } from '../agent/client';
import { useExplorer } from '../store';
import { ExportIcon } from './icons';

const FORMATS: Array<{ id: ExportFormat; label: string; detail: string }> = [
  { id: 'json', label: 'JSON', detail: 'Screens, connections, states and coverage for tools' },
  { id: 'markdown', label: 'Markdown', detail: 'Readable report for docs and reviews' },
  { id: 'mermaid', label: 'Mermaid', detail: 'Flowchart for README files and wikis' },
  { id: 'svg', label: 'SVG image', detail: 'The map as arranged on the canvas' },
];

/** Exports never contain file contents or the project's absolute path. */
export function ExportMenu() {
  const exportMap = useExplorer((s) => s.exportMap);
  const status = useExplorer((s) => s.exportStatus);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canSave = agentApi.available();

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

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => useExplorer.setState({ exportStatus: null }), 6000);
    return () => clearTimeout(t);
  }, [status]);

  // Opened by the keyboard shortcut.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('appflow:open-export', onOpen);
    return () => window.removeEventListener('appflow:open-export', onOpen);
  }, []);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={!canSave}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={canSave ? 'Export the flow map' : 'Exporting requires the desktop app'}
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        <ExportIcon size={13} /> Export
      </button>
      {open && (
        <div role="menu" aria-label="Export format" onKeyDown={onMenuKey} className="absolute right-0 top-9 z-40 w-[290px] rounded-lg border border-line bg-panel p-1.5 shadow-2xl">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void exportMap(f.id);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-raised focus:bg-raised"
            >
              <div className="text-[12.5px] font-medium text-ink">{f.label}</div>
              <div className="text-[11px] text-muted">{f.detail}</div>
            </button>
          ))}
          <p className="border-t border-line px-2.5 pb-1 pt-2 text-[10.5px] text-muted">Exports include names, routes and file paths relative to the project — never source code.</p>
        </div>
      )}
      {status && (
        <span role="status" className={`absolute right-0 top-9 z-30 w-max max-w-[360px] truncate rounded-md border px-2 py-1 text-[11px] ${open ? 'hidden' : ''} ${status.ok ? 'border-success/40 bg-panel text-success' : 'border-danger/40 bg-panel text-danger'}`} title={status.path ?? status.message}>
          {status.message}
        </span>
      )}
    </div>
  );
}
