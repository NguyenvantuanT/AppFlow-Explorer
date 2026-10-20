import { applyRuntime, buildProjectIndex, type AppProject, type ProjectIndex, type RuntimeCapture, type RuntimeObservation, type SourceLocation } from '@appflow/model';
import { create } from 'zustand';
import { agentApi, type AgentApi } from '../agent/client';
import { computeAutoLayout, mergeLayout, type Positions, type XY } from '../canvas/layout';
import { loadPinnedLayout, savePinnedLayout } from '../canvas/layoutStorage';

export type Selection = { kind: 'screen'; id: string } | { kind: 'edge'; id: string } | null;

export interface CodeTarget {
  fileId: string;
  line?: number;
  endLine?: number;
}

export type LayoutStatus = 'idle' | 'computing' | 'ready' | 'error';

/**
 * What the workspace shows:
 * - `welcome`: nothing opened yet.
 * - `demo`: the bundled mock project.
 * - `analyzing`: a real project is being analyzed by the local agent.
 * - `ready`: a real project's analysis result is loaded.
 * - `error`: opening or analyzing failed (the previous project, if any, stays visible).
 */
export type WorkspaceStatus = 'welcome' | 'demo' | 'analyzing' | 'ready' | 'error';

export interface Workspace {
  status: WorkspaceStatus;
  projectId?: string;
  projectPath?: string;
  analysisId?: string;
  progress?: { phase: string; message: string; percent: number };
  error?: string;
  /** True once a real analysis result has been loaded in this session. */
  hasResult: boolean;
}

export interface FileContentState {
  status: 'loading' | 'ready' | 'error';
  content?: string;
  error?: string;
}

interface ExplorerState {
  /** Project shown: the analysis result with runtime captures overlaid. */
  project: AppProject;
  /** The analysis result (or demo) before runtime captures are applied. */
  baseProject: AppProject;
  workspace: Workspace;
  fileContents: Record<string, FileContentState>;
  index: ProjectIndex;
  selection: Selection;
  highlightedFileId: string | null;
  code: CodeTarget | null;
  /** Bumped to ask the canvas to bring a node or edge into view. */
  focusRequest: { target: Exclude<Selection, null>; nonce: number } | null;
  /** Bumped whenever node positions are replaced wholesale (auto layout). */
  layoutVersion: number;
  positions: Positions;
  pinned: Positions;
  layoutStatus: LayoutStatus;
  layoutError: string | null;
  paletteOpen: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;

  loadProject(project: AppProject): Promise<void>;
  /** Re-applies runtime captures and observed transitions to the loaded project (no relayout). */
  applyRuntimeOverlay(captures: RuntimeCapture[], observations: RuntimeObservation[], images: Record<string, string>): void;
  /** Shows the bundled demo project. */
  loadDemo(): Promise<void>;
  /** Lets the user pick a folder, registers it with the agent and analyzes it. */
  openProjectFolder(): Promise<void>;
  /** Registers a known folder with the agent and analyzes it. */
  openProjectPath(path: string): Promise<void>;
  /** Re-runs the analysis of the current real project. */
  reanalyze(): Promise<void>;
  cancelAnalysis(): Promise<void>;
  /** Loads a file's text from the agent when the analysis result did not include it. */
  ensureFileContent(fileId: string): Promise<void>;
  /**
   * `openCode: true` always opens the source; `'follow'` only retargets an
   * already-open code panel (IDE-style follow selection).
   */
  select(selection: Selection, options?: { focus?: boolean; openCode?: boolean | 'follow' }): void;
  openCode(target: CodeTarget | SourceLocation): void;
  closeCode(): void;
  highlightFile(fileId: string | null): void;
  pinNode(id: string, position: XY): void;
  resetLayout(): Promise<void>;
  setPaletteOpen(open: boolean): void;
  toggleLeftPanel(): void;
  toggleRightPanel(): void;
}

function codeTargetFor(state: Pick<ExplorerState, 'index'>, selection: Selection): CodeTarget | null {
  if (!selection) return null;
  if (selection.kind === 'screen') {
    return state.index.screensById.get(selection.id)?.location ?? null;
  }
  return state.index.edgesById.get(selection.id)?.trigger.location ?? null;
}

export interface StoreDeps {
  agent: AgentApi;
  /** Delay between analysis status polls. */
  pollMs?: number;
}

