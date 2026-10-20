import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface StreamHandle {
  /** Writes a line to the process's stdin. */
  write(line: string): void;
  kill(): void;
  onLine(cb: (line: string, stream: 'stdout' | 'stderr') => void): void;
  onExit(cb: (code: number | null) => void): void;
}

/** Process execution, injectable so tests never start real tools. */
export interface ProcessRunner {
  run(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;
  stream(command: string, args: string[], options: { cwd: string }): StreamHandle;
  /** Starts a process that outlives the request (e.g. an emulator). */
  detached(command: string, args: string[]): void;
}

/**
 * Arguments are validated instead of quoted: only tokens made of path- and
 * identifier-safe characters are accepted, so nothing can be interpreted by a
 * shell even where Windows forces one (`.bat` / `.cmd` launchers).
 */
const SAFE_ARG = /^[\w@%+=:,./\\-]+$/;

export function assertSafeArgs(args: string[]): void {
  for (const a of args) if (!SAFE_ARG.test(a)) throw new Error(`Refusing unsafe command argument: ${JSON.stringify(a)}`);
}

function launch(command: string, args: string[], cwd?: string): ChildProcess {
  assertSafeArgs(args);
  const isScript = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
  // Node refuses to spawn .bat files without a shell; the command path is quoted, the args were validated.
  return isScript
    ? spawn([`"${command}"`, ...args].join(' '), { cwd, shell: true, windowsHide: true, env: process.env })
    : spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
}

export const nodeRunner: ProcessRunner = {
  run: (command, args, options = {}) =>
    new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = launch(command, args, options.cwd);
      } catch (error) {
        resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(error) });
        return;
      }
      const out: Buffer[] = [];
      let err = '';
      const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000);
      child.stdout?.on('data', (d: Buffer) => out.push(d));
      child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout: Buffer.concat(out), stderr: err + String(e) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
      });
    }),

  stream: (command, args, options) => {
    const child = launch(command, args, options.cwd);
    const lineHandlers: Array<(line: string, stream: 'stdout' | 'stderr') => void> = [];
    const exitHandlers: Array<(code: number | null) => void> = [];
    for (const stream of ['stdout', 'stderr'] as const) {
      let buf = '';
      child[stream]?.on('data', (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) for (const h of lineHandlers) h(l, stream);
      });
    }
    child.on('error', (e) => {
      for (const h of lineHandlers) h(String(e), 'stderr');
      for (const h of exitHandlers) h(-1);
    });
    child.on('close', (code) => {
      for (const h of exitHandlers) h(code);
    });
    return {
      write: (line) => child.stdin?.write(`${line}\n`),
      kill: () => {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill();
      },
      onLine: (cb) => void lineHandlers.push(cb),
      onExit: (cb) => void exitHandlers.push(cb),
    };
  },

  detached: (command, args) => {
    assertSafeArgs(args);
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
  },
};
