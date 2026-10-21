import type { PreviewNode, ScreenPreview } from '@appflow/model';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, type Agent } from './server';

/** Screens drawn from code through the agent API, on a copy of the rn_livestream fixture. */
const fixture = path.resolve(__dirname, '../../analyzer/fixtures/rn_livestream');
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

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'appflow-preview-'));
  cpSync(fixture, path.join(dir, 'app'), { recursive: true });
  // A 1×1 PNG.
  writeFileSync(path.join(dir, 'app', 'src', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  agent = await startAgent({ dataDir: path.join(dir, 'data') });
  projectId = (await api('POST', '/v1/projects', { path: path.join(dir, 'app') })).json.project.id;
});
afterAll(async () => {
  await agent.close();
  rmSync(dir, { recursive: true, force: true });
});

const texts = (n: PreviewNode): string[] => (n.type === 'raw' && !n.dynamic ? [n.text!] : (n.children ?? []).flatMap(texts));

describe('screen previews', () => {
  it('needs an analysis first', async () => {
    expect((await api('GET', `/v1/projects/${projectId}/screens/preview?screen=react-native:HomeScreen`)).status).toBe(409);
  });

  it('draws a React Native screen of the latest analysis', async () => {
    const started = (await api('POST', `/v1/projects/${projectId}/analyses`, {})).json;
    for (let i = 0; i < 200; i++) {
      const r = await api('GET', `/v1/analyses/${started.analysis.id}`);
      if (r.json.analysis.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const { status, json } = await api('GET', `/v1/projects/${projectId}/screens/preview?screen=${encodeURIComponent('react-native:HomeScreen')}`);
    expect(status).toBe(200);
    const preview = json.preview as ScreenPreview;
    expect(preview).toMatchObject({ screenId: 'react-native:HomeScreen', width: 375, height: 812 });
    expect(texts(preview.root)).toEqual(['Go live', 'Invitations']);
    // Android screens are drawn from their layout; this activity has none.
    const android = await api('GET', `/v1/projects/${projectId}/screens/preview?screen=android:AnchorActivity`);
    expect(android.status).toBe(200);
    expect(android.json.preview).toMatchObject({ platform: 'android', notes: ['No layout was found for AnchorActivity (setContentView, inflate or view binding).'] });
    // iOS view controllers built in code are not drawn.
    expect((await api('GET', `/v1/projects/${projectId}/screens/preview?screen=ios:AnchorViewController`)).status).toBe(415);
    expect((await api('GET', `/v1/projects/${projectId}/screens/preview?screen=react-native:Nope`)).status).toBe(404);
  });

  it('serves project images only', async () => {
    const ok = await api('GET', `/v1/projects/${projectId}/preview/asset?path=src/logo.png`);
    expect(ok.status).toBe(200);
    expect(ok.json.dataUri).toMatch(/^data:image\/png;base64,iVBOR/);
    expect((await api('GET', `/v1/projects/${projectId}/preview/asset?path=App.tsx`)).status).toBe(415);
    expect((await api('GET', `/v1/projects/${projectId}/preview/asset?path=../secret.png`)).status).toBe(403);
    expect((await api('GET', `/v1/projects/${projectId}/preview/icon-font?set=../x`)).status).toBe(400);
  });
});
