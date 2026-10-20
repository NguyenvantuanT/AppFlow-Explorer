import { useDialogFocus } from '../lib/a11y';
import { useRuntime } from '../store';
import { AlertIcon } from './icons';

/** Shows exactly what an action will run, and runs it only when the user confirms. */
export function ConfirmDialog() {
  const pending = useRuntime((s) => s.pending);
  const cancel = useRuntime((s) => s.cancelConfirmation);
  const ref = useDialogFocus<HTMLDivElement>(!!pending);
  if (!pending) return null;
  const c = pending.confirmation;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label={pending.title} ref={ref} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), cancel())}>
      <div className="w-[560px] max-w-full rounded-xl border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <AlertIcon size={16} className="text-warning" /> {pending.title}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{c.description}</p>

        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Command</div>
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg p-2.5 font-mono text-[11.5px] text-ink">{c.command.join(' ')}</pre>
        {c.cwd && (
          <p className="mt-1 truncate font-mono text-[11px] text-muted" title={c.cwd}>
            in {c.cwd}
          </p>
        )}
        {c.flutter && (
          <p className="mt-2 text-[12px] text-ink-2">
            Flutter {c.flutter.version ?? '?'} ({c.flutter.source}){c.flutter.pinned ? ` · project pins ${c.flutter.pinned}` : ''}
          </p>
        )}

        {(c.warnings?.length || c.sensitiveBuildInputs?.length) ? (
          <ul className="mt-3 space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-[12px] text-ink-2">
            {c.warnings?.map((w) => <li key={w}>• {w}</li>)}
            {!!c.sensitiveBuildInputs?.length && <li>• The build reads {c.sensitiveBuildInputs.join(', ')} (AppFlow itself never reads them).</li>}
          </ul>
        ) : null}

        <p className="mt-3 text-[11.5px] text-muted">The confirmation is single-use and covers only this exact command.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={cancel} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-raised">
            Cancel
          </button>
          <button type="button" onClick={() => void pending.confirm()} className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#2f74e6]" autoFocus>
            Confirm and run
          </button>
        </div>
      </div>
    </div>
  );
}
