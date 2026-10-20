import { ALL_STATUSES, defaultFilters, type FlowFilters, type ScreenKind } from '@appflow/model';
import type { Selection } from './explorerStore';

/**
 * What the user was looking at, restored on the next start: the last opened
 * project folder, and per project the selection, filters and viewport. Only
 * ids and paths on this computer are stored, never source code.
 */
export interface ProjectSession {
  selection: Selection;
  filters: FlowFilters;
  viewport?: { x: number; y: number; zoom: number };
}

export interface Session {
  lastProject?: { path: string; name: string };
  projects: Record<string, ProjectSession>;
}

const KEY = 'appflow:session:v1';
/** Sessions of projects not opened recently are dropped. */
const MAX_PROJECTS = 20;
const KINDS: ScreenKind[] = ['page', 'dialog', 'bottomSheet'];

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseSelection(v: unknown): Selection {
  const s = v as { kind?: unknown; id?: unknown } | null;
  return s && (s.kind === 'screen' || s.kind === 'edge') && typeof s.id === 'string' ? { kind: s.kind, id: s.id } : null;
}

function parseFilters(v: unknown): FlowFilters {
  const f = (v ?? {}) as Record<string, unknown>;
  const d = defaultFilters();
  return {
    statuses: Array.isArray(f['statuses']) ? strings(f['statuses']).filter((s): s is FlowFilters['statuses'][number] => (ALL_STATUSES as string[]).includes(s)) : d.statuses,
    screenKinds: Array.isArray(f['screenKinds']) ? strings(f['screenKinds']).filter((k): k is ScreenKind => (KINDS as string[]).includes(k)) : d.screenKinds,
    hiddenFeatures: strings(f['hiddenFeatures']),
    hideIsolated: f['hideIsolated'] === true,
  };
}

function parseProject(v: unknown): ProjectSession {
  const p = (v ?? {}) as Record<string, unknown>;
  const vp = p['viewport'] as Record<string, unknown> | undefined;
  return {
    selection: parseSelection(p['selection']),
    filters: parseFilters(p['filters']),
    ...(vp && finite(vp['x']) && finite(vp['y']) && finite(vp['zoom']) && vp['zoom'] > 0 ? { viewport: { x: vp['x'], y: vp['y'], zoom: vp['zoom'] } } : {}),
  };
}

/** Malformed or foreign entries are dropped, never trusted. */
export function loadSession(): Session {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const last = raw['lastProject'] as Record<string, unknown> | undefined;
    const projects: Record<string, ProjectSession> = {};
    const stored = raw['projects'];
    if (typeof stored === 'object' && stored !== null) {
      for (const [id, value] of Object.entries(stored).slice(-MAX_PROJECTS)) projects[id] = parseProject(value);
    }
    return {
      ...(last && typeof last['path'] === 'string' && typeof last['name'] === 'string' ? { lastProject: { path: last['path'], name: last['name'] } } : {}),
      projects,
    };
  } catch {
    return { projects: {} };
  }
}

function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Non-fatal: the next start opens on the welcome screen.
  }
}

export function rememberLastProject(path: string, name: string): void {
  saveSession({ ...loadSession(), lastProject: { path, name } });
}

export function forgetLastProject(): void {
  const { lastProject: _, ...rest } = loadSession();
  saveSession(rest);
}

export function projectSession(projectId: string): ProjectSession | undefined {
  return loadSession().projects[projectId];
}

/** Merges into a project's session; the project moves to the most recent position. */
export function updateProjectSession(projectId: string, change: Partial<ProjectSession>): void {
  const session = loadSession();
  const current = session.projects[projectId] ?? { selection: null, filters: defaultFilters() };
  const { [projectId]: _, ...others } = session.projects;
  saveSession({ ...session, projects: { ...others, [projectId]: { ...current, ...change } } });
}
