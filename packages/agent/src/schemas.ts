import { z } from 'zod';

/** Request and response contracts of the local agent API (v1). */

export const RegisterProjectRequest = z.object({
  /** Absolute path of the project directory the user selected. */
  path: z.string().min(1).max(4096),
});
export type RegisterProjectRequest = z.infer<typeof RegisterProjectRequest>;

export const StartAnalysisRequest = z
  .object({
    /** Restrict analysis to these adapter ids (default: all). */
    adapters: z.array(z.string().min(1).max(64)).max(16).optional(),
  })
  .default({});
export type StartAnalysisRequest = z.infer<typeof StartAnalysisRequest>;

export const FileContentQuery = z.object({
  path: z.string().min(1).max(4096),
});

export const RevealFileRequest = z.object({
  path: z.string().min(1).max(4096),
});

export const RunOperationRequest = z.object({
  operation: z.string().min(1).max(64),
  /** Token from a previous `confirmation_required` response, after the user agreed. */
  confirmationToken: z.string().min(1).max(256).optional(),
});
export type RunOperationRequest = z.infer<typeof RunOperationRequest>;

export type AnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  registeredAt: string;
  frameworks: Array<{ id: string; name: string; version?: string; root: string }>;
}

export interface AnalysisInfo {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  progress: { phase: string; message: string; percent: number };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: { message: string };
  summary?: { screens: number; edges: number; routes: number; warnings: number; files: number };
}

export interface OperationInfo {
  id: string;
  projectId: string;
  operation: string;
  command: string[];
  cwd: string;
  status: 'running' | 'succeeded' | 'failed';
  exitCode?: number;
  /** Last lines of combined stdout/stderr. */
  outputTail: string;
}

// ---- Runtime (Phase 3) ----------------------------------------------------------------------------

export const BootDeviceRequest = z.object({ confirmationToken: z.string().min(1).max(256).optional() }).default({});

export const StartSessionRequest = z.object({
  deviceId: z.string().min(1).max(200),
  mode: z.enum(['debug', 'profile', 'release']).optional(),
  flavor: z.string().min(1).max(64).optional(),
  target: z.string().min(1).max(256).optional(),
  confirmationToken: z.string().min(1).max(256).optional(),
});

export const AutoCaptureRequest = z.object({ enabled: z.boolean() });

export const CaptureRequest = z
  .object({
    deviceId: z.string().min(1).max(200).optional(),
    sessionId: z.string().min(1).max(64).optional(),
    /** Assign the capture to this screen instead of detecting it. */
    screenId: z.string().min(1).max(512).optional(),
  })
  .default({});

export const AssignCaptureRequest = z.object({ screenId: z.string().min(1).max(512).nullable() });
