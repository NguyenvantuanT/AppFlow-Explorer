import { randomBytes, randomUUID } from 'node:crypto';
import type { ProjectFs } from '@appflow/analyzer';
import type { BuildConfig, RuntimeCapture } from '@appflow/model';
import { ApiError } from '../errors';
import { detectBuildOptions, type BuildOptions } from './buildOptions';
import { captureScreen } from './capture';
import { bootDevice, listDevices, type Device } from './devices';
import type { ProcessRunner } from './exec';
import { findScreens, VmServiceClient, type DetectedScreens } from './inspector';
import { RunSession } from './session';
import { CaptureStore } from './store';
import { detectHost, resolveFlutter, type FlutterToolchain, type HostInfo } from './toolchain';

export interface ProjectRef {
  id: string;
  rootPath: string;
  fs: ProjectFs;
  /** Screens from the latest analysis (empty until one succeeded). */
  screens(): Array<{ id: string; widgetClass: string }>;
}

interface Consent {
  key: string;
  expiresAt: number;
}

const CONSENT_TTL_MS = 2 * 60 * 1000;
const AUTO_CAPTURE_INTERVAL_MS = 1500;

/**
 * Emulator orchestration, `flutter run` sessions and screenshot capture.
 *
 * Anything that executes project code (build + launch) or starts a device
 * requires a single-use confirmation token issued for that exact command.
 */
export class RuntimeService {
  private host: HostInfo;
  private readonly store: CaptureStore;
  private readonly sessions = new Map<string, RunSession>();
  private readonly vm = new Map<string, VmServiceClient>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastTop = new Map<string, { screenId?: string; seen: number }>();
  private readonly consents = new Map<string, Consent>();
  private toolchains = new Map<string, FlutterToolchain | null>();
  private deviceCache: Device[] = [];

  constructor(
    private readonly runner: ProcessRunner,
    dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.host = detectHost(env);
    this.store = new CaptureStore(dataDir);
  }

  // ---- Consent ----------------------------------------------------------------------------------

  private requireConsent(key: string, token: string | undefined, describe: () => Record<string, unknown>): void {
    if (!token) {
      const t = randomBytes(18).toString('base64url');
      this.consents.set(t, { key, expiresAt: Date.now() + CONSENT_TTL_MS });
      throw new ApiError('confirmation_required', 'This action runs tools on your machine and needs your explicit confirmation.', {
        confirmation: { token: t, expiresAt: new Date(Date.now() + CONSENT_TTL_MS).toISOString(), ...describe() },
      });
    }
    const c = this.consents.get(token);
    this.consents.delete(token);
    if (!c || c.key !== key || c.expiresAt < Date.now()) throw new ApiError('forbidden', 'The confirmation token is invalid, expired or was issued for a different action.');
  }

  // ---- Host, devices, build options ---------------------------------------------------------------

  hostInfo(): HostInfo {
    this.host = detectHost(this.env);
    return this.host;
  }

  async devices(): Promise<Device[]> {
    this.deviceCache = await listDevices(this.host, this.runner);
    return this.deviceCache;
  }

  private async device(id: string): Promise<Device> {
    const d = (await this.devices()).find((x) => x.id === id);
    if (!d) throw new ApiError('not_found', `No device "${id}".`);
    return d;
  }

  async boot(deviceId: string, token?: string): Promise<Device> {
    const d = await this.device(deviceId);
    if (d.state !== 'stopped') throw new ApiError('conflict', `${d.name} is already ${d.state}.`);
    this.requireConsent(`boot:${d.id}`, token, () => ({
      action: 'boot-device',
      description: `Start the ${d.platform === 'android' ? 'Android emulator' : 'iOS simulator'} "${d.name}".`,
      command: d.platform === 'android' ? [this.host.emulator ?? 'emulator', '-avd', d.avd ?? ''] : ['xcrun', 'simctl', 'boot', d.id],
    }));
    await bootDevice(d, this.host, this.runner);
    return { ...d, state: 'booting' };
  }

  async flutterFor(project: ProjectRef): Promise<FlutterToolchain | null> {
    if (!this.toolchains.has(project.id)) this.toolchains.set(project.id, await resolveFlutter(project.rootPath, this.runner, this.env));
    return this.toolchains.get(project.id)!;
  }

  async buildOptions(project: ProjectRef): Promise<BuildOptions & { flutter: FlutterToolchain | null }> {
    return { ...(await detectBuildOptions(project.fs)), flutter: await this.flutterFor(project) };
  }

