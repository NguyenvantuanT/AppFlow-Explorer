import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, type Agent } from './server';

const fixtures = path.resolve(__dirname, '../../analyzer/fixtures');
const runs: Array<{ command: string[]; cwd: string }> = [];
let agent: Agent;

beforeAll(async () => {
  agent = await startAgent({
    allowedOrigins: ['http://localhost:5173'],
    runner: async (command, cwd, onOutput) => {
      runs.push({ command, cwd });
      onOutput('done\n');
      return 0;
    },
  });
});
afterAll(() => agent.close());

const api = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(agent.url + url, {
    method,
    headers: { Authorization: `Bearer ${agent.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
};

const register = async (fixture: string) => (await api('POST', '/v1/projects', { path: path.join(fixtures, fixture) })).json.project;

const waitFor = async (analysisId: string) => {
  for (let i = 0; i < 200; i++) {
    const { json } = await api('GET', `/v1/analyses/${analysisId}`);
    if (!['queued', 'running'].includes(json.analysis.status)) return json.analysis;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('analysis did not finish');
};

describe('security', () => {
  it('binds to loopback only', async () => {
    expect(agent.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await expect(startAgent({ host: '0.0.0.0' as '127.0.0.1' })).rejects.toThrow(/loopback/);
  });

  it('serves health without a token but requires one everywhere else', async () => {
    expect((await fetch(`${agent.url}/v1/health`)).status).toBe(200);
    expect((await fetch(`${agent.url}/v1/projects`)).status).toBe(401);
    expect((await api('GET', '/v1/projects', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await api('GET', '/v1/projects')).status).toBe(200);
  });

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: agent.port, path: '/v1/health', headers: { Host: 'evil.example:80' } }, (res) => resolve(res.statusCode!));
    });
    expect(status).toBe(421);
  });

  it('only allows configured browser origins', async () => {
    expect((await api('GET', '/v1/projects', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    const ok = await api('GET', '/v1/projects', undefined, { Origin: 'http://localhost:5173' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('returns structured errors for unknown routes and methods', async () => {
    expect((await api('GET', '/v1/nope')).json.error.code).toBe('not_found');
    expect((await api('PUT', '/v1/projects')).status).toBe(405);
  });
});

describe('projects', () => {
  it('validates the request body', async () => {
    const empty = await api('POST', '/v1/projects', {});
    expect(empty.status).toBe(400);
    expect(empty.json.error.details[0].path).toBe('path');
    expect((await api('POST', '/v1/projects', '{not json')).status).toBe(400);
    expect((await api('POST', '/v1/projects', 'path=x', { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('rejects relative, missing and overly broad directories', async () => {
    expect((await api('POST', '/v1/projects', { path: 'relative/dir' })).status).toBe(400);
    expect((await api('POST', '/v1/projects', { path: path.join(fixtures, 'does-not-exist') })).status).toBe(400);
    expect((await api('POST', '/v1/projects', { path: path.parse(fixtures).root })).status).toBe(403);
  });

  it('registers a project and detects its frameworks; registering again is idempotent', async () => {
    const first = await api('POST', '/v1/projects', { path: path.join(fixtures, 'rn_recipebox') });
    expect(first.status).toBe(201);
    expect(first.json.project.frameworks.map((f: { id: string }) => f.id)).toEqual(['react-native', 'android', 'ios']);
    const again = await api('POST', '/v1/projects', { path: path.join(fixtures, 'rn_recipebox') });
    expect(again.status).toBe(200);
    expect(again.json.project.id).toBe(first.json.project.id);
  });
});

describe('analysis', () => {
  it('runs an analysis with progress and returns the normalized result and warnings', async () => {
    const project = await register('flutter_shop');
    const started = await api('POST', `/v1/projects/${project.id}/analyses`);
    expect(started.status).toBe(202);
    expect(['queued', 'running']).toContain(started.json.analysis.status);
    expect((await api('GET', `/v1/analyses/${started.json.analysis.id}/result`)).status).toBe(409);

    const done = await waitFor(started.json.analysis.id);
    expect(done.status).toBe('succeeded');
    expect(done.progress.percent).toBe(100);
    expect(done.summary.screens).toBeGreaterThan(10);

    const result = await api('GET', `/v1/analyses/${done.id}/result`);
    expect(result.json.project.id).toBe(project.id);
    expect(result.json.project.files.every((f: { content?: string }) => f.content === undefined)).toBe(true);
    const warnings = await api('GET', `/v1/analyses/${done.id}/warnings`);
    expect(warnings.json.warnings.map((w: { code: string }) => w.code)).toContain('sensitive-files-excluded');
  });

  it('can restrict adapters and be cancelled', async () => {
    const project = await register('android_tasky');
    const started = await api('POST', `/v1/projects/${project.id}/analyses`, { adapters: ['android'] });
    const cancelled = await api('POST', `/v1/analyses/${started.json.analysis.id}/cancel`);
    expect(cancelled.status).toBe(202);
    expect((await waitFor(started.json.analysis.id)).status).toBe('cancelled');
  });
});

describe('file access', () => {
  it('serves project files on demand', async () => {
    const project = await register('flutter_shop');
    const res = await api('GET', `/v1/projects/${project.id}/files/content?path=${encodeURIComponent('lib/main.dart')}`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ path: 'lib/main.dart', language: 'dart' });
    expect(res.json.content).toContain('class ShopLiteApp');
  });

  it.each([
    ['../android_tasky/settings.gradle.kts', 403],
    ['lib/../../rn_recipebox/package.json', 403],
    [path.join(fixtures, 'flutter_shop', 'lib', 'main.dart'), 403],
    ['.env', 403],
    ['android/key.properties', 403],
    ['lib/missing.dart', 404],
    ['assets/images/logo.png', 415],
  ])('GET %s → %i', async (p, status) => {
    const project = await register('flutter_shop');
    const res = await api('GET', `/v1/projects/${project.id}/files/content?path=${encodeURIComponent(p)}`);
    expect(res.status).toBe(status);
  });
});

describe('operations', () => {
  it('lists operations available for the detected platforms', async () => {
    const project = await register('flutter_shop');
    const res = await api('GET', `/v1/projects/${project.id}/operations`);
    expect(res.json.operations.map((o: { id: string }) => o.id)).toContain('flutter-pub-get');
  });

  it('requires an explicit, single-use confirmation before running anything', async () => {
    const project = await register('flutter_shop');
    runs.length = 0;

    const ask = await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'flutter-pub-get' });
    expect(ask.status).toBe(428);
    expect(ask.json.error.code).toBe('confirmation_required');
    const { confirmation } = ask.json.error.details;
    expect(confirmation.command).toEqual(['flutter', 'pub', 'get']);
    expect(runs).toHaveLength(0);

    expect((await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'flutter-pub-get', confirmationToken: 'forged' })).status).toBe(403);
    expect(runs).toHaveLength(0);

    const run = await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'flutter-pub-get', confirmationToken: confirmation.token });
    expect(run.status).toBe(202);
    expect(runs).toEqual([{ command: ['flutter', 'pub', 'get'], cwd: path.join(fixtures, 'flutter_shop') }]);
    const status = await api('GET', `/v1/operations/${run.json.operation.id}`);
    expect(status.json.operation).toMatchObject({ status: 'succeeded', exitCode: 0 });

    // Tokens are single-use.
    expect((await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'flutter-pub-get', confirmationToken: confirmation.token })).status).toBe(403);
    expect(runs).toHaveLength(1);
  });

  it('does not accept a token issued for another operation', async () => {
    const project = await register('rn_recipebox');
    const ask = await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'npm-install' });
    const token = ask.json.error.details.confirmation.token;
    expect((await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'pod-install', confirmationToken: token })).status).toBe(403);
    expect((await api('POST', `/v1/projects/${project.id}/operations`, { operation: 'rm-rf' })).status).toBe(404);
  });
});
