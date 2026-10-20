import type { BuildConfig, RuntimeCapture, RuntimeObservation } from '@appflow/model';
import { create } from 'zustand';
import { AgentError } from '../agent/client';
import { type BuildOptions, type Confirmation, type Device, type HostInfo, type LogLine, type RuntimeApi, type SessionInfo } from '../agent/runtime';

const ACTIVE: Array<SessionInfo['status']> = ['starting', 'building', 'installing', 'running'];
const MAX_LOGS = 1500;

export interface PendingConfirmation {
  title: string;
  confirmation: Confirmation;
  confirm(): Promise<void>;
}

interface RuntimeState {
  projectId: string | null;
  host: HostInfo | null;
  devices: Device[];
  options: BuildOptions | null;
  session: SessionInfo | null;
  logs: LogLine[];
  captures: RuntimeCapture[];
  observations: RuntimeObservation[];
  images: Record<string, string>;
  deviceId: string | null;
  mode: BuildConfig['mode'];
  flavor: string | null;
  target: string | null;
  busy: string | null;
  error: string | null;
  pending: PendingConfirmation | null;

  /** Loads host, devices, build options, sessions and captures for a project. */
  open(projectId: string): Promise<void>;
  refreshDevices(): Promise<void>;
  setChoice(choice: Partial<Pick<RuntimeState, 'deviceId' | 'mode' | 'flavor' | 'target'>>): void;
  boot(deviceId: string): Promise<void>;
  run(): Promise<void>;
  stop(): Promise<void>;
  poll(): Promise<void>;
  capture(screenId?: string): Promise<void>;
  setAutoCapture(enabled: boolean): Promise<void>;
  assign(captureId: string, screenId: string | null): Promise<void>;
  remove(captureId: string): Promise<void>;
  loadImage(captureId: string): Promise<void>;
  cancelConfirmation(): void;
  clearError(): void;
}

export interface RuntimeDeps {
  api: RuntimeApi;
  /** Called whenever captures change, to update the canvas. */
  onCaptures(captures: RuntimeCapture[], observations: RuntimeObservation[], images: Record<string, string>): void;
}

export const isActive = (s: SessionInfo | null) => !!s && ACTIVE.includes(s.status);