  // ---- Sessions ---------------------------------------------------------------------------------

  async startSession(project: ProjectRef, req: { deviceId: string; mode?: BuildConfig['mode']; flavor?: string; target?: string; confirmationToken?: string }): Promise<RunSession> {
    const options = await this.buildOptions(project);
    if (!options.flutter) throw new ApiError('conflict', 'Flutter was not found: install Flutter (or FVM) and make sure it is on PATH.');
    const mode = req.mode ?? 'debug';
    if (!options.modes.includes(mode)) throw new ApiError('invalid_request', `Unknown build mode "${mode}".`);
    if (req.flavor && !options.flavors.includes(req.flavor)) throw new ApiError('invalid_request', `Unknown flavor "${req.flavor}". Detected: ${options.flavors.join(', ') || 'none'}.`);
    if (options.flavors.length && !req.flavor) throw new ApiError('invalid_request', `This project defines flavors (${options.flavors.join(', ')}); choose one.`);
    const target = req.target ?? options.defaultTarget;
    if (target && !options.targets.includes(target)) throw new ApiError('invalid_request', `Unknown target "${target}".`);
    const device = await this.device(req.deviceId);
    if (device.state !== 'online') throw new ApiError('conflict', `${device.name} is ${device.state}; start it and wait until it is online.`);
    for (const s of this.sessions.values()) {
      if (s.info.projectId === project.id && ['starting', 'building', 'installing', 'running'].includes(s.info.status)) {
        throw new ApiError('conflict', 'This project already has a running session; stop it first.');
      }
    }

    const build: BuildConfig = { mode, flavor: req.flavor, target };
    const session = new RunSession(project.id, device.id, build, options.flutter, project.rootPath);
    this.requireConsent(`run:${project.id}:${session.info.command.slice(1).join(' ')}`, req.confirmationToken, () => ({
      action: 'build-and-launch',
      description: `Build "${project.rootPath}" in ${mode} mode and launch it on ${device.name}. This runs the project's Gradle/Xcode build scripts and the app's own code.`,
      command: session.info.command,
      cwd: project.rootPath,
      flutter: { source: options.flutter!.source, version: options.flutter!.version, pinned: options.flutter!.pinnedVersion },
      warnings: [...options.flutter!.warnings, ...options.notes],
      sensitiveBuildInputs: options.sensitiveBuildInputs,
    }));
    this.sessions.set(session.info.id, session);
    session.onChange((s) => {
      if (s.info.status === 'running' && s.info.vmServiceUri && !this.vm.has(s.info.id)) this.vm.set(s.info.id, new VmServiceClient(s.info.vmServiceUri));
      if (s.info.status === 'failed' || s.info.status === 'stopped') this.stopAutoCapture(s.info.id);
    });
    session.start(this.runner);
    return session;
  }

  session(id: string): RunSession {
    const s = this.sessions.get(id);
    if (!s) throw new ApiError('not_found', 'Unknown session.');
    return s;
  }

  sessionsFor(projectId: string): RunSession[] {
    return [...this.sessions.values()].filter((s) => s.info.projectId === projectId);
  }

