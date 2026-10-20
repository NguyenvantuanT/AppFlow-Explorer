import type { AppProject } from '@appflow/model';
import { describe, expect, it, vi } from 'vitest';
import type { AgentApi, AnalysisInfo } from '../agent/client';
import { shopliteProject } from '../mock/shoplite/project';
import { createExplorerStore } from './explorerStore';

const analyzed: AppProject = {
  id: 'p1',
  name: 'demo-app',
  framework: 'android',
  platforms: ['android'],
  rootPath: '/work/demo-app',
  source: 'analysis',
  files: [{ id: 'app/Main.kt', path: 'app/Main.kt', language: 'kotlin' }],
  screens: [{ id: 'android:Main', name: 'Main', kind: 'page', widgetClass: 'Main', location: { fileId: 'app/Main.kt', line: 3 }, isEntryPoint: true, keyWidgets: [], states: [] }],
  edges: [],
};

function fakeAgent(statuses: AnalysisInfo['status'][], overrides: Partial<AgentApi> = {}): AgentApi {
  let polls = 0;
  const info = (status: AnalysisInfo['status']): AnalysisInfo => ({ id: 'a1', projectId: 'p1', status, progress: { phase: 'analyzing', message: `step ${polls}`, percent: status === 'succeeded' ? 100 : 40 } });
  return {
    available: () => true,
    pickProjectDirectory: vi.fn(async () => '/work/demo-app'),
    registerProject: vi.fn(async () => ({ id: 'p1', name: 'demo-app', rootPath: '/work/demo-app', frameworks: [] })),
    startAnalysis: vi.fn(async () => info('queued')),
    getAnalysis: vi.fn(async () => info(statuses[Math.min(polls++, statuses.length - 1)]!)),
    cancelAnalysis: vi.fn(async () => info('cancelled')),
    getResult: vi.fn(async () => analyzed),
    fileContent: vi.fn(async () => 'class Main'),
    ...overrides,
  };
}

describe('explorer store — local agent workflow', () => {
  it('starts on the welcome screen and can load the demo', async () => {
    const store = createExplorerStore(shopliteProject, { agent: fakeAgent([]), pollMs: 0 });
    expect(store.getState().workspace.status).toBe('welcome');
    await store.getState().loadDemo();
    expect(store.getState().workspace.status).toBe('demo');
    expect(store.getState().project.source).toBe('mock');
  });

  it('opens a folder, polls the analysis and loads the result', async () => {
    const agent = fakeAgent(['running', 'running', 'succeeded']);
    const store = createExplorerStore(shopliteProject, { agent, pollMs: 0 });
    await store.getState().openProjectFolder();
    expect(agent.registerProject).toHaveBeenCalledWith('/work/demo-app');
    expect(agent.getAnalysis).toHaveBeenCalledTimes(3);
    const { workspace, project } = store.getState();
    expect(workspace).toMatchObject({ status: 'ready', projectId: 'p1', hasResult: true });
    expect(project.name).toBe('demo-app');
    expect(store.getState().layoutStatus).toBe('ready');
  });

  it('does nothing when the folder picker is cancelled', async () => {
    const agent = fakeAgent([], { pickProjectDirectory: vi.fn(async () => null) });
    const store = createExplorerStore(shopliteProject, { agent, pollMs: 0 });
    await store.getState().openProjectFolder();
    expect(agent.registerProject).not.toHaveBeenCalled();
    expect(store.getState().workspace.status).toBe('welcome');
  });

  it('reports agent errors and failed analyses', async () => {
    const rejecting = fakeAgent([], { registerProject: vi.fn(async () => Promise.reject(new Error('Project path does not exist'))) });
    const store = createExplorerStore(shopliteProject, { agent: rejecting, pollMs: 0 });
    await store.getState().openProjectFolder();
    expect(store.getState().workspace).toMatchObject({ status: 'error', error: 'Project path does not exist' });

    const failing = fakeAgent(['failed']);
    const store2 = createExplorerStore(shopliteProject, { agent: failing, pollMs: 0 });
    await store2.getState().openProjectFolder();
    expect(store2.getState().workspace.status).toBe('error');
  });

  it('returns to the welcome screen when the first analysis is cancelled', async () => {
    const store = createExplorerStore(shopliteProject, { agent: fakeAgent(['running', 'cancelled']), pollMs: 0 });
    await store.getState().openProjectFolder();
    expect(store.getState().workspace.status).toBe('welcome');
  });

  it('fetches file content on demand, once', async () => {
    const agent = fakeAgent(['succeeded']);
    const store = createExplorerStore(shopliteProject, { agent, pollMs: 0 });
    await store.getState().openProjectFolder();
    await store.getState().ensureFileContent('app/Main.kt');
    await store.getState().ensureFileContent('app/Main.kt');
    expect(agent.fileContent).toHaveBeenCalledTimes(1);
    expect(agent.fileContent).toHaveBeenCalledWith('p1', 'app/Main.kt');
    expect(store.getState().fileContents['app/Main.kt']).toEqual({ status: 'ready', content: 'class Main' });
  });
});

