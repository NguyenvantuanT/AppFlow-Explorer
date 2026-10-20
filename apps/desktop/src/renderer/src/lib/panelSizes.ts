import { useEffect, useState } from 'react';

/**
 * Sizes of the resizable panels: side panels in pixels, the code panel as a
 * fraction of the main area's height. Kept in this machine's local storage.
 */
export const PANEL_LIMITS = {
  left: { initial: 264, min: 200, max: 520 },
  right: { initial: 328, min: 280, max: 760 },
  code: { initial: 0.38, min: 0.15, max: 0.85 },
} as const;

export type PanelId = keyof typeof PANEL_LIMITS;

const KEY = 'appflow:panels:v1';

export function clampPanelSize(id: PanelId, value: number): number {
  const { initial, min, max } = PANEL_LIMITS[id];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
}

/** Saved sizes; anything missing or malformed falls back to the default. */
export function loadPanelSizes(): Record<PanelId, number> {
  const sizes = Object.fromEntries(Object.entries(PANEL_LIMITS).map(([id, l]) => [id, l.initial])) as Record<PanelId, number>;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return sizes;
    for (const id of Object.keys(PANEL_LIMITS) as PanelId[]) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === 'number') sizes[id] = clampPanelSize(id, v);
    }
  } catch {
    // unreadable storage: defaults
  }
  return sizes;
}

function savePanelSize(id: PanelId, value: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPanelSizes(), [id]: value }));
  } catch {
    // Non-fatal: the size simply won't survive a restart.
  }
}

/** One panel's size, clamped to its limits and saved shortly after it stops changing. */
export function usePanelSize(id: PanelId): [number, (value: number) => void] {
  const [size, setSize] = useState(() => loadPanelSizes()[id]);
  useEffect(() => {
    const t = setTimeout(() => savePanelSize(id, size), 250);
    return () => clearTimeout(t);
  }, [id, size]);
  return [size, (value) => setSize(clampPanelSize(id, value))];
}
