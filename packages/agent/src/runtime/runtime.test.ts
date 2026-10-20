import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, type Agent } from '../server';
import { assertSafeArgs, type ProcessRunner, type StreamHandle } from './exec';
import { findScreens } from './inspector';
import { pngSize } from './capture';
import { parseAdbDevices } from './devices';

const fixtures = path.resolve(__dirname, '../../../analyzer/fixtures');
const temp = mkdtempSync(path.join(tmpdir(), 'appflow-runtime-'));
const exe = (n: string) => (process.platform === 'win32' ? `${n}.exe` : n);

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** Fake device tooling: answers adb/emulator/flutter like a host with one running emulator. */
class FakeTools implements ProcessRunner {
  detachedCalls: string[][] = [];
  streams: Array<{ args: string[]; written: string[]; emit(line: string): void; exit(code: number): void }> = [];

  async run(_command: string, args: string[]) {
    const out = (s: string | Buffer) => ({ code: 0, stdout: Buffer.isBuffer(s) ? s : Buffer.from(s), stderr: '' });
    const a = args.join(' ');
    if (a === 'devices -l') return out('List of devices attached\nemulator-5554          device product:sdk model:sdk_gphone64 device:emu transport_id:1\n\n');
    if (a.endsWith('getprop ro.build.version.release')) return out('14\n');
    if (a.endsWith('getprop sys.boot_completed')) return out('1\n');
    if (a.endsWith('getprop ro.boot.qemu.avd_name')) return out('Pixel_6a\n');
    if (a === '-list-avds') return out('INFO    | Storing crashdata\nPixel_6a\nTablet_API_34\n');
    if (a.endsWith('exec-out screencap -p')) return out(png(1080, 2400));
    if (a.endsWith('wm density')) return out('Physical density: 420\n');
    if (a.endsWith('dumpsys activity activities')) return out('  mResumedActivity: ActivityRecord{1a2b u0 com.example.shoplite/.MainActivity t12}\n');
    if (a === '--version --machine') return out('Waiting...\n{"frameworkVersion":"3.38.9","channel":"stable"}');
    return { code: 1, stdout: Buffer.alloc(0), stderr: `unexpected: ${a}` };
  }

  stream(_command: string, args: string[]): StreamHandle {
    const lineCbs: Array<(l: string, s: 'stdout' | 'stderr') => void> = [];
    const exitCbs: Array<(c: number | null) => void> = [];
    const s = { args, written: [] as string[], emit: (l: string) => lineCbs.forEach((cb) => cb(l, 'stdout')), exit: (c: number) => exitCbs.forEach((cb) => cb(c)) };
    this.streams.push(s);
    return { write: (l) => void s.written.push(l), kill: () => undefined, onLine: (cb) => void lineCbs.push(cb), onExit: (cb) => void exitCbs.push(cb) };
  }

  detached(_command: string, args: string[]): void {
    this.detachedCalls.push(args);
  }
}

const tools = new FakeTools();
let agent: Agent;
let projectId: string;

