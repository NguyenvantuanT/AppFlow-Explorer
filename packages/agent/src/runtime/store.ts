import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RuntimeCapture, RuntimeObservation } from '@appflow/model';

interface Index {
  captures: RuntimeCapture[];
  observations: RuntimeObservation[];
}

/**
 * Captures live outside the analyzed project, in the app's data directory:
 * `<dataDir>/captures/<projectId>/{index.json, <captureId>.png}`.
 */
export class CaptureStore {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  /** Serializes index updates (auto-capture and user edits can overlap). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private dir(projectId: string): string {
    if (!/^[\w-]+$/.test(projectId)) throw new Error('Invalid project id.');
    return path.join(this.dataDir, 'captures', projectId);
  }

  async load(projectId: string): Promise<Index> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir(projectId), 'index.json'), 'utf8')) as Index;
    } catch {
      return { captures: [], observations: [] };
    }
  }

  private async save(projectId: string, index: Index): Promise<void> {
    await fs.mkdir(this.dir(projectId), { recursive: true });
    const file = path.join(this.dir(projectId), 'index.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(index, null, 1));
    await fs.rename(`${file}.tmp`, file);
  }

  add(capture: RuntimeCapture, png: Buffer): Promise<void> {
    return this.exclusive(async () => {
    await fs.mkdir(this.dir(capture.projectId), { recursive: true });
    await fs.writeFile(path.join(this.dir(capture.projectId), `${capture.id}.png`), png);
    const index = await this.load(capture.projectId);
    index.captures.push(capture);
    await this.save(capture.projectId, index);
    });
  }

  update(projectId: string, captureId: string, patch: Partial<Pick<RuntimeCapture, 'screenId' | 'association'>>): Promise<RuntimeCapture | undefined> {
    return this.exclusive(async () => {
    const index = await this.load(projectId);
    const c = index.captures.find((x) => x.id === captureId);
    if (!c) return undefined;
    Object.assign(c, patch);
    await this.save(projectId, index);
    return c;
    });
  }

  remove(projectId: string, captureId: string): Promise<boolean> {
    return this.exclusive(async () => {
    const index = await this.load(projectId);
    const before = index.captures.length;
    index.captures = index.captures.filter((c) => c.id !== captureId);
    if (index.captures.length === before) return false;
    await this.save(projectId, index);
    await fs.rm(path.join(this.dir(projectId), `${captureId}.png`), { force: true });
    return true;
    });
  }

  async image(projectId: string, captureId: string): Promise<Buffer | undefined> {
    if (!/^[\w-]+$/.test(captureId)) return undefined;
    try {
      return await fs.readFile(path.join(this.dir(projectId), `${captureId}.png`));
    } catch {
      return undefined;
    }
  }

  observe(projectId: string, observation: RuntimeObservation): Promise<void> {
    return this.exclusive(async () => {
    const index = await this.load(projectId);
    if (index.observations.some((o) => o.sessionId === observation.sessionId && o.fromScreenId === observation.fromScreenId && o.toScreenId === observation.toScreenId)) return;
    index.observations.push(observation);
    await this.save(projectId, index);
    });
  }
}
