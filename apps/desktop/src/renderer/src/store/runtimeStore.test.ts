import type { RuntimeCapture } from '@appflow/model';
import { describe, expect, it, vi } from 'vitest';
import { AgentError } from '../agent/client';
import type { RuntimeApi, SessionInfo } from '../agent/runtime';
import { createRuntimeStore } from './runtimeStore';

const session = (status: SessionInfo['status']): SessionInfo => ({
  id: 's1',
  projectId: 'p1',
  deviceId: 'emulator-5554',
  build: { mode: 'debug', flavor: 'development', target: 'lib/main.dart' },
  command: ['flutter', 'run'],
  status,
  startedAt: '2026-10-20T10:00:00Z',
  autoCapture: false,
});

const capture: RuntimeCapture = {
  id: 'c1',
  projectId: 'p1',
  screenId: 'flutter:LoginPage',
  association: { method: 'auto' },
  width: 1080,
  height: 2400,
  device: { id: 'emulator-5554', name: 'Pixel 6a', platform: 'android' },
  capturedAt: '2026-10-20T10:01:00Z',
  navigation: { detectedScreens: ['LoginPage'], topScreen: 'LoginPage' },
};

function fakeApi(overrides: Partial<RuntimeApi> = {}): RuntimeApi {
  return {
    host: vi.fn(async () => ({ os: 'win32', iosSupported: false, problems: [] })),
    devices: vi.fn(async () => [{ id: 'emulator-5554', name: 'Pixel 6a', platform: 'android' as const, kind: 'emulator' as const, state: 'online' as const }]),
    boot: vi.fn(),
    options: vi.fn(async () => ({ modes: ['debug' as const], flavors: ['development', 'production'], targets: ['lib/main.dart'], defaultTarget: 'lib/main.dart', sensitiveBuildInputs: [], notes: [], flutter: { command: 'flutter', source: 'path', version: '3.38.9', warnings: [] } })),
    sessions: vi.fn(async () => []),
    startSession: vi.fn(async (_p, req) => {
      if (!req.confirmationToken) throw new AgentError(428, 'confirmation_required', 'confirm', { confirmation: { token: 't1', action: 'build-and-launch', description: 'Build', command: ['flutter', 'run'] } });
      return session('building');
    }),
    session: vi.fn(async () => session('running')),
    logs: vi.fn(async () => [{ seq: 1, at: '', stream: 'event' as const, text: '✔ App started' }]),
    stop: vi.fn(async () => session('stopped')),
    autoCapture: vi.fn(),
    captures: vi.fn(async () => ({ captures: [capture], observations: [] })),
    capture: vi.fn(async () => capture),
    assign: vi.fn(),
    remove: vi.fn(),
    image: vi.fn(async () => 'data:image/png;base64,AAAA'),
    ...overrides,
  } as RuntimeApi;
}

describe('runtime store', () => {
  it('opens with defaults: the online device, the first flavor and the default target', async () => {
    const onCaptures = vi.fn();
    const store = createRuntimeStore({ api: fakeApi(), onCaptures });
    await store.getState().open('p1');
    expect(store.getState()).toMatchObject({ deviceId: 'emulator-5554', flavor: 'development', target: 'lib/main.dart' });
    expect(onCaptures).toHaveBeenCalledWith([capture], [], { c1: 'data:image/png;base64,AAAA' });
  });

  it('asks for confirmation before building, and builds only after it', async () => {
    const api = fakeApi();
    const store = createRuntimeStore({ api, onCaptures: vi.fn() });
    await store.getState().open('p1');
    await store.getState().run();
    expect(store.getState().pending?.confirmation.command).toEqual(['flutter', 'run']);
    expect(store.getState().session).toBeNull();
    await store.getState().pending!.confirm();
    expect(api.startSession).toHaveBeenLastCalledWith('p1', { deviceId: 'emulator-5554', mode: 'debug', flavor: 'development', target: 'lib/main.dart', confirmationToken: 't1' });
    expect(store.getState().session?.status).toBe('building');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const api = fakeApi();
    const store = createRuntimeStore({ api, onCaptures: vi.fn() });
    await store.getState().open('p1');
    await store.getState().run();
    store.getState().cancelConfirmation();
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(store.getState().pending).toBeNull();
  });

  it('polls status and appends logs', async () => {
    const store = createRuntimeStore({ api: fakeApi(), onCaptures: vi.fn() });
    await store.getState().open('p1');
    store.setState({ session: session('building') });
    await store.getState().poll();
    expect(store.getState().session?.status).toBe('running');
    expect(store.getState().logs.map((l) => l.text)).toEqual(['✔ App started']);
  });

  it('surfaces capture failures without losing state', async () => {
    const store = createRuntimeStore({ api: fakeApi({ capture: vi.fn(async () => Promise.reject(new Error('Pixel 6a is not online (offline).'))) }), onCaptures: vi.fn() });
    await store.getState().open('p1');
    await store.getState().capture();
    expect(store.getState().error).toBe('Pixel 6a is not online (offline).');
    expect(store.getState().captures).toHaveLength(1);
  });
});