describe('explorer store — flow map, corrections and re-analysis', () => {
  const screen = (id: string, file: string, entry = false) => ({ id, name: id, kind: 'page' as const, widgetClass: id, location: { fileId: file, line: 1 }, isEntryPoint: entry, keyWidgets: [], states: [] });
  const edge = (from: string, to: string | null, line = 5) => ({
    id: to === null ? `${from}->?@lib/${from}.dart:${line}` : `${from}->${to}:push`,
    from,
    to,
    kind: 'push' as const,
    trigger: { label: `Go ${to ?? '?'}`, description: '', handler: 'onTap', location: { fileId: `lib/${from}.dart`, line } },
    evidence: [{ source: 'static' as const, detail: 'push' }],
  });
  const v1: AppProject = {
    id: 'p1',
    name: 'app',
    framework: 'flutter',
    rootPath: '/app',
    source: 'analysis',
    files: [],
    screens: [screen('splash', 'lib/features/splash/splash.dart', true), screen('login', 'lib/features/auth/login.dart'), screen('home', 'lib/features/home/home.dart')],
    edges: [edge('splash', 'login'), edge('login', 'home'), edge('home', null, 12)],
  };
  /** After a code change: a new screen, and the unresolved call moved down by 10 lines. */
  const v2: AppProject = {
    ...v1,
    screens: [...v1.screens, screen('cart', 'lib/features/cart/cart.dart')],
    edges: [edge('splash', 'login'), edge('login', 'home'), edge('home', 'cart'), edge('home', null, 22)],
  };

  async function opened(results: AppProject[]) {
    localStorage.clear();
    let n = 0;
    const agent = fakeAgent(['succeeded'], { getResult: vi.fn(async () => results[Math.min(n++, results.length - 1)]!) });
    const store = createExplorerStore(shopliteProject, { agent, pollMs: 0 });
    await store.getState().openProjectFolder();
    return store;
  }

  it('re-applies corrections after re-analysis and keeps the layout stable', async () => {
    const store = await opened([v1, v2]);
    const s = store.getState();
    const unresolvedId = s.project.edges.find((e) => e.to === null)!.id;
    s.resolveEdge(unresolvedId, 'login');
    s.hideEdge('login->home:push');
    s.pinNode('login', { x: 999, y: 999 });
    await vi.waitFor(() => expect(store.getState().layoutStatus).toBe('ready'));
    const before = store.getState().positions;

    await store.getState().reanalyze();
    const after = store.getState();
    // The unresolved call moved to line 22 but keeps the destination the user chose.
    const resolved = after.project.edges.find((e) => e.id === 'home->?@lib/home.dart:22')!;
    expect(resolved.to).toBe('login');
    expect(after.index.statusCounts.manual).toBe(1);
    expect(after.project.edges.some((e) => e.id === 'login->home:push')).toBe(false);
    expect(after.hiddenEdges.map((e) => e.id)).toEqual(['login->home:push']);
    expect(after.staleCorrections).toEqual([]);
    // Surviving screens did not move; the new one got a place.
    for (const id of ['splash', 'login', 'home']) expect(after.positions[id], id).toEqual(before[id]);
    expect(after.positions['login']).toEqual({ x: 999, y: 999 });
    expect(after.positions['cart']).toBeDefined();
  });

  it('persists corrections per project across sessions', async () => {
    const store = await opened([v1]);
    const id = store.getState().addEdge({ from: 'home', to: 'splash', label: 'Log out', kind: 'reset' });
    expect(store.getState().index.edgesById.get(id)!.trigger.label).toBe('Log out');

    let n = 0;
    const agent = fakeAgent(['succeeded'], { getResult: vi.fn(async () => [v1][n++]!) });
    const next = createExplorerStore(shopliteProject, { agent, pollMs: 0 });
    await next.getState().openProjectFolder();
    expect(next.getState().project.edges.find((e) => e.id === id)?.correction?.addedByUser).toBe(true);

    next.getState().hideEdge(id); // deleting an added edge removes it rather than hiding it
    expect(next.getState().corrections.addedEdges).toEqual([]);
    expect(next.getState().hiddenEdges).toEqual([]);
  });

  it('restores hidden edges and reports corrections that no longer match', async () => {
    const store = await opened([v1, { ...v1, edges: v1.edges.filter((e) => e.id !== 'login->home:push') }]);
    store.getState().hideEdge('login->home:push');
    store.getState().restoreEdge('login->home:push');
    expect(store.getState().project.edges.some((e) => e.id === 'login->home:push')).toBe(true);

    store.getState().hideEdge('login->home:push');
    await store.getState().reanalyze();
    expect(store.getState().staleCorrections.map((c) => c.kind)).toEqual(['hidden']);
  });

  it('filters without re-arranging the map', async () => {
    const store = await opened([v1]);
    const version = store.getState().layoutVersion;
    store.getState().setFilters({ statuses: ['declared'] });
    expect(store.getState().layoutVersion).toBe(version);
    store.getState().resetFilters();
    expect(store.getState().filters.statuses).toContain('inferred');
  });

  it('adds runtime-observed transitions as verified edges without a guessed trigger', async () => {
    const store = await opened([v1]);
    store.getState().applyRuntimeOverlay([], [{ id: 'o', sessionId: 's', fromScreenId: 'home', toScreenId: 'splash', observedAt: '2026-10-20T10:00:00Z' }], {});
    const observed = store.getState().project.edges.find((e) => e.id === 'runtime:home->splash')!;
    expect(observed.trigger.label).toBe('Observed at runtime');
    expect(store.getState().index.statusCounts.verified).toBe(1);
    expect(store.getState().graph.edges.some((e) => e.id === observed.id && e.status === 'verified')).toBe(true);
  });
});
