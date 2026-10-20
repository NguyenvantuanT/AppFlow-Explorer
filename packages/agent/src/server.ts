import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AccessDeniedError, defaultAdapters, languageOf, ProjectFs, type AnalysisAdapter, type DetectionMatch } from '@appflow/analyzer';
import type { PlatformId } from '@appflow/model';
import type { ZodType } from 'zod';
import { ApiError } from './errors';
import { JobManager } from './jobs';
import { OperationGate, spawnRunner, type OperationRunner } from './operations';
import { nodeRunner, type ProcessRunner } from './runtime/exec';
import { RuntimeService, type ProjectRef } from './runtime/service';
import {
  AssignCaptureRequest,
  AutoCaptureRequest,
  BootDeviceRequest,
  CaptureRequest,
  FileContentQuery,
  RegisterProjectRequest,
  RunOperationRequest,
  StartAnalysisRequest,
  StartSessionRequest,
  type ProjectInfo,
} from './schemas';

export interface AgentOptions {
  /** Loopback address to bind; anything else is refused. */
  host?: '127.0.0.1' | 'localhost' | '::1';
  /** 0 picks a free port. */
  port?: number;
  /** Bearer token; generated when omitted. */
  token?: string;
  adapters?: AnalysisAdapter[];
  /** Browser origins allowed to call the API (CORS). The desktop app needs none: it calls from the main process. */
  allowedOrigins?: string[];
  /** Executes confirmed operations; tests inject a fake. */
  runner?: OperationRunner;
  version?: string;
  /** Where captures are stored (default `~/.appflow`). */
  dataDir?: string;
  /** Runs device and Flutter tools; tests inject a fake. */
  processRunner?: ProcessRunner;
  /** Environment used to locate the Android SDK, Flutter and Xcode tools. */
  env?: NodeJS.ProcessEnv;
}

export interface Agent {
  url: string;
  port: number;
  token: string;
  server: http.Server;
  close(): Promise<void>;
}

interface RegisteredProject {
  info: ProjectInfo;
  fs: ProjectFs;
  platformRoots: Array<{ platform: PlatformId; root: string }>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

type Handler = (ctx: { req: http.IncomingMessage; params: string[]; body: unknown; query: URLSearchParams }) => Promise<{ status?: number; body: unknown }>;

/** Starts the local agent HTTP API on a loopback interface. */
export async function startAgent(options: AgentOptions = {}): Promise<Agent> {
  const host = options.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) throw new Error(`The agent only binds to loopback addresses (got ${host}).`);
  const token = options.token ?? randomBytes(24).toString('base64url');
  const adapters = options.adapters ?? defaultAdapters;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const jobs = new JobManager(adapters);
  const gate = new OperationGate(options.runner ?? spawnRunner);
  const projects = new Map<string, RegisteredProject>();
  let port = 0;

