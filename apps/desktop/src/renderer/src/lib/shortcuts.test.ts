import { describe, expect, it } from 'vitest';
import { matchShortcut, SHORTCUTS, shortcutKeys } from './shortcuts';

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: document.body, ...extra });

describe('keyboard shortcuts', () => {
  it('matches modifiers exactly', () => {
    expect(matchShortcut(key('k', { metaKey: true }))).toBe('palette');
    expect(matchShortcut(key('K', { ctrlKey: true }))).toBe('palette');
    expect(matchShortcut(key('b', { ctrlKey: true }))).toBe('toggleFiles');
    expect(matchShortcut(key('B', { ctrlKey: true, shiftKey: true }))).toBe('toggleDetails');
    expect(matchShortcut(key('R', { shiftKey: true }))).toBe('reanalyze');
    expect(matchShortcut(key('r'))).toBeNull();
    expect(matchShortcut(key('?', { shiftKey: true }))).toBe('help');
    expect(matchShortcut(key('f', { altKey: true }))).toBeNull();
  });

  it('ignores single keys while typing, but not modifier shortcuts or Escape', () => {
    const input = document.createElement('input');
    expect(matchShortcut(key('f', { target: input }))).toBeNull();
    expect(matchShortcut(key('k', { target: input, ctrlKey: true }))).toBe('palette');
    expect(matchShortcut(key('Escape', { target: input }))).toBe('escape');
  });

  it('has no two shortcuts on the same keys', () => {
    const combos = SHORTCUTS.map((s) => `${s.mod}|${s.shift}|${s.key}`);
    expect(new Set(combos).size).toBe(combos.length);
    expect(shortcutKeys(SHORTCUTS.find((s) => s.id === 'zoomIn')!)).toEqual(['+']);
  });
});