  stop(id: string): RunSession {
    const s = this.session(id);
    this.stopAutoCapture(id);
    s.stop();
    this.vm.get(id)?.close();
    this.vm.delete(id);
    return s;
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) this.stop(id);
  }

  // ---- Detection & capture -------------------------------------------------------------------------

  /** Which known screens are in the running app's widget tree (debug builds only). */
  async detect(project: ProjectRef, sessionId: string): Promise<DetectedScreens | null> {
    const client = this.vm.get(sessionId);
    if (!client) return null;
    const classes = new Set(project.screens().map((s) => s.widgetClass));
    try {
      const result = findScreens(await client.widgetTree(), classes);
      this.session(sessionId).info.currentScreen = result.top;
      return result;
    } catch (error) {
      this.session(sessionId).log('event', `Screen detection unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async capture(project: ProjectRef, req: { deviceId?: string; sessionId?: string; screenId?: string }): Promise<RuntimeCapture> {
    const session = req.sessionId ? this.session(req.sessionId) : undefined;
    const deviceId = req.deviceId ?? session?.info.deviceId;
    if (!deviceId) throw new ApiError('invalid_request', 'Choose a device or a running session to capture from.');
    const screens = project.screens();
    if (req.screenId && !screens.some((s) => s.id === req.screenId)) throw new ApiError('invalid_request', `Unknown screen "${req.screenId}".`);
    const device = await this.device(deviceId);
    let shot;
    try {
      shot = await captureScreen(device, this.host, this.runner);
    } catch (error) {
      throw new ApiError('conflict', error instanceof Error ? error.message : String(error));
    }
    const detected = session ? await this.detect(project, session.info.id) : null;
    const topScreen = detected?.top ? screens.find((s) => s.widgetClass === detected.top) : undefined;
    const capture: RuntimeCapture = {
      id: randomUUID(),
      projectId: project.id,
      sessionId: session?.info.id,
      screenId: req.screenId ?? topScreen?.id ?? null,
      association: req.screenId
        ? { method: 'manual', detail: 'Assigned when captured' }
        : topScreen
          ? { method: 'auto', detail: `${detected!.top} is on top of the live widget tree` }
          : { method: 'none', detail: detected ? 'No known screen found in the widget tree' : 'Screen detection needs a debug session started from AppFlow' },
      width: shot.width,
      height: shot.height,
      pixelRatio: shot.pixelRatio,
      device: shot.device,
      build: session?.info.build,
      capturedAt: new Date().toISOString(),
      navigation: { detectedScreens: detected?.detected ?? [], topScreen: detected?.top, activity: shot.activity },
    };
    await this.store.add(capture, shot.png);
    session?.log('event', `📷 Captured ${capture.screenId ?? 'unassigned screen'} (${shot.width}×${shot.height})`);
    return capture;
  }

  /** Polls the widget tree and captures each newly shown screen once it has been stable for one poll. */
  setAutoCapture(project: ProjectRef, sessionId: string, enabled: boolean): void {
    const session = this.session(sessionId);
    if (!enabled) return this.stopAutoCapture(sessionId);
    if (session.info.status !== 'running' || !this.vm.has(sessionId)) throw new ApiError('conflict', 'Auto-capture needs a running debug session started from AppFlow.');
    if (this.timers.has(sessionId)) return;
    session.info.autoCapture = true;
    session.log('event', 'Auto-capture on: navigate in the app; each new screen is captured once.');
    const captured = new Set<string>();
    let busy = false;
    this.timers.set(
      sessionId,
      setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const detected = await this.detect(project, sessionId);
          const top = detected?.top ? project.screens().find((s) => s.widgetClass === detected.top) : undefined;
          const last = this.lastTop.get(sessionId);
          if (!top) return;
          if (last?.screenId !== top.id) {
            if (last?.screenId) await this.store.observe(project.id, { id: randomUUID(), sessionId, fromScreenId: last.screenId, toScreenId: top.id, observedAt: new Date().toISOString() });
            this.lastTop.set(sessionId, { screenId: top.id, seen: 1 });
            return;
          }
          last.seen++;
          // Stable for one more poll (animations done) and not captured in this session yet.
          if (last.seen === 2 && !captured.has(top.id)) {
            captured.add(top.id);
            await this.capture(project, { sessionId });
          }
        } catch (error) {
          session.log('event', `Auto-capture error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          busy = false;
        }
      }, AUTO_CAPTURE_INTERVAL_MS),
    );
  }

  private stopAutoCapture(sessionId: string): void {
    const t = this.timers.get(sessionId);
    if (t) clearInterval(t);
    this.timers.delete(sessionId);
    const s = this.sessions.get(sessionId);
    if (s && s.info.autoCapture) {
      s.info.autoCapture = false;
      s.log('event', 'Auto-capture off.');
    }
  }

  // ---- Stored captures -----------------------------------------------------------------------------

  list(projectId: string) {
    return this.store.load(projectId);
  }

  async assign(project: ProjectRef, captureId: string, screenId: string | null): Promise<RuntimeCapture> {
    if (screenId && !project.screens().some((s) => s.id === screenId)) throw new ApiError('invalid_request', `Unknown screen "${screenId}".`);
    const c = await this.store.update(project.id, captureId, { screenId, association: screenId ? { method: 'manual', detail: 'Assigned by you' } : { method: 'none', detail: 'Unassigned by you' } });
    if (!c) throw new ApiError('not_found', 'Unknown capture.');
    return c;
  }

  async remove(projectId: string, captureId: string): Promise<void> {
    if (!(await this.store.remove(projectId, captureId))) throw new ApiError('not_found', 'Unknown capture.');
  }

  async image(projectId: string, captureId: string): Promise<Buffer> {
    const png = await this.store.image(projectId, captureId);
    if (!png) throw new ApiError('not_found', 'Unknown capture.');
    return png;
  }
}
