import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PlatformId } from '@appflow/model';
import { ApiError } from './errors';
import type { OperationInfo } from './schemas';

/** A project operation that runs project tooling and therefore needs the user's consent. */
export interface OperationDefinition {
  id: string;
  platform: PlatformId;
  description: string;
  command: string[];
  /** Directory relative to the detected platform root. */
  cwd: string;
}

export const OPERATION_CATALOG: OperationDefinition[] = [
  { id: 'flutter-pub-get', platform: 'flutter', description: 'Download Dart/Flutter dependencies (runs `flutter pub get`).', command: ['flutter', 'pub', 'get'], cwd: '' },
  { id: 'npm-install', platform: 'react-native', description: 'Install JavaScript dependencies; package install scripts may run (runs `npm install`).', command: ['npm', 'install'], cwd: '' },
  { id: 'gradle-assemble-debug', platform: 'android', description: 'Build the debug APK; Gradle build scripts will run (runs `./gradlew assembleDebug`).', command: [process.platform === 'win32' ? 'gradlew.bat' : './gradlew', 'assembleDebug'], cwd: '' },
  { id: 'pod-install', platform: 'ios', description: 'Install CocoaPods dependencies; Podfile Ruby code will run (runs `pod install`).', command: ['pod', 'install'], cwd: '' },
];

/** Runs a command. Injected so tests never execute anything. */
export type OperationRunner = (command: string[], cwd: string, onOutput: (chunk: string) => void) => Promise<number>;

/** Default runner: no shell (arguments are never interpreted), inherits only PATH-like environment. */
export const spawnRunner: OperationRunner = (command, cwd, onOutput) =>
  new Promise((resolve, reject) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd!, args, { cwd, shell: false, windowsHide: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot } });
    child.stdout.on('data', (d: Buffer) => onOutput(d.toString()));
    child.stderr.on('data', (d: Buffer) => onOutput(d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });

interface PendingConfirmation {
  token: string;
  projectId: string;
  operation: string;
  expiresAt: number;
}

const CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const OUTPUT_TAIL = 8000;

/**
 * Two-step consent for consequential operations: the first request returns a
 * single-use confirmation token describing exactly what would run; only a
 * second request carrying that token (after the user agreed) executes it.
 */
export class OperationGate {
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly runs = new Map<string, OperationInfo>();

  constructor(
    private readonly runner: OperationRunner,
    private readonly now: () => number = Date.now,
  ) {}

  available(platformRoots: Array<{ platform: PlatformId; root: string }>): Array<OperationDefinition & { root: string }> {
    return OPERATION_CATALOG.flatMap((op) => platformRoots.filter((p) => p.platform === op.platform).map((p) => ({ ...op, root: p.root })));
  }

  request(projectId: string, projectRoot: string, platformRoots: Array<{ platform: PlatformId; root: string }>, operation: string, confirmationToken?: string): OperationInfo {
    const def = this.available(platformRoots).find((o) => o.id === operation);
    if (!def) throw new ApiError('not_found', `Operation "${operation}" is not available for this project.`);
    const cwd = path.join(projectRoot, def.root, def.cwd);

    if (!confirmationToken) {
      const token = randomBytes(18).toString('base64url');
      this.pending.set(token, { token, projectId, operation, expiresAt: this.now() + CONFIRMATION_TTL_MS });
      throw new ApiError('confirmation_required', `Running "${def.id}" executes project tooling and needs your explicit confirmation.`, {
        confirmation: { token, operation: def.id, description: def.description, command: def.command, cwd, expiresAt: new Date(this.now() + CONFIRMATION_TTL_MS).toISOString() },
      });
    }
    const pending = this.pending.get(confirmationToken);
    this.pending.delete(confirmationToken); // single use, even when invalid for this request
    if (!pending || pending.projectId !== projectId || pending.operation !== operation || pending.expiresAt < this.now()) {
      throw new ApiError('forbidden', 'The confirmation token is invalid, expired or was issued for a different operation.');
    }

    const info: OperationInfo = { id: randomUUID(), projectId, operation, command: def.command, cwd, status: 'running', outputTail: '' };
    this.runs.set(info.id, info);
    this.runner(def.command, cwd, (chunk) => {
      info.outputTail = (info.outputTail + chunk).slice(-OUTPUT_TAIL);
    }).then(
      (code) => {
        info.exitCode = code;
        info.status = code === 0 ? 'succeeded' : 'failed';
      },
      (error: unknown) => {
        info.status = 'failed';
        info.outputTail += `\n${error instanceof Error ? error.message : String(error)}`;
      },
    );
    return info;
  }

  get(id: string): OperationInfo | undefined {
    return this.runs.get(id);
  }
}
