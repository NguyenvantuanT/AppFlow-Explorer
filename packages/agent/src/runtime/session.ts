import { randomUUID } from 'node:crypto';
import type { BuildConfig } from '@appflow/model';
import type { ProcessRunner, StreamHandle } from './exec';
import type { FlutterToolchain } from './toolchain';

export type SessionStatus = 'starting' | 'building' | 'installing' | 'running' | 'failed' | 'stopped';

export interface LogLine {
  seq: number;
  at: string;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}

export interface SessionInfo {
  id: string;
  projectId: string;
  deviceId: string;
  build: BuildConfig;
  command: string[];
  cwd: string;
  status: SessionStatus;
  startedAt: string;
  finishedAt?: string;
  /** Last progress message from the Flutter tool. */
  phase?: string;
  error?: string;
  vmServiceUri?: string;
  /** Screen currently on top, when auto-detection is available. */
  currentScreen?: string;
  autoCapture: boolean;
}

const MAX_LOG_LINES = 3000;

/**
 * One `flutter run --machine` process. The machine protocol reports build
 * progress, the VM service URI and app logs as JSON events; everything else
 * the tool prints is kept as plain log lines.
 */
export class RunSession {
  readonly info: SessionInfo;
  private readonly logs: LogLine[] = [];
  private seq = 0;
  private handle: StreamHandle | null = null;
  private appId: string | null = null;
  private readonly listeners: Array<(s: RunSession) => void> = [];

  constructor(
    projectId: string,
    deviceId: string,
    build: BuildConfig,
    flutter: FlutterToolchain,
    cwd: string,
  ) {
    const args = ['run', '--machine', '-d', deviceId, `--${build.mode}`];
    if (build.flavor) args.push('--flavor', build.flavor);
    if (build.target) args.push('-t', build.target);
    this.info = {
      id: randomUUID(),
      projectId,
      deviceId,
      build: { ...build, flutterVersion: flutter.version, flutterCommand: [flutter.command, ...flutter.prefixArgs].join(' ') },
      command: [flutter.command, ...flutter.prefixArgs, ...args],
      cwd,
      status: 'starting',
      startedAt: new Date().toISOString(),
      autoCapture: false,
    };
  }

  onChange(cb: (s: RunSession) => void): void {
    this.listeners.push(cb);
  }

  private changed(): void {
    for (const l of this.listeners) l(this);
  }

  log(stream: LogLine['stream'], text: string): void {
    this.logs.push({ seq: ++this.seq, at: new Date().toISOString(), stream, text });
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
  }

  logsSince(seq: number): LogLine[] {
    return this.logs.filter((l) => l.seq > seq);
  }

  start(runner: ProcessRunner): void {
    const [command, ...args] = this.info.command;
    this.log('event', `$ ${this.info.command.join(' ')}`);
    try {
      this.handle = runner.stream(command!, args, { cwd: this.info.cwd });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }
    this.info.status = 'building';
    this.handle.onLine((line, stream) => this.onLine(line, stream));
    this.handle.onExit((code) => {
      if (this.info.status === 'stopped') return;
      if (this.info.status === 'running' && code === 0) this.info.status = 'stopped';
      else this.fail(`flutter run exited with code ${code}.${this.lastErrors()}`);
      this.info.finishedAt = new Date().toISOString();
      this.changed();
    });
  }

  private lastErrors(): string {
    const errs = this.logs.filter((l) => l.stream === 'stderr' || /error|exception|failed/i.test(l.text)).slice(-3).map((l) => l.text.trim());
    return errs.length ? ` ${errs.join(' | ')}` : '';
  }

  private fail(message: string): void {
    this.info.status = 'failed';
    this.info.error = message;
    this.info.finishedAt = new Date().toISOString();
    this.log('event', `✖ ${message}`);
    this.changed();
  }

  private onLine(line: string, stream: 'stdout' | 'stderr'): void {
    const trimmed = line.trim();
    if (stream === 'stdout' && trimmed.startsWith('[{') && trimmed.endsWith('}]')) {
      try {
        for (const msg of JSON.parse(trimmed) as Array<{ event?: string; params?: Record<string, unknown> }>) this.onEvent(msg);
        return;
      } catch {
        // not a machine message; keep as text
      }
    }
    if (trimmed) this.log(stream, line);
  }

  private onEvent(msg: { event?: string; params?: Record<string, unknown> }): void {
    const p = msg.params ?? {};
    switch (msg.event) {
      case 'app.start':
        this.appId = String(p.appId ?? '');
        break;
      case 'app.progress': {
        const message = String(p.message ?? '');
        if (message && !p.finished) {
          this.info.phase = message;
          if (/install/i.test(message)) this.info.status = 'installing';
          this.log('event', message);
        }
        break;
      }
      case 'app.debugPort':
        this.info.vmServiceUri = String(p.wsUri ?? '');
        break;
      case 'app.started':
        this.info.status = 'running';
        this.info.phase = 'App running';
        this.log('event', '✔ App started');
        break;
      case 'app.log':
        this.log(p.error ? 'stderr' : 'stdout', String(p.log ?? ''));
        return;
      case 'app.stop':
        if (p.error) this.fail(String(p.error));
        else this.info.status = 'stopped';
        break;
      case 'daemon.logMessage':
        this.log(p.level === 'error' ? 'stderr' : 'stdout', String(p.message ?? ''));
        return;
      default:
        return;
    }
    this.changed();
  }

  stop(): void {
    if (this.info.status === 'stopped' || this.info.status === 'failed') return;
    this.info.status = 'stopped';
    this.info.finishedAt = new Date().toISOString();
    this.log('event', 'Stopping…');
    if (this.handle && this.appId) this.handle.write(JSON.stringify([{ id: 1, method: 'app.stop', params: { appId: this.appId } }]));
    const handle = this.handle;
    setTimeout(() => handle?.kill(), 4000);
    this.changed();
  }
}
