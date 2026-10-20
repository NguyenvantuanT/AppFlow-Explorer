import { buildFlowGraph, coverageReport, exportFlowMap, unresolvedReport, validateProject, type AppProject } from '@appflow/model';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, type Agent } from './server';

/**
 * End to end: a copied Flutter project goes through the agent's HTTP API the way
 * the desktop app uses it — register, analyze, read the result, report, export,
 * edit a file, see the change and re-analyze.
 */
const fixtures = path.resolve(__dirname, '../../analyzer/fixtures');
let agent: Agent;
let dir: string;
let projectId: string;

const api = async (method: string, url: string, body?: unknown, token = agent.token) => {
  const res = await fetch(agent.url + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const analyze = async (): Promise<AppProject> => {
  const { json } = await api('POST', `/v1/projects/${projectId}/analyses`, {});
  for (let i = 0; i < 200; i++) {
    const r = await api('GET', `/v1/analyses/${json.analysis.id}`);
    if (r.json.analysis.status === 'succeeded') return (await api('GET', `/v1/analyses/${json.analysis.id}/result`)).json.project;
    if (r.json.analysis.status === 'failed') throw new Error('analysis failed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('analysis did not finish');
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'appflow-e2e-'));
  cpSync(path.join(fixtures, 'flutter_states'), path.join(dir, 'app'), { recursive: true });
  agent = await startAgent({ dataDir: path.join(dir, 'data') });
  projectId = (await api('POST', '/v1/projects', { path: path.join(dir, 'app') })).json.project.id;
});
afterAll(async () => {
  await agent.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('analyze → report → export → change → re-analyze', () => {
  let project: AppProject;

  it('refuses requests without the session token', async () => {
    expect((await api('GET', '/v1/projects', undefined, 'wrong')).status).toBe(401);
  });

  it('returns a consistent project with UI states and deep links, without file contents', async () => {
    project = await analyze();
    expect(validateProject(project)).toEqual([]);
    expect(project.files.every((f) => (f as { content?: string }).content === undefined)).toBe(true);
    const feed = project.screens.find((s) => s.id === 'flutter:FeedScreen')!;
    expect(feed.discoveredStates!.map((s) => s.kind)).toEqual(expect.arrayContaining(['loading', 'empty', 'error', 'data', 'bottomSheet', 'tabs']));
    expect(project.screens.find((s) => s.id === 'flutter:LoginScreen')!.discoveredStates!.map((s) => s.kind)).toContain('auth');
    expect(project.deepLinks!.find((d) => d.platform === 'android' && d.kind === 'app-link')!.screenId).toBe('flutter:ArticleScreen');
  });

  it('reports coverage and unresolved items that match the project', () => {
    const coverage = coverageReport(project);
    expect(coverage.screens.total).toBe(project.screens.length);
    expect(coverage.screens.withDiscoveredStates).toBeGreaterThanOrEqual(3);
    expect(coverage.deepLinks.total).toBe(project.deepLinks!.length);
    const unresolved = unresolvedReport(project);
    expect(unresolved.flows.length).toBe(project.edges.filter((e) => e.to === null).length);
    expect(unresolved.deepLinks.map((d) => d.url)).toContain('newsreader://open');
  });

  it('exports every format without the absolute project path or source code', () => {
    const graph = buildFlowGraph(project, { groupByFeature: true, collapseSharedTargets: false });
    const positions = Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: (i % 4) * 360, y: Math.floor(i / 4) * 640 }]));
    const source = readFileSync(path.join(dir, 'app/lib/screens/feed_screen.dart'), 'utf8');
    const secretLine = source.split('\n').find((l) => l.includes('http.get'))!.trim();
    for (const format of ['json', 'markdown', 'mermaid', 'svg'] as const) {
      const { content } = exportFlowMap(format, project, { graph, positions, nodeSize: () => ({ width: 240, height: 520 }) });
      expect(content.length).toBeGreaterThan(100);
      expect(content).not.toContain(dir);
      expect(content).not.toContain(secretLine);
    }
    const json = JSON.parse(exportFlowMap('json', project).content);
    expect(json.screens.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['flutter:FeedScreen', 'flutter:ArticleScreen']));
  });

  it('notices an edited screen and picks up the new state after re-analysis', async () => {
    const file = path.join(dir, 'app/lib/screens/settings_screen.dart');
    const before = readFileSync(file, 'utf8');
    expect(project.screens.find((s) => s.id === 'flutter:SettingsScreen')!.discoveredStates ?? []).toEqual([]);
    writeFileSync(file, before.replace(/(Widget build\(BuildContext context\) \{)/, '$1\n    showDialog(context: context, builder: (_) => const SizedBox());'));
    const changes = (await api('GET', `/v1/projects/${projectId}/changes`)).json;
    expect(changes).toMatchObject({ changed: true, modified: ['lib/screens/settings_screen.dart'] });
    expect(JSON.stringify(changes)).not.toContain(dir);
    project = await analyze();
    expect(project.screens.find((s) => s.id === 'flutter:SettingsScreen')!.discoveredStates!.map((s) => s.kind)).toEqual(['dialog']);
    expect((await api('GET', `/v1/projects/${projectId}/changes`)).json.changed).toBe(false);
  });
});