export function createRuntimeStore(deps: RuntimeDeps) {
  const { api } = deps;
  return create<RuntimeState>()((set, get) => {
    const fail = (error: unknown) => set({ error: error instanceof Error ? error.message : String(error), busy: null });

    /**
     * Runs an action that may need consent: a `428` response becomes a
     * confirmation dialog, and confirming repeats the action with the token.
     */
    async function withConsent(title: string, action: (token?: string) => Promise<void>): Promise<void> {
      try {
        await action();
      } catch (error) {
        if (error instanceof AgentError && error.code === 'confirmation_required') {
          const confirmation = (error.details as { confirmation: Confirmation }).confirmation;
          set({
            busy: null,
            pending: {
              title,
              confirmation,
              confirm: async () => {
                set({ pending: null });
                try {
                  await action(confirmation.token);
                } catch (e) {
                  fail(e);
                }
              },
            },
          });
          return;
        }
        fail(error);
      }
    }

    async function syncCaptures(): Promise<void> {
      const projectId = get().projectId;
      if (!projectId) return;
      const { captures, observations } = await api.captures(projectId);
      set({ captures, observations });
      // Images for the canvas: the latest capture of each screen.
      const latest = new Map<string, RuntimeCapture>();
      for (const c of captures) if (c.screenId && (!latest.has(c.screenId) || latest.get(c.screenId)!.capturedAt < c.capturedAt)) latest.set(c.screenId, c);
      await Promise.all([...latest.values()].map((c) => get().loadImage(c.id)));
      deps.onCaptures(captures, observations, get().images);
    }

    return {
      projectId: null,
      host: null,
      devices: [],
      options: null,
      session: null,
      logs: [],
      captures: [],
      observations: [],
      images: {},
      deviceId: null,
      mode: 'debug',
      flavor: null,
      target: null,
      busy: null,
      error: null,
      pending: null,

      async open(projectId) {
        if (get().projectId !== projectId) set({ projectId, session: null, logs: [], captures: [], observations: [], images: {}, options: null });
        set({ busy: 'Checking devices and toolchain…', error: null });
        try {
          const [host, devices, options, sessions] = await Promise.all([api.host(), api.devices(), api.options(projectId), api.sessions(projectId)]);
          const session = sessions.find((s) => ACTIVE.includes(s.status)) ?? sessions.at(-1) ?? null;
          set((s) => ({
            host,
            devices,
            options,
            session,
            deviceId: s.deviceId ?? devices.find((d) => d.state === 'online')?.id ?? null,
            flavor: s.flavor ?? options.flavors[0] ?? null,
            target: s.target ?? options.defaultTarget ?? null,
            busy: null,
          }));
          if (session) {
            const logs = await api.logs(session.id, 0);
            set({ logs: logs.slice(-MAX_LOGS) });
          }
          await syncCaptures();
        } catch (error) {
          fail(error);
        }
      },

      async refreshDevices() {
        try {
          set({ devices: await api.devices() });
        } catch (error) {
          fail(error);
        }
      },

      setChoice(choice) {
        set(choice);
      },

      async boot(deviceId) {
        const device = get().devices.find((d) => d.id === deviceId);
        await withConsent(`Start ${device?.name ?? 'device'}?`, async (token) => {
          set({ busy: 'Starting device…' });
          await api.boot(deviceId, token);
          set({ busy: null });
          // Emulators take a while; refresh the list a few times.
          for (const delay of [3000, 8000, 15000, 30000]) setTimeout(() => void get().refreshDevices(), delay);
        });
      },

      async run() {
        const { projectId, deviceId, mode, flavor, target } = get();
        if (!projectId || !deviceId) return;
        await withConsent('Build and launch the app?', async (token) => {
          set({ busy: 'Starting build…', error: null });
          const session = await api.startSession(projectId, { deviceId, mode, flavor: flavor ?? undefined, target: target ?? undefined, confirmationToken: token });
          set({ session, logs: [], busy: null });
        });
      },

      async stop() {
        const session = get().session;
        if (!session) return;
        try {
          set({ session: await api.stop(session.id) });
        } catch (error) {
          fail(error);
        }
      },

      async poll() {
        const session = get().session;
        if (!session) return;
        try {
          const [info, lines] = await Promise.all([api.session(session.id), api.logs(session.id, get().logs.at(-1)?.seq ?? 0)]);
          set((s) => ({ session: info, logs: lines.length ? [...s.logs, ...lines].slice(-MAX_LOGS) : s.logs }));
          if (info.autoCapture) await syncCaptures();
        } catch (error) {
          fail(error);
        }
      },

      async capture(screenId) {
        const { projectId, session, deviceId } = get();
        if (!projectId) return;
        set({ busy: 'Capturing…', error: null });
        try {
          const useSession = session && session.status === 'running' ? session.id : undefined;
          await api.capture(projectId, { sessionId: useSession, deviceId: useSession ? undefined : (deviceId ?? undefined), screenId });
          await syncCaptures();
          set({ busy: null });
        } catch (error) {
          fail(error);
        }
      },

      async setAutoCapture(enabled) {
        const session = get().session;
        if (!session) return;
        try {
          set({ session: await api.autoCapture(session.id, enabled) });
        } catch (error) {
          fail(error);
        }
      },

      async assign(captureId, screenId) {
        const projectId = get().projectId;
        if (!projectId) return;
        try {
          await api.assign(projectId, captureId, screenId);
          await syncCaptures();
        } catch (error) {
          fail(error);
        }
      },

      async remove(captureId) {
        const projectId = get().projectId;
        if (!projectId) return;
        try {
          await api.remove(projectId, captureId);
          set((s) => {
            const images = { ...s.images };
            delete images[captureId];
            return { images };
          });
          await syncCaptures();
        } catch (error) {
          fail(error);
        }
      },

      async loadImage(captureId) {
        const projectId = get().projectId;
        if (!projectId || get().images[captureId]) return;
        try {
          const uri = await api.image(projectId, captureId);
          set((s) => ({ images: { ...s.images, [captureId]: uri } }));
        } catch {
          // shown as a missing thumbnail
        }
      },

      cancelConfirmation() {
        set({ pending: null });
      },

      clearError() {
        set({ error: null });
      },
    };
  });
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
