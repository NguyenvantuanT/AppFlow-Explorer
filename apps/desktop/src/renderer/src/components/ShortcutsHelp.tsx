import { useDialogFocus } from '../lib/a11y';
import { SHORTCUTS, shortcutKeys, type Shortcut } from '../lib/shortcuts';
import { useExplorer } from '../store';
import { CloseIcon } from './icons';

const GROUPS: Shortcut['group'][] = ['General', 'Map', 'Panels'];

export function ShortcutsHelp() {
  const open = useExplorer((s) => s.shortcutsOpen);
  const setOpen = useExplorer((s) => s.setShortcutsOpen);
  const ref = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onMouseDown={close}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}
        className="w-[520px] max-w-full rounded-xl border border-line-strong bg-panel p-5 shadow-2xl"
        data-testid="shortcuts-help"
      >
        <div className="flex items-center">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold text-white">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={close} aria-label="Close keyboard shortcuts" className="ml-auto rounded p-1 text-muted hover:bg-raised hover:text-ink">
            <CloseIcon size={16} />
          </button>
        </div>
        {GROUPS.map((g) => (
          <section key={g} className="mt-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</h3>
            <dl className="divide-y divide-line">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-1.5">
                  <dt className="flex shrink-0 gap-1">
                    {shortcutKeys(s).map((k) => (
                      <kbd key={k} className="min-w-[22px] rounded border border-line-strong bg-bg px-1.5 py-px text-center font-mono text-[11px] text-ink">
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-[12.5px] text-ink-2">{s.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="mt-4 text-[11.5px] text-muted">Single-key shortcuts are off while typing in a field. The map can also be explored with Tab and Enter.</p>
      </div>
    </div>
  );
}
