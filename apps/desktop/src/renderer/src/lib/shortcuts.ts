/**
 * Every keyboard shortcut, in one place: the handlers and the help overlay
 * read the same list, so the help never drifts from what the keys do.
 */
export type ShortcutId =
  | 'palette'
  | 'help'
  | 'escape'
  | 'export'
  | 'report'
  | 'reanalyze'
  | 'nextUnresolved'
  | 'openCode'
  | 'toggleFiles'
  | 'toggleDetails'
  | 'fit'
  | 'zoomIn'
  | 'zoomOut'
  | 'minimap';

export interface Shortcut {
  id: ShortcutId;
  /** Key as in `KeyboardEvent.key` (lower-cased letters). */
  key: string;
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  mod?: boolean;
  shift?: boolean;
  description: string;
  group: 'General' | 'Map' | 'Panels';
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'palette', key: 'k', mod: true, description: 'Search screens, routes, widgets and files', group: 'General' },
  { id: 'help', key: '?', shift: true, description: 'Show keyboard shortcuts', group: 'General' },
  { id: 'escape', key: 'Escape', description: 'Close a dialog, or clear the selection', group: 'General' },
  { id: 'export', key: 'e', mod: true, description: 'Export the flow map', group: 'General' },
  { id: 'reanalyze', key: 'r', shift: true, description: 'Re-analyze the project', group: 'General' },
  { id: 'report', key: 'c', description: 'Coverage and unresolved-flow report', group: 'General' },
  { id: 'nextUnresolved', key: 'n', description: 'Select the next unresolved flow', group: 'Map' },
  { id: 'openCode', key: 'o', description: 'Open the selection’s source code', group: 'Map' },
  { id: 'fit', key: 'f', description: 'Fit the whole map in view', group: 'Map' },
  { id: 'zoomIn', key: '=', description: 'Zoom in', group: 'Map' },
  { id: 'zoomOut', key: '-', description: 'Zoom out', group: 'Map' },
  { id: 'minimap', key: 'm', description: 'Show or hide the minimap', group: 'Map' },
  { id: 'toggleFiles', key: 'b', mod: true, description: 'Show or hide the file explorer', group: 'Panels' },
  { id: 'toggleDetails', key: 'b', mod: true, shift: true, description: 'Show or hide the details panel', group: 'Panels' },
];

const isMac = () => typeof window !== 'undefined' && window.appflow?.platform === 'darwin';

/** True while typing in a field, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor');
}

const SHIFT_FREE = new Set(['?', '=', '-']);

/** The shortcut an event triggers, if any. */
export function matchShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target'>): ShortcutId | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key === '+' ? '=' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const s of SHORTCUTS) {
    if (s.key !== key || !!s.mod !== mod) continue;
    // Symbols are typed with or without Shift depending on the layout; letters must match Shift exactly.
    if (!SHIFT_FREE.has(s.key) && !!s.shift !== e.shiftKey) continue;
    if (!s.mod && s.key !== 'Escape' && isTyping(e.target)) return null;
    return s.id;
  }
  return null;
}

/** Keys as shown to the user, e.g. ["⌘", "K"] or ["Ctrl", "Shift", "B"]. */
export function shortcutKeys(s: Shortcut): string[] {
  const keys: string[] = [];
  if (s.mod) keys.push(isMac() ? '⌘' : 'Ctrl');
  if (s.shift && s.key !== '?') keys.push(isMac() ? '⇧' : 'Shift');
  keys.push(s.key === 'Escape' ? 'Esc' : s.key === '=' ? '+' : s.key.toUpperCase());
  return keys;
}

export const shortcutById = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)!;
