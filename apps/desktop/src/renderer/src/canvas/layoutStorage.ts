import type { Positions } from './layout';

const key = (projectId: string) => `appflow:layout:${projectId}:v1`;

/** Loads manually placed node positions. Storage failures degrade to "no saved layout". */
export function loadPinnedLayout(projectId: string): Positions {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Positions = {};
    for (const [id, value] of Object.entries(parsed)) {
      const { x, y } = (value ?? {}) as Partial<Record<'x' | 'y', unknown>>;
      if (typeof x === 'number' && typeof y === 'number') result[id] = { x, y };
    }
    return result;
  } catch {
    return {};
  }
}

export function savePinnedLayout(projectId: string, pinned: Positions): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(pinned));
  } catch {
    // Non-fatal: layout simply won't survive a restart.
  }
}