beforeAll(async () => {
  const sdk = path.join(temp, 'sdk');
  mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
  mkdirSync(path.join(sdk, 'emulator'), { recursive: true });
  writeFileSync(path.join(sdk, 'platform-tools', exe('adb')), '');
  writeFileSync(path.join(sdk, 'emulator', exe('emulator')), '');
  const bin = path.join(temp, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, process.platform === 'win32' ? 'flutter.bat' : 'flutter'), '');
  agent = await startAgent({ processRunner: tools, dataDir: path.join(temp, 'data'), env: { ANDROID_HOME: sdk, PATH: bin, PATHEXT: '.BAT;.EXE' } });
  const api = (m: string, p: string, b?: unknown) => call(m, p, b);
  projectId = (await api('POST', '/v1/projects', { path: path.join(fixtures, 'flutter_shop') })).json.project.id;
  const started = (await api('POST', `/v1/projects/${projectId}/analyses`)).json.analysis;
  for (let i = 0; i < 200; i++) {
    if ((await api('GET', `/v1/analyses/${started.id}`)).json.analysis.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 25));
  }
});
afterAll(async () => {
  await agent.close();
  rmSync(temp, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(agent.url + p, { method, headers: { Authorization: `Bearer ${agent.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('helpers', () => {
  it('parses adb device lists and PNG sizes', () => {
    expect(parseAdbDevices('List of devices attached\nemulator-5554 device model:Pixel_6a\nR58M offline\n')).toEqual([
      { serial: 'emulator-5554', state: 'device', model: 'Pixel_6a' },
      { serial: 'R58M', state: 'offline', model: undefined },
    ]);
    expect(pngSize(png(1080, 2400))).toEqual({ width: 1080, height: 2400 });
  });

  it('finds the top-most known screen in a widget tree', () => {
    const tree = { description: 'MyApp', children: [{ widgetRuntimeType: 'HomeScreen', children: [{ description: 'PromoBanner' }] }, { widgetRuntimeType: 'CartScreen' }] };
    expect(findScreens(tree, new Set(['HomeScreen', 'CartScreen']))).toEqual({ detected: ['HomeScreen', 'CartScreen'], top: 'CartScreen' });
  });

  it('refuses shell-unsafe command arguments', () => {
    expect(() => assertSafeArgs(['run', '-d', 'emulator-5554'])).not.toThrow();
    for (const bad of ['dev; rm -rf /', 'a&b', '$(x)', 'x|y', 'a b']) expect(() => assertSafeArgs([bad])).toThrow();
  });
});

describe('host and devices', () => {
  it('reports the host and never offers iOS simulators off macOS', async () => {
    const { json } = await call('GET', '/v1/runtime/host');
    expect(json.host.iosSupported).toBe(process.platform === 'darwin');
    expect(json.host.adb).toMatch(/adb/);
  });

  it('lists running emulators and stopped AVDs', async () => {
    const { json } = await call('GET', '/v1/runtime/devices');
    expect(json.devices.map((d: { id: string; state: string }) => [d.id, d.state])).toEqual([
      ['emulator-5554', 'online'],
      ['avd:Tablet_API_34', 'stopped'],
    ]);
    expect(json.devices[0]).toMatchObject({ name: 'Pixel 6a', osVersion: 'Android 14', kind: 'emulator' });
  });

  it('boots an emulator only after confirmation', async () => {
    const ask = await call('POST', `/v1/runtime/devices/${encodeURIComponent('avd:Tablet_API_34')}/boot`, {});
    expect(ask.status).toBe(428);
    expect(tools.detachedCalls).toEqual([]);
    const ok = await call('POST', `/v1/runtime/devices/${encodeURIComponent('avd:Tablet_API_34')}/boot`, { confirmationToken: ask.json.error.details.confirmation.token });
    expect(ok.status).toBe(202);
    expect(tools.detachedCalls).toEqual([['-avd', 'Tablet_API_34']]);
  });
});

describe('build options', () => {
  it('detects targets, the Flutter toolchain and environment files the build will bundle', async () => {
    const { json } = await call('GET', `/v1/projects/${projectId}/runtime/options`);
    expect(json.options.targets).toEqual(['lib/main.dart']);
    expect(json.options.flavors).toEqual([]);
    expect(json.options.flutter).toMatchObject({ source: 'path', version: '3.38.9' });
    expect(json.options.sensitiveBuildInputs).toEqual(['.env']);
  });
});

describe('run session', () => {
  let sessionId: string;

  it('builds and launches only after confirmation, showing the exact command', async () => {
    const before = tools.streams.length;
    const ask = await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554' });
    expect(ask.status).toBe(428);
    const { confirmation } = ask.json.error.details;
    expect(confirmation.command.slice(1)).toEqual(['run', '--machine', '-d', 'emulator-5554', '--debug', '-t', 'lib/main.dart']);
    expect(confirmation.sensitiveBuildInputs).toEqual(['.env']);
    expect(tools.streams.length).toBe(before);

    // A token for a different command is rejected.
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554', mode: 'profile', confirmationToken: confirmation.token })).status).toBe(403);
    const again = (await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554' })).json.error.details.confirmation;
    const ok = await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554', confirmationToken: again.token });
    expect(ok.status).toBe(202);
    expect(ok.json.session.status).toBe('building');
    expect(ok.json.session.build).toMatchObject({ mode: 'debug', target: 'lib/main.dart', flutterVersion: '3.38.9' });
    sessionId = ok.json.session.id;
  });

  it('follows flutter run --machine events and keeps logs', async () => {
    const s = tools.streams.at(-1)!;
    s.emit('Launching lib/main.dart on sdk gphone64 in debug mode...');
    s.emit('[{"event":"app.start","params":{"appId":"app-1","deviceId":"emulator-5554"}}]');
    s.emit('[{"event":"app.progress","params":{"message":"Running Gradle task \'assembleDebug\'...","finished":false}}]');
    s.emit('[{"event":"app.debugPort","params":{"wsUri":"ws://127.0.0.1:9/abc=/ws"}}]');
    s.emit('[{"event":"app.started","params":{}}]');
    const { json } = await call('GET', `/v1/runtime/sessions/${sessionId}`);
    expect(json.session).toMatchObject({ status: 'running', vmServiceUri: 'ws://127.0.0.1:9/abc=/ws' });
    const logs = (await call('GET', `/v1/runtime/sessions/${sessionId}/logs?since=0`)).json.lines.map((l: { text: string }) => l.text);
    expect(logs).toEqual(expect.arrayContaining(['Launching lib/main.dart on sdk gphone64 in debug mode...', "Running Gradle task 'assembleDebug'...", '✔ App started']));
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554' })).status).toBe(409);
  });

  it('captures with device metadata; association is honest when detection is unavailable', async () => {
    const auto = await call('POST', `/v1/projects/${projectId}/captures`, { sessionId });
    expect(auto.status).toBe(201);
    expect(auto.json.capture).toMatchObject({
      screenId: null,
      association: { method: 'none' },
      width: 1080,
      height: 2400,
      pixelRatio: 2.625,
      device: { id: 'emulator-5554', name: 'Pixel 6a', platform: 'android', resolution: '1080x2400', density: 420 },
      build: { mode: 'debug' },
      navigation: { activity: 'com.example.shoplite/.MainActivity' },
    });
    const manual = await call('POST', `/v1/projects/${projectId}/captures`, { deviceId: 'emulator-5554', screenId: 'flutter:HomeScreen' });
    expect(manual.json.capture).toMatchObject({ screenId: 'flutter:HomeScreen', association: { method: 'manual' } });
    expect((await call('POST', `/v1/projects/${projectId}/captures`, { deviceId: 'emulator-5554', screenId: 'flutter:Nope' })).status).toBe(400);
  });

  it('lists, assigns, serves and deletes captures', async () => {
    const list = (await call('GET', `/v1/projects/${projectId}/captures`)).json;
    expect(list.captures).toHaveLength(2);
    const unassigned = list.captures.find((c: { screenId: string | null }) => c.screenId === null);
    const assigned = await call('POST', `/v1/projects/${projectId}/captures/${unassigned.id}/assign`, { screenId: 'flutter:CartScreen' });
    expect(assigned.json.capture).toMatchObject({ screenId: 'flutter:CartScreen', association: { method: 'manual' } });
    const image = await call('GET', `/v1/projects/${projectId}/captures/${unassigned.id}/image`);
    expect(image.json.dataUri).toMatch(/^data:image\/png;base64,/);
    expect((await call('DELETE', `/v1/projects/${projectId}/captures/${unassigned.id}`)).status).toBe(204);
    expect((await call('GET', `/v1/projects/${projectId}/captures`)).json.captures).toHaveLength(1);
  });

  it('stops the app through the machine protocol', async () => {
    const s = tools.streams.at(-1)!;
    const stopped = await call('POST', `/v1/runtime/sessions/${sessionId}/stop`);
    expect(stopped.json.session.status).toBe('stopped');
    expect(s.written).toEqual(['[{"id":1,"method":"app.stop","params":{"appId":"app-1"}}]']);
  });

  it('reports build failures with the failing lines, and allows a retry', async () => {
    const ask = (await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554' })).json.error.details.confirmation;
    const run = (await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554', confirmationToken: ask.token })).json.session;
    const s = tools.streams.at(-1)!;
    s.emit("FAILURE: Build failed with an exception.");
    s.emit("Execution failed for task ':app:mergeDebugAssets'.");
    s.exit(1);
    const { json } = await call('GET', `/v1/runtime/sessions/${run.id}`);
    expect(json.session.status).toBe('failed');
    expect(json.session.error).toContain("Execution failed for task ':app:mergeDebugAssets'.");
    // Retry = a new confirmed session (the failed one no longer blocks).
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554' })).status).toBe(428);
  });

  it('validates build choices against what the project defines', async () => {
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554', flavor: 'prod' })).status).toBe(400);
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'emulator-5554', target: '../../evil.dart' })).status).toBe(400);
    expect((await call('POST', `/v1/projects/${projectId}/runtime/sessions`, { deviceId: 'avd:Pixel_9' })).status).toBe(404);
  });
});
