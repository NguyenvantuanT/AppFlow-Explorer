import { cpSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, type Agent } from './server';

const fixtures = path.resolve(__dirname, '../../analyzer/fixtures');
let agent: Agent;
let dir: string;
let projectId: string;

const api = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(agent.url + url, {
    method,
    headers: { Authorization: `Bearer ${agent.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const analyze = async () => {
  const { json } = await api('POST', `/v1/projects/${projectId}/analyses`, {});
  for (let i = 0; i < 200; i++) {
    const r = await api('GET', `/v1/analyses/${json.analysis.id}`);
    if (r.json.analysis.status === 'succeeded') return json.analysis.id as string;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('analysis did not finish');
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'appflow-changes-'));
  cpSync(path.join(fixtures, 'flutter_states'), dir, { recursive: true });
  agent = await startAgent({ dataDir: path.join(dir, '.data-unused') });
  projectId = (await api('POST', '/v1/projects', { path: dir })).json.project.id;
});
afterAll(async () => {
  await agent.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('source change detection', () => {
  it('refuses before the first analysis', async () => {
    expect((await api('GET', `/v1/projects/${projectId}/changes`)).status).toBe(409);
  });

  it('reports nothing right after an analysis, and ignores a touch without edits', async () => {
    const analysisId = await analyze();
    const { json } = await api('GET', `/v1/projects/${projectId}/changes`);
    expect(json).toMatchObject({ analysisId, changed: false, counts: { added: 0, removed: 0, modified: 0 } });
    const file = path.join(dir, 'lib/screens/feed_screen.dart');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect((await api('GET', `/v1/projects/${projectId}/changes`)).json.changed).toBe(false);
  });

  it('lists added, removed and edited files, then clears after re-analysis', async () => {
    writeFileSync(path.join(dir, 'lib/screens/settings_screen.dart'), 'class SettingsScreen {}\n// edited\n');
    writeFileSync(path.join(dir, 'lib/screens/new_screen.dart'), 'class NewScreen {}\n');
    unlinkSync(path.join(dir, 'lib/services/auth_service.dart'));
    const { json } = await api('GET', `/v1/projects/${projectId}/changes`);
    expect(json).toMatchObject({
      changed: true,
      counts: { added: 1, removed: 1, modified: 1 },
      added: ['lib/screens/new_screen.dart'],
      removed: ['lib/services/auth_service.dart'],
      modified: ['lib/screens/settings_screen.dart'],
    });
    await analyze();
    expect((await api('GET', `/v1/projects/${projectId}/changes`)).json.changed).toBe(false);
  });
});
