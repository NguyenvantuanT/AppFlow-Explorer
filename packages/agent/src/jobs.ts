import { randomUUID } from 'node:crypto';
import { analyzeProject, type AnalysisAdapter } from '@appflow/analyzer';
import type { AppProject } from '@appflow/model';
import { snapshotOf, type Snapshot } from './changes';
import type { AnalysisInfo } from './schemas';

interface Job {
  info: AnalysisInfo;
  controller: AbortController;
  result?: AppProject;
  /** Files as they were when the analysis started. */
  snapshot?: Snapshot;
}

const MAX_FINISHED_JOBS = 20;

/** Runs analyses one at a time per project, with progress, cancellation and bounded history. */
export class JobManager {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly adapters: AnalysisAdapter[]) {}

  start(projectId: string, rootPath: string, adapterIds?: string[]): AnalysisInfo {
    const running = [...this.jobs.values()].find((j) => j.info.projectId === projectId && (j.info.status === 'queued' || j.info.status === 'running'));
    if (running) return running.info;

    const adapters = adapterIds ? this.adapters.filter((a) => adapterIds.includes(a.id)) : this.adapters;
    const job: Job = {
      controller: new AbortController(),
      info: { id: randomUUID(), projectId, status: 'queued', progress: { phase: 'queued', message: 'Waiting to start', percent: 0 }, createdAt: new Date().toISOString() },
    };
    this.jobs.set(job.info.id, job);
    this.prune();

    // Run on the next tick so the caller gets the queued job back immediately.
    setImmediate(async () => {
      if (job.controller.signal.aborted) return;
      job.info.status = 'running';
      job.info.startedAt = new Date().toISOString();
      try {
        const { project, scanned } = await analyzeProject(rootPath, {
          adapters,
          signal: job.controller.signal,
          onProgress: (p) => {
            job.info.progress = p;
          },
        });
        job.result = { ...project, id: projectId };
        job.snapshot = snapshotOf(scanned);
        job.info.status = 'succeeded';
        job.info.summary = {
          screens: project.screens.length,
          edges: project.edges.length,
          routes: project.routes?.length ?? 0,
          warnings: project.warnings?.length ?? 0,
          files: project.files.length,
        };
      } catch (error) {
        if (job.controller.signal.aborted) {
          job.info.status = 'cancelled';
        } else {
          job.info.status = 'failed';
          job.info.error = { message: error instanceof Error ? error.message : String(error) };
        }
      } finally {
        job.info.finishedAt = new Date().toISOString();
      }
    });
    return job.info;
  }

  /** Result of the latest successful analysis of a project. */
  latestResult(projectId: string): AppProject | undefined {
    return this.latest(projectId)?.result;
  }

  /** Latest successful analysis job of a project. */
  latest(projectId: string): Job | undefined {
    const done = [...this.jobs.values()].filter((j) => j.info.projectId === projectId && j.result).sort((a, b) => (b.info.finishedAt ?? '').localeCompare(a.info.finishedAt ?? ''));
    return done[0];
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): AnalysisInfo | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.info.status === 'queued') {
      job.info.status = 'cancelled';
      job.info.finishedAt = new Date().toISOString();
    }
    job.controller.abort();
    return job.info;
  }

  cancelProject(projectId: string): void {
    for (const job of this.jobs.values()) if (job.info.projectId === projectId) this.cancel(job.info.id);
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((j) => j.info.finishedAt).sort((a, b) => a.info.createdAt.localeCompare(b.info.createdAt));
    for (const j of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) this.jobs.delete(j.info.id);
  }
}
