import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';

export interface AgentRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface AgentResponse {
  status: number;
  body: unknown;
}

/**
 * Owns the agent utility process. The bearer token stays in the main process;
 * the renderer only ever sees API responses.
 */
export class AgentHost {
  private child: UtilityProcess | null = null;
  private ready: Promise<string> | null = null;
  private readonly token = randomBytes(24).toString('base64url');

  private start(): Promise<string> {
    this.ready ??= new Promise<string>((resolve, reject) => {
      // Electron requires string values; drop unset variables and ELECTRON_RUN_AS_NODE.
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
      env['APPFLOW_AGENT_TOKEN'] = this.token;
      // Captures are stored with the app's data, never inside the analyzed project.
      env['APPFLOW_DATA_DIR'] = app.getPath('userData');
      const child = utilityProcess.fork(join(__dirname, 'agent.js'), [], { serviceName: 'AppFlow Agent', env, stdio: 'inherit' });
      this.child = child;
      const timer = setTimeout(() => reject(new Error('The local agent did not start in time.')), 15_000);
      child.on('message', (message: { type?: string; url?: string }) => {
        if (message?.type === 'ready' && message.url) {
          clearTimeout(timer);
          resolve(message.url);
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        this.child = null;
        this.ready = null;
        reject(new Error(`The local agent exited (code ${code}).`));
      });
    });
    return this.ready;
  }

  async request(req: AgentRequest): Promise<AgentResponse> {
    if (!/^\/v1\/[\w\-/]*(\?[\w\-=&%.~]*)?$/.test(req.path) || !['GET', 'POST', 'DELETE'].includes(req.method)) {
      return { status: 400, body: { error: { code: 'invalid_request', message: 'Invalid agent request.' } } };
    }
    const url = await this.start();
    const res = await fetch(url + req.path, {
      method: req.method,
      headers: { Authorization: `Bearer ${this.token}`, ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}
