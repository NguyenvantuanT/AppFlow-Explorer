import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProcessRunner } from './exec';

export interface HostInfo {
  os: NodeJS.Platform;
  /** iOS simulators exist only on macOS hosts with Xcode. */
  iosSupported: boolean;
  androidSdk?: string;
  adb?: string;
  emulator?: string;
  xcrun?: string;
  problems: string[];
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/** Finds a command on PATH (first match), honoring PATHEXT on Windows. */
export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function detectHost(env: NodeJS.ProcessEnv = process.env): HostInfo {
  const problems: string[] = [];
  const defaults =
    process.platform === 'win32'
      ? [path.join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk')]
      : process.platform === 'darwin'
        ? [path.join(os.homedir(), 'Library', 'Android', 'sdk')]
        : [path.join(os.homedir(), 'Android', 'Sdk')];
  const androidSdk = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, ...defaults].find((p): p is string => !!p && existsSync(p));
  const adb = androidSdk && existsSync(path.join(androidSdk, 'platform-tools', exe('adb'))) ? path.join(androidSdk, 'platform-tools', exe('adb')) : which('adb', env);
  const emulator = androidSdk && existsSync(path.join(androidSdk, 'emulator', exe('emulator'))) ? path.join(androidSdk, 'emulator', exe('emulator')) : which('emulator', env);
  if (!androidSdk) problems.push('Android SDK not found (set ANDROID_HOME).');
  if (!adb) problems.push('adb not found (Android SDK platform-tools).');
  if (!emulator) problems.push('Android emulator not found (Android SDK "emulator" package).');
  const iosSupported = process.platform === 'darwin';
  const xcrun = iosSupported ? which('xcrun', env) : undefined;
  if (iosSupported && !xcrun) problems.push('xcrun not found: install Xcode to use iOS simulators.');
  return { os: process.platform, iosSupported, androidSdk, adb, emulator, xcrun, problems };
}

export interface FlutterToolchain {
  /** Executable to run. */
  command: string;
  /** Leading arguments (e.g. `flutter` when going through `fvm`). */
  prefixArgs: string[];
  /** How it was chosen, shown to the user. */
  source: 'fvm-project-sdk' | 'fvm' | 'path';
  version?: string;
  /** Version pinned by the project (`.fvmrc` / `.fvm/fvm_config.json`). */
  pinnedVersion?: string;
  warnings: string[];
}

async function pinnedFlutterVersion(root: string): Promise<string | undefined> {
  for (const file of ['.fvmrc', path.join('.fvm', 'fvm_config.json')]) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
      const v = json.flutter ?? json.flutterSdkVersion;
      if (typeof v === 'string') return v;
    } catch {
      // not present
    }
  }
  return undefined;
}

/**
 * Resolves the Flutter SDK the project is configured for: the project's own
 * FVM SDK link first, then `fvm flutter`, then `flutter` on PATH (with a
 * warning when that differs from a pinned version).
 */
export async function resolveFlutter(root: string, runner: ProcessRunner, env: NodeJS.ProcessEnv = process.env): Promise<FlutterToolchain | null> {
  const pinned = await pinnedFlutterVersion(root);
  const warnings: string[] = [];
  const projectSdk = path.join(root, '.fvm', 'flutter_sdk', 'bin', process.platform === 'win32' ? 'flutter.bat' : 'flutter');
  let tool: Omit<FlutterToolchain, 'warnings' | 'pinnedVersion' | 'version'> | null = null;
  if (existsSync(projectSdk)) tool = { command: projectSdk, prefixArgs: [], source: 'fvm-project-sdk' };
  else if (pinned && which('fvm', env)) tool = { command: which('fvm', env)!, prefixArgs: ['flutter'], source: 'fvm' };
  else if (which('flutter', env)) tool = { command: which('flutter', env)!, prefixArgs: [], source: 'path' };
  if (!tool) return null;

  const res = await runner.run(tool.command, [...tool.prefixArgs, '--version', '--machine'], { cwd: root, timeoutMs: 120_000 });
  let version: string | undefined;
  try {
    const text = res.stdout.toString();
    version = JSON.parse(text.slice(text.indexOf('{'))).frameworkVersion;
  } catch {
    warnings.push('Could not read the Flutter version.');
  }
  if (pinned && version && pinned !== version) warnings.push(`The project pins Flutter ${pinned} but ${version} will be used (${tool.source}).`);
  if (pinned && tool.source === 'path') warnings.push(`The project pins Flutter ${pinned} with FVM; install it with \`fvm install\` to build with the configured version.`);
  return { ...tool, version, pinnedVersion: pinned, warnings };
}