export function createExplorerStore(initial: AppProject, deps: StoreDeps = { agent: agentApi }) {
  const { agent } = deps;
  const pollMs = deps.pollMs ?? 250;
  return create<ExplorerState>()((set, get) => {
    /** Starts an analysis and polls it to completion; a newer request supersedes older ones. */
    async function runAnalysis(projectId: string): Promise<void> {
      const started = await agent.startAnalysis(projectId);
      set((s) => ({ workspace: { ...s.workspace, status: 'analyzing', projectId, analysisId: started.id, progress: started.progress, error: undefined } }));
      let info = started;
      while (info.status === 'queued' || info.status === 'running') {
        await new Promise((r) => setTimeout(r, pollMs));
        if (get().workspace.analysisId !== started.id) return;
        info = await agent.getAnalysis(started.id);
        if (get().workspace.analysisId !== started.id) return;
        set((s) => ({ workspace: { ...s.workspace, progress: info.progress } }));
      }
      if (info.status === 'succeeded') {
        const project = await agent.getResult(info.id);
        set((s) => ({ fileContents: {}, workspace: { ...s.workspace, status: 'ready', analysisId: undefined, progress: undefined, hasResult: true } }));
        await get().loadProject(project);
      } else {
        set((s) => ({
          workspace: {
            ...s.workspace,
            status: info.status === 'cancelled' ? (s.workspace.hasResult ? 'ready' : 'welcome') : 'error',
            analysisId: undefined,
            progress: undefined,
            error: info.status === 'cancelled' ? undefined : (info.error?.message ?? 'The analysis failed.'),
          },
        }));
      }
    }

    const fail = (error: unknown) =>
      set((s) => ({ workspace: { ...s.workspace, status: 'error', analysisId: undefined, progress: undefined, error: error instanceof Error ? error.message : String(error) } }));

    async function layout(project: AppProject, pinned: Positions) {
      set({ layoutStatus: 'computing', layoutError: null });
      try {
        const auto = await computeAutoLayout(project);
        if (get().baseProject !== project) return; // a newer project replaced this one
        set((s) => ({
          positions: mergeLayout(auto, pinned),
          layoutStatus: 'ready',
          layoutVersion: s.layoutVersion + 1,
        }));
      } catch (error) {
        set({ layoutStatus: 'error', layoutError: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      project: initial,
      baseProject: initial,
      workspace: { status: 'welcome', hasResult: false },
      fileContents: {},
      index: buildProjectIndex(initial),
      selection: null,
      highlightedFileId: null,
      code: null,
      focusRequest: null,
      layoutVersion: 0,
      positions: {},
      pinned: {},
      layoutStatus: 'idle',
      layoutError: null,
      paletteOpen: false,
      leftPanelOpen: true,
      rightPanelOpen: true,

      async loadProject(project) {
        const pinned = loadPinnedLayout(project.id);
        set({
          project,
          baseProject: project,
          index: buildProjectIndex(project),
          selection: null,
          highlightedFileId: null,
          code: null,
          pinned,
        });
        await layout(project, pinned);
      },

      applyRuntimeOverlay(captures, observations, images) {
        const project = applyRuntime(get().baseProject, captures, observations, (c) => images[c.id]);
        set({ project, index: buildProjectIndex(project) });
      },

      async loadDemo() {
        set({ workspace: { status: 'demo', hasResult: get().workspace.hasResult }, fileContents: {} });
        await get().loadProject(initial);
      },

      async openProjectFolder() {
        let path: string | null;
        try {
          path = await agent.pickProjectDirectory();
        } catch (error) {
          fail(error);
          return;
        }
        if (path) await get().openProjectPath(path);
      },

      async openProjectPath(path) {
        try {
          set((s) => ({ workspace: { ...s.workspace, status: 'analyzing', projectPath: path, progress: { phase: 'registering', message: 'Opening project', percent: 0 }, error: undefined } }));
          const info = await agent.registerProject(path);
          set((s) => ({ workspace: { ...s.workspace, projectId: info.id } }));
          await runAnalysis(info.id);
        } catch (error) {
          fail(error);
        }
      },

      async reanalyze() {
        const { projectId } = get().workspace;
        if (!projectId) return;
        try {
          await runAnalysis(projectId);
        } catch (error) {
          fail(error);
        }
      },

      async cancelAnalysis() {
        const { analysisId } = get().workspace;
        if (!analysisId) return;
        try {
          await agent.cancelAnalysis(analysisId);
        } catch (error) {
          fail(error);
        }
      },

      async ensureFileContent(fileId) {
        const { project, workspace, fileContents } = get();
        const file = project.files.find((f) => f.id === fileId);
        if (!file || file.content !== undefined || fileContents[fileId] || project.source !== 'analysis' || !workspace.projectId) return;
        set((s) => ({ fileContents: { ...s.fileContents, [fileId]: { status: 'loading' } } }));
        try {
          const content = await agent.fileContent(workspace.projectId, file.path);
          set((s) => ({ fileContents: { ...s.fileContents, [fileId]: { status: 'ready', content } } }));
        } catch (error) {
          set((s) => ({ fileContents: { ...s.fileContents, [fileId]: { status: 'error', error: error instanceof Error ? error.message : String(error) } } }));
        }
      },

      select(selection, options = {}) {
        set((s) => ({
          selection,
          focusRequest:
            selection && options.focus
              ? { target: selection, nonce: (s.focusRequest?.nonce ?? 0) + 1 }
              : s.focusRequest,
          code:
            options.openCode === true || (options.openCode === 'follow' && s.code)
              ? (codeTargetFor(s, selection) ?? s.code)
              : s.code,
          rightPanelOpen: selection ? true : s.rightPanelOpen,
        }));
      },

      openCode(target) {
        set({ code: { fileId: target.fileId, line: target.line, endLine: target.endLine } });
      },

      closeCode() {
        set({ code: null });
      },

      highlightFile(fileId) {
        set({ highlightedFileId: fileId });
      },

      pinNode(id, position) {
        const pinned = { ...get().pinned, [id]: position };
        set((s) => ({ pinned, positions: { ...s.positions, [id]: position } }));
        savePinnedLayout(get().project.id, pinned);
      },

      async resetLayout() {
        set({ pinned: {} });
        savePinnedLayout(get().project.id, {});
        await layout(get().project, {});
      },

      setPaletteOpen(open) {
        set({ paletteOpen: open });
      },

      toggleLeftPanel() {
        set((s) => ({ leftPanelOpen: !s.leftPanelOpen }));
      },

      toggleRightPanel() {
        set((s) => ({ rightPanelOpen: !s.rightPanelOpen }));
      },
    };
  });
}

export type ExplorerStore = ReturnType<typeof createExplorerStore>;
