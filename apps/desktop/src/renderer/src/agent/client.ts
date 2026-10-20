import type { AppProject } from '@appflow/model';

/** Mirrors the agent API contracts (packages/agent/src/schemas.ts). */
export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  frameworks: Array<{ id: string; name: string; version?: string; root: string }>;
}

export type AnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AnalysisInfo {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  progress: { phase: string; message: string; percent: number };
  error?: { message: string };
  summary?: { screens: number; edges: number; routes: number; warnings: number; files: number };
}

/** Files added, removed or edited since the last analysis (paths only, never content). */
export interface SourceChanges {
  analysisId: string;
  since: string;
  changed: boolean;
  counts: { added: number; removed: number; modified: number };
  added: string[];
  removed: string[];
  modified: string[];
}

export interface SaveFileRequest {
  suggestedName: string;
  content: string;
  /** Extension without the dot, used for the save dialog filter. */
  extension: string;
}

export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface AgentApi {
  available(): boolean;
  pickProjectDirectory(): Promise<string | null>;
  registerProject(path: string): Promise<ProjectInfo>;
  startAnalysis(projectId: string): Promise<AnalysisInfo>;
  getAnalysis(analysisId: string): Promise<AnalysisInfo>;
  cancelAnalysis(analysisId: string): Promise<AnalysisInfo>;
  getResult(analysisId: string): Promise<AppProject>;
  /** A file's current text, and a hash to compare with the one recorded at analysis. */
  fileContent(projectId: string, path: string): Promise<{ content: string; hash?: string }>;
  /** Source changes since the project's latest finished analysis. */
  changes(projectId: string): Promise<SourceChanges>;
  /** Asks where to save an exported file and writes it (desktop app only). */
  saveFile(request: SaveFileRequest): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  /** Opens a project file at a line in a local editor (desktop app only). */
  openInEditor(request: OpenInEditorRequest): Promise<{ ok: boolean; error?: string }>;
}

export type EditorId = 'vscode' | 'cursor';

export interface OpenInEditorRequest {
  projectId: string;
  path: string;
  line?: number;
  column?: number;
  editor: EditorId;
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const bridge = window.appflow;
  if (!bridge) throw new AgentError(0, 'agent_unavailable', 'The local agent is only available in the desktop app.');
  const res = await bridge.agent.request(method, path, body);
  if (res.status >= 400) {
    const err = (res.body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new AgentError(res.status, err?.code ?? 'error', err?.message ?? `Agent request failed (${res.status}).`);
  }
  return res.body as T;
}

/** Local agent API, reached through the desktop main process. */
export const agentApi: AgentApi = {
  available: () => !!window.appflow?.agent,
  pickProjectDirectory: async () => (window.appflow ? window.appflow.pickProjectDirectory() : null),
  registerProject: async (path) => (await call<{ project: ProjectInfo }>('POST', '/v1/projects', { path })).project,
  startAnalysis: async (projectId) => (await call<{ analysis: AnalysisInfo }>('POST', `/v1/projects/${projectId}/analyses`, {})).analysis,
  getAnalysis: async (id) => (await call<{ analysis: AnalysisInfo }>('GET', `/v1/analyses/${id}`)).analysis,
  cancelAnalysis: async (id) => (await call<{ analysis: AnalysisInfo }>('POST', `/v1/analyses/${id}/cancel`)).analysis,
  getResult: async (id) => (await call<{ project: AppProject }>('GET', `/v1/analyses/${id}/result`)).project,
  fileContent: async (projectId, path) => {
    const res = await call<{ content: string; hash?: string }>('GET', `/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
    return { content: res.content, hash: res.hash };
  },
  changes: async (projectId) => call<SourceChanges>('GET', `/v1/projects/${projectId}/changes`),
  saveFile: async (request) => {
    const bridge = window.appflow;
    if (!bridge?.saveFile) return { ok: false, error: 'Saving files is only available in the desktop app.' };
    return bridge.saveFile(request);
  },
  openInEditor: async (request) => {
    const bridge = window.appflow;
    if (!bridge?.openInEditor) return { ok: false, error: 'Opening a local editor is only available in the desktop app.' };
    return bridge.openInEditor(request);
  },
};
