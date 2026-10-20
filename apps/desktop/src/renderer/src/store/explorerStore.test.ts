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
