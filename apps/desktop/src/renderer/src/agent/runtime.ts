import type { BuildConfig, RuntimeCapture, RuntimeObservation } from '@appflow/model';
import { AgentError } from './client';

/** Mirrors packages/agent/src/runtime types. */
export interface HostInfo {
  os: string;
  iosSupported: boolean;
  androidSdk?: string;
  adb?: string;
  emulator?: string;
  xcrun?: string;
  problems: string[];
}

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'ios';
  kind: 'emulator' | 'simulator' | 'physical';
  state: 'online' | 'stopped' | 'booting' | 'offline' | 'unauthorized';
  osVersion?: string;
}

export interface BuildOptions {
  modes: Array<BuildConfig['mode']>;
  flavors: string[];
  targets: string[];
  defaultTarget?: string;
  sensitiveBuildInputs: string[];
  notes: string[];
  flutter: { command: string; source: string; version?: string; pinnedVersion?: string; warnings: string[] } | null;
}

export type SessionStatus = 'starting' | 'building' | 'installing' | 'running' | 'failed' | 'stopped';

export interface SessionInfo {
  id: string;
  projectId: string;
  deviceId: string;
  build: BuildConfig;
  command: string[];
  status: SessionStatus;
  startedAt: string;
  finishedAt?: string;
  phase?: string;
  error?: string;
  vmServiceUri?: string;
  currentScreen?: string;
  autoCapture: boolean;
}

export interface LogLine {
  seq: number;
  at: string;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}

/** Details returned with `428 confirmation_required`. */
export interface Confirmation {
  token: string;
  action: string;
  description: string;
  command: string[];
  cwd?: string;
  warnings?: string[];
  sensitiveBuildInputs?: string[];
  flutter?: { source: string; version?: string; pinned?: string };
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const bridge = window.appflow;
  if (!bridge) throw new AgentError(0, 'agent_unavailable', 'Running apps requires the desktop app.');
  const res = await bridge.agent.request(method, path, body);
  if (res.status >= 400) {
    const err = (res.body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new AgentError(res.status, err?.code ?? 'error', err?.message ?? `Agent request failed (${res.status}).`, err?.details);
  }
  return res.body as T;
}

export const runtimeApi = {
  host: async () => (await call<{ host: HostInfo }>('GET', '/v1/runtime/host')).host,
  devices: async () => (await call<{ devices: Device[] }>('GET', '/v1/runtime/devices')).devices,
  boot: async (deviceId: string, confirmationToken?: string) =>
    (await call<{ device: Device }>('POST', `/v1/runtime/devices/${encodeURIComponent(deviceId)}/boot`, { confirmationToken })).device,
  options: async (projectId: string) => (await call<{ options: BuildOptions }>('GET', `/v1/projects/${projectId}/runtime/options`)).options,
  sessions: async (projectId: string) => (await call<{ sessions: SessionInfo[] }>('GET', `/v1/projects/${projectId}/runtime/sessions`)).sessions,
  startSession: async (projectId: string, req: { deviceId: string; mode: BuildConfig['mode']; flavor?: string; target?: string; confirmationToken?: string }) =>
    (await call<{ session: SessionInfo }>('POST', `/v1/projects/${projectId}/runtime/sessions`, req)).session,
  session: async (id: string) => (await call<{ session: SessionInfo }>('GET', `/v1/runtime/sessions/${id}`)).session,
  logs: async (id: string, since: number) => (await call<{ lines: LogLine[] }>('GET', `/v1/runtime/sessions/${id}/logs?since=${since}`)).lines,
  stop: async (id: string) => (await call<{ session: SessionInfo }>('POST', `/v1/runtime/sessions/${id}/stop`)).session,
  autoCapture: async (id: string, enabled: boolean) => (await call<{ session: SessionInfo }>('POST', `/v1/runtime/sessions/${id}/auto-capture`, { enabled })).session,
  captures: async (projectId: string) => call<{ captures: RuntimeCapture[]; observations: RuntimeObservation[] }>('GET', `/v1/projects/${projectId}/captures`),
  capture: async (projectId: string, req: { sessionId?: string; deviceId?: string; screenId?: string }) =>
    (await call<{ capture: RuntimeCapture }>('POST', `/v1/projects/${projectId}/captures`, req)).capture,
  assign: async (projectId: string, captureId: string, screenId: string | null) =>
    (await call<{ capture: RuntimeCapture }>('POST', `/v1/projects/${projectId}/captures/${captureId}/assign`, { screenId })).capture,
  remove: async (projectId: string, captureId: string) => call<null>('DELETE', `/v1/projects/${projectId}/captures/${captureId}`),
  image: async (projectId: string, captureId: string) => (await call<{ dataUri: string }>('GET', `/v1/projects/${projectId}/captures/${captureId}/image`)).dataUri,
};

export type RuntimeApi = typeof runtimeApi;