  const project = (id: string): RegisteredProject => {
    const p = projects.get(id);
    if (!p) throw new ApiError('not_found', `No registered project with id "${id}".`);
    return p;
  };
  const runtime = new RuntimeService(options.processRunner ?? nodeRunner, options.dataDir ?? path.join(os.homedir(), '.appflow'), options.env ?? process.env);
  const projectRef = (id: string): ProjectRef => {
    const p = project(id);
    return {
      id: p.info.id,
      rootPath: p.info.rootPath,
      fs: p.fs,
      screens: () => (jobs.latestResult(p.info.id)?.screens ?? []).map((s) => ({ id: s.id, widgetClass: s.widgetClass })),
    };
  };
  const parse = <T>(schema: ZodType<T>, value: unknown): T => {
    const r = schema.safeParse(value);
    if (!r.success) throw new ApiError('invalid_request', 'Request validation failed.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return r.data;
  };

  const routes: Array<[string, RegExp, Handler, { public?: boolean }?]> = [
    ['GET', /^\/v1\/health$/, async () => ({ body: { status: 'ok', version: options.version ?? '0.1.0' } }), { public: true }],

    ['GET', /^\/v1\/adapters$/, async () => ({
      body: { adapters: adapters.map((a) => ({ id: a.id, name: a.name, platform: a.platform, capabilities: a.capabilities, limitations: a.limitations })) },
    })],

    ['POST', /^\/v1\/projects$/, async ({ body }) => {
      const { path: requested } = parse(RegisterProjectRequest, body);
      if (!path.isAbsolute(requested)) throw new ApiError('invalid_request', 'Project path must be absolute.');
      let real: string;
      try {
        real = await fsp.realpath(requested);
        if (!(await fsp.stat(real)).isDirectory()) throw new Error('not a directory');
      } catch {
        throw new ApiError('invalid_request', 'Project path does not exist or is not a directory.');
      }
      if (path.parse(real).root === real || real === os.homedir()) {
        throw new ApiError('forbidden', 'Select a project folder, not a whole drive or your home directory.');
      }
      const id = createHash('sha256').update(real).digest('hex').slice(0, 16);
      const existing = projects.get(id);
      if (existing) return { status: 200, body: { project: existing.info } };

      const fs = await ProjectFs.open(real);
      const scan = await fs.scan();
      const readText = async (p: string) => {
        try {
          return await fs.readText(p);
        } catch {
          return null;
        }
      };
      const matches: DetectionMatch[] = [];
      for (const a of adapters) matches.push(...(await a.detect({ files: scan.files, fs, readText }).catch(() => [])));
      const info: ProjectInfo = {
        id,
        name: path.basename(real),
        rootPath: real,
        registeredAt: new Date().toISOString(),
        frameworks: matches.map((m) => ({ id: m.framework.id, name: m.framework.name, version: m.framework.version, root: m.root })),
      };
      projects.set(id, { info, fs, platformRoots: matches.map((m) => ({ platform: m.platform, root: m.root })) });
      return { status: 201, body: { project: info } };
    }],

    ['GET', /^\/v1\/projects$/, async () => ({ body: { projects: [...projects.values()].map((p) => p.info) } })],
    ['GET', /^\/v1\/projects\/([\w-]+)$/, async ({ params }) => ({ body: { project: project(params[0]!).info } })],
    ['DELETE', /^\/v1\/projects\/([\w-]+)$/, async ({ params }) => {
      project(params[0]!);
      jobs.cancelProject(params[0]!);
      projects.delete(params[0]!);
      return { status: 204, body: null };
    }],

    ['POST', /^\/v1\/projects\/([\w-]+)\/analyses$/, async ({ params, body }) => {
      const p = project(params[0]!);
      const req = parse(StartAnalysisRequest, body ?? {});
      return { status: 202, body: { analysis: jobs.start(p.info.id, p.info.rootPath, req.adapters) } };
    }],
    ['GET', /^\/v1\/analyses\/([\w-]+)$/, async ({ params }) => {
      const job = jobs.get(params[0]!);
      if (!job) throw new ApiError('not_found', 'Unknown analysis.');
      return { body: { analysis: job.info } };
    }],
    ['POST', /^\/v1\/analyses\/([\w-]+)\/cancel$/, async ({ params }) => {
      const info = jobs.cancel(params[0]!);
      if (!info) throw new ApiError('not_found', 'Unknown analysis.');
      return { status: 202, body: { analysis: info } };
    }],
    ['GET', /^\/v1\/analyses\/([\w-]+)\/result$/, async ({ params }) => {
      const job = jobs.get(params[0]!);
      if (!job) throw new ApiError('not_found', 'Unknown analysis.');
      if (job.info.status !== 'succeeded' || !job.result) throw new ApiError('conflict', `Analysis is ${job.info.status}; no result is available.`);
      return { body: { project: job.result } };
    }],
    ['GET', /^\/v1\/analyses\/([\w-]+)\/warnings$/, async ({ params }) => {
      const job = jobs.get(params[0]!);
      if (!job) throw new ApiError('not_found', 'Unknown analysis.');
      if (!job.result) throw new ApiError('conflict', `Analysis is ${job.info.status}; no warnings are available yet.`);
      return { body: { warnings: job.result.warnings ?? [] } };
    }],

    ['GET', /^\/v1\/projects\/([\w-]+)\/files\/content$/, async ({ params, query }) => {
      const p = project(params[0]!);
      const { path: rel } = parse(FileContentQuery, { path: query.get('path') ?? undefined });
      let content: string;
      try {
        const normalized = p.fs.relative(rel);
        const abs = await p.fs.resolve(normalized);
        const stat = await fsp.stat(abs);
        if (stat.size > MAX_FILE_BYTES) throw new ApiError('payload_too_large', 'File is too large to preview.');
        content = await p.fs.readText(normalized);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof AccessDeniedError) throw new ApiError('forbidden', error.message);
        throw new ApiError('not_found', 'File not found.');
      }
      if (languageOf(rel) === 'image' || content.includes('\0') || content.includes('�')) {
        throw new ApiError('unsupported_media_type', 'Binary files cannot be previewed.');
      }
      return { body: { path: p.fs.relative(rel), language: languageOf(rel), content } };
    }],

    ['GET', /^\/v1\/projects\/([\w-]+)\/operations$/, async ({ params }) => {
      const p = project(params[0]!);
      return { body: { operations: gate.available(p.platformRoots).map(({ id, description, command, root }) => ({ id, description, command, cwd: root })) } };
    }],
    ['POST', /^\/v1\/projects\/([\w-]+)\/operations$/, async ({ params, body }) => {
      const p = project(params[0]!);
      const req = parse(RunOperationRequest, body);
      return { status: 202, body: { operation: gate.request(p.info.id, p.info.rootPath, p.platformRoots, req.operation, req.confirmationToken) } };
    }],
    ['GET', /^\/v1\/operations\/([\w-]+)$/, async ({ params }) => {
      const info = gate.get(params[0]!);
      if (!info) throw new ApiError('not_found', 'Unknown operation.');
      return { body: { operation: info } };
    }],

    // ---- Runtime capture (Phase 3) ---------------------------------------------------------------
    ['GET', /^\/v1\/runtime\/host$/, async () => ({ body: { host: runtime.hostInfo() } })],
    ['GET', /^\/v1\/runtime\/devices$/, async () => ({ body: { devices: await runtime.devices() } })],
    ['POST', /^\/v1\/runtime\/devices\/([\w:.%-]+)\/boot$/, async ({ params, body }) => {
      const req = parse(BootDeviceRequest, body ?? {});
      return { status: 202, body: { device: await runtime.boot(decodeURIComponent(params[0]!), req.confirmationToken) } };
    }],
    ['GET', /^\/v1\/projects\/([\w-]+)\/runtime\/options$/, async ({ params }) => ({ body: { options: await runtime.buildOptions(projectRef(params[0]!)) } })],
    ['GET', /^\/v1\/projects\/([\w-]+)\/runtime\/sessions$/, async ({ params }) => ({ body: { sessions: runtime.sessionsFor(project(params[0]!).info.id).map((s) => s.info) } })],
    ['POST', /^\/v1\/projects\/([\w-]+)\/runtime\/sessions$/, async ({ params, body }) => {
      const req = parse(StartSessionRequest, body);
      return { status: 202, body: { session: (await runtime.startSession(projectRef(params[0]!), req)).info } };
    }],
    ['GET', /^\/v1\/runtime\/sessions\/([\w-]+)$/, async ({ params }) => ({ body: { session: runtime.session(params[0]!).info } })],
    ['GET', /^\/v1\/runtime\/sessions\/([\w-]+)\/logs$/, async ({ params, query }) => ({ body: { lines: runtime.session(params[0]!).logsSince(Number(query.get('since') ?? 0) || 0) } })],
    ['POST', /^\/v1\/runtime\/sessions\/([\w-]+)\/stop$/, async ({ params }) => ({ status: 202, body: { session: runtime.stop(params[0]!).info } })],
    ['POST', /^\/v1\/runtime\/sessions\/([\w-]+)\/auto-capture$/, async ({ params, body }) => {
      const s = runtime.session(params[0]!);
      runtime.setAutoCapture(projectRef(s.info.projectId), s.info.id, parse(AutoCaptureRequest, body).enabled);
      return { body: { session: s.info } };
    }],
    ['GET', /^\/v1\/runtime\/sessions\/([\w-]+)\/detect$/, async ({ params }) => {
      const s = runtime.session(params[0]!);
      return { body: { detected: await runtime.detect(projectRef(s.info.projectId), s.info.id) } };
    }],
    ['GET', /^\/v1\/projects\/([\w-]+)\/captures$/, async ({ params }) => ({ body: await runtime.list(project(params[0]!).info.id) })],
    ['POST', /^\/v1\/projects\/([\w-]+)\/captures$/, async ({ params, body }) => ({ status: 201, body: { capture: await runtime.capture(projectRef(params[0]!), parse(CaptureRequest, body ?? {})) } })],
    ['POST', /^\/v1\/projects\/([\w-]+)\/captures\/([\w-]+)\/assign$/, async ({ params, body }) => ({
      body: { capture: await runtime.assign(projectRef(params[0]!), params[1]!, parse(AssignCaptureRequest, body).screenId) },
    })],
    ['DELETE', /^\/v1\/projects\/([\w-]+)\/captures\/([\w-]+)$/, async ({ params }) => {
      await runtime.remove(project(params[0]!).info.id, params[1]!);
      return { status: 204, body: null };
    }],
    ['GET', /^\/v1\/projects\/([\w-]+)\/captures\/([\w-]+)\/image$/, async ({ params }) => {
      const png = await runtime.image(project(params[0]!).info.id, params[1]!);
      return { body: { dataUri: `data:image/png;base64,${png.toString('base64')}` } };
    }],
  ];

  const expected = Buffer.from(token);
  const authorized = (req: http.IncomingMessage) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) return false;
    const given = Buffer.from(m[1]!);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new ApiError('payload_too_large', 'Request body is too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve(undefined);
        if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return reject(new ApiError('unsupported_media_type', 'Request body must be application/json.'));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new ApiError('invalid_request', 'Request body is not valid JSON.'));
        }
      });
      req.on('error', reject);
    });

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (body === null) return res.end();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    try {
      // DNS-rebinding protection: only accept requests addressed to the loopback host.
      const hostHeader = (req.headers.host ?? '').toLowerCase();
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader)) throw new ApiError('misdirected_request', 'Unexpected Host header.');
      const origin = req.headers.origin;
      if (origin) {
        if (!allowedOrigins.has(origin)) throw new ApiError('forbidden', 'Origin not allowed.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        if (req.method === 'OPTIONS') return send(204, null);
      }
      const url = new URL(req.url ?? '/', `http://${hostHeader}`);
      const candidates = routes.filter(([, re]) => re.test(url.pathname));
      if (!candidates.length) throw new ApiError('not_found', `No route for ${url.pathname}.`);
      const route = candidates.find(([method]) => method === req.method);
      if (!route) throw new ApiError('method_not_allowed', `${req.method} is not supported on ${url.pathname}.`);
      const [, re, handler, flags] = route;
      if (!flags?.public && !authorized(req)) throw new ApiError('unauthorized', 'Missing or invalid bearer token.');
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const result = await handler({ req, params: re.exec(url.pathname)!.slice(1), body, query: url.searchParams });
      send(result.status ?? 200, result.body);
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError('internal_error', 'Unexpected agent error.');
      if (!(error instanceof ApiError)) console.error('[appflow-agent]', error);
      send(e.status, { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  port = (server.address() as { port: number }).port;
  const urlHost = host === '::1' ? '[::1]' : host;
  return {
    url: `http://${urlHost}:${port}`,
    port,
    token,
    server,
    close: () =>
      new Promise((resolve) => {
        for (const p of projects.keys()) jobs.cancelProject(p);
        runtime.stopAll();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
