import {
  ambiguousObservations,
  applyCorrections,
  applyRuntime,
  buildFlowGraph,
  bestEdgeLocation,
  buildProjectIndex,
  canvasTargetAt,
  defaultFilters,
  emptyCorrections,
  exportFlowMap,
  MANUAL_EDGE_PREFIX,
  type ExportFormat,
  type AppProject,
  type FlowFilters,
  type FlowGraph,
  type GraphCorrections,
  type NavigationEdge,
  type NavigationKind,
  type ProjectIndex,
  type RuntimeCapture,
  type RuntimeObservation,
  type SourceLocation,
  type StaleCorrection,
} from '@appflow/model';
import { create } from 'zustand';
import { agentApi, type AgentApi, type EditorId, type SourceChanges } from '../agent/client';
import { computeAutoLayout, mergeLayout, NODE_SIZES, resolveOverlaps, stabilizeLayout, type Positions, type XY } from '../canvas/layout';
import { loadCorrections, loadPinnedLayout, loadViewPrefs, saveCorrections, savePinnedLayout, saveViewPrefs, type ViewPrefs } from '../canvas/layoutStorage';
import { projectSession, rememberLastProject, updateProjectSession, type ProjectSession } from './session';

export type Viewport = NonNullable<ProjectSession['viewport']>;

export type Selection = { kind: 'screen'; id: string } | { kind: 'edge'; id: string } | null;

export interface CodeTarget {
  fileId: string;
  line?: number;
  endLine?: number;
  /** Text the line had at analysis time, used to find it again if the file changed. */
  anchor?: string;
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
  /** Hash of `content`; differs from the file's `contentHash` when it changed after analysis. */
  hash?: string;
  error?: string;
}

interface RuntimeInput {
  captures: RuntimeCapture[];
  observations: RuntimeObservation[];
  images: Record<string, string>;
}

const noRuntime = (): RuntimeInput => ({ captures: [], observations: [], images: {} });

interface ExplorerState {
  /** Project shown: the analysis result with user corrections and runtime captures applied. */
  project: AppProject;
  /** The analysis result (or demo) as produced, before corrections and runtime. */
  baseProject: AppProject;
  /** The graph drawn on the canvas (feature groups, references, parallel edges). */
  graph: FlowGraph;
  corrections: GraphCorrections;
  /** Edges the user marked as incorrect (not in `project`). */
  hiddenEdges: NavigationEdge[];
  staleCorrections: StaleCorrection[];
  /** Observed transitions that match several edges (none verified). */
  ambiguous: Array<{ from: string; to: string; candidates: string[] }>;
  runtime: RuntimeInput;
  view: ViewPrefs;
  filters: FlowFilters;
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
  /** How the current positions were produced; the canvas only fits the view after a full layout. */
  lastLayoutMode: LayoutMode;
  positions: Positions;
  pinned: Positions;
  layoutStatus: LayoutStatus;
  layoutError: string | null;
  paletteOpen: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  reportOpen: boolean;
  shortcutsOpen: boolean;
  /** Files changed on disk since the shown analysis; null when unknown or unchanged. */
  sourceChanges: SourceChanges | null;
  /** Viewport saved in the previous session, applied once by the canvas instead of fitting. */
  restoreViewport: Viewport | null;
  exportStatus: { ok: boolean; message: string } | null;

  /**
   * Shows an analysis result. Re-analysis of the open project keeps every
   * screen where it was and only places new ones.
   */
  loadProject(project: AppProject): Promise<void>;
  /** Re-applies runtime captures and observed transitions to the loaded project. */
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
  /** Fetches a file again, e.g. after it was edited. */
  reloadFile(fileId: string): Promise<void>;
  /** Source → canvas: selects and shows what a line of a file corresponds to. Returns false when nothing does. */
  revealSource(fileId: string, line: number): boolean;
  /** Local editor used by "Open in editor". */
  editor: EditorId;
  setEditor(editor: EditorId): void;
  /** Opens a location in the local editor; the result message is kept in `editorStatus`. */
  openInEditor(target: CodeTarget): Promise<void>;
  editorStatus: { ok: boolean; message: string } | null;
  pinNode(id: string, position: XY): void;
  pinNodes(positions: Positions): void;
  /** Re-arranges everything automatically and forgets manual positions. */
  resetLayout(): Promise<void>;
  setPaletteOpen(open: boolean): void;
  setReportOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  /** Asks the agent whether project files changed since the shown analysis. */
  checkSourceChanges(): Promise<void>;
  /** Exports the map as shown (corrections and runtime applied) and saves it where the user picks. */
  exportMap(format: ExportFormat): Promise<void>;
  /** Remembers the canvas viewport for the next session. */
  saveViewport(viewport: Viewport): void;
  consumeRestoreViewport(): Viewport | null;
  toggleLeftPanel(): void;
  toggleRightPanel(): void;

  /** Marks an edge as incorrect (an added edge is deleted instead). */
  hideEdge(edgeId: string): void;
  restoreEdge(correctionKey: string): void;
  /** Sets (or clears, with null) the destination of an edge analysis could not resolve. */
  resolveEdge(edgeId: string, screenId: string | null): void;
  addEdge(input: { from: string; to: string; label: string; kind: NavigationKind }): string;
  /** Moves a screen to another feature group (null: back to the detected one). */
  setFeature(screenId: string, feature: string | null): void;
  resetCorrections(): void;
  setFilters(filters: Partial<FlowFilters>): void;
  resetFilters(): void;
  setView(view: Partial<ViewPrefs>): Promise<void>;
}

function codeTargetFor(state: Pick<ExplorerState, 'index' | 'project'>, selection: Selection): CodeTarget | null {
  if (!selection) return null;
  if (selection.kind === 'screen') {
    return state.index.screensById.get(selection.id)?.location ?? null;
  }
  const edge = state.index.edgesById.get(selection.id);
  // The handler when known, otherwise how the destination was resolved.
  return edge ? (bestEdgeLocation(edge, state.project) ?? null) : null;
}

const EDITOR_KEY = 'appflow:editor:v1';
function loadEditor(): EditorId {
  try {
    return localStorage.getItem(EDITOR_KEY) === 'cursor' ? 'cursor' : 'vscode';
  } catch {
    return 'vscode';
  }
}

/** Everything shown, derived from the analysis result, corrections, runtime input and view options. */
function derive(base: AppProject, corrections: GraphCorrections, runtime: RuntimeInput, view: ViewPrefs) {
  const corrected = applyCorrections(base, corrections);
  const project = applyRuntime(corrected.project, runtime.captures, runtime.observations, (c) => runtime.images[c.id]);
  const graph = buildFlowGraph(project, { ...view, featureOverrides: corrections.featureOverrides });
  return {
    project,
    index: buildProjectIndex(project),
    graph,
    hiddenEdges: corrected.hidden,
    staleCorrections: corrected.stale,
    ambiguous: ambiguousObservations(project, runtime.observations),
  };
}

const sameNodes = (graph: FlowGraph, positions: Positions) =>
  graph.nodes.length === Object.keys(positions).length && graph.nodes.every((n) => n.id in positions);

export interface StoreDeps {
  agent: AgentApi;
  /** Delay between analysis status polls. */
  pollMs?: number;
}

/**
 * - `fresh`: a newly opened project; manual positions from a previous session win.
 * - `stable`: same project, changed graph; existing nodes stay where they are.
 * - `reset`: the user asked for a full automatic layout.
 */
export type LayoutMode = 'fresh' | 'stable' | 'reset';

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
        set((s) => ({ fileContents: {}, sourceChanges: null, workspace: { ...s.workspace, status: 'ready', analysisId: undefined, progress: undefined, hasResult: true } }));
        const { projectPath } = get().workspace;
        if (projectPath) rememberLastProject(projectPath, project.name);
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

    let layoutSeq = 0;
    async function layout(mode: LayoutMode) {
      const seq = ++layoutSeq;
      const { graph, project } = get();
      set({ layoutStatus: 'computing', layoutError: null });
      try {
        const entries = new Set(project.screens.filter((s) => s.isEntryPoint).map((s) => s.id));
        const auto = await computeAutoLayout(graph, entries);
        if (seq !== layoutSeq) return; // superseded by a newer layout request
        // Read these now: the user may have moved nodes while the layout was computed.
        const { pinned, positions: previous } = get();
        const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
        const sizeOf = (id: string) => NODE_SIZES[types.get(id) ?? 'screen'];
        let positions: Positions;
        if (mode === 'stable') {
          positions = stabilizeLayout(previous, auto, graph, pinned, sizeOf);
        } else {
          const kept = mode === 'reset' ? {} : pinned;
          positions = resolveOverlaps(mergeLayout(auto, kept), sizeOf, new Set(Object.keys(kept).filter((id) => id in auto)));
        }
        set((s) => ({ positions, layoutStatus: 'ready', layoutVersion: s.layoutVersion + 1, lastLayoutMode: mode }));
        // The graph changed while this layout was computed (e.g. a correction): place what is new.
        if (!sameNodes(get().graph, positions)) await layout('stable');
      } catch (error) {
        if (seq === layoutSeq) set({ layoutStatus: 'error', layoutError: error instanceof Error ? error.message : String(error) });
      }
    }

    /** Recomputes the derived project and graph; places new nodes without moving existing ones. */
    function refresh(changes: Partial<Pick<ExplorerState, 'corrections' | 'runtime' | 'view'>> = {}) {
      const s = { ...get(), ...changes };
      const derived = derive(s.baseProject, s.corrections, s.runtime, s.view);
      const selectionGone =
        (s.selection?.kind === 'edge' && !derived.index.edgesById.has(s.selection.id)) || (s.selection?.kind === 'screen' && !derived.index.screensById.has(s.selection.id));
      set({ ...changes, ...derived, ...(selectionGone ? { selection: null } : {}) });
      if (get().layoutStatus !== 'computing' && !sameNodes(derived.graph, get().positions)) void layout('stable');
    }

    function updateCorrections(update: (c: GraphCorrections) => GraphCorrections) {
      const corrections = update(get().corrections);
      saveCorrections(get().baseProject.id, corrections);
      refresh({ corrections });
    }

    const view = loadViewPrefs();
    const first = derive(initial, emptyCorrections(), noRuntime(), view);

    return {
      ...first,
      baseProject: initial,
      corrections: emptyCorrections(),
      runtime: noRuntime(),
      view,
      filters: defaultFilters(),
      workspace: { status: 'welcome', hasResult: false },
      fileContents: {},
      selection: null,
      highlightedFileId: null,
      code: null,
      focusRequest: null,
      layoutVersion: 0,
      lastLayoutMode: 'fresh',
      positions: {},
      pinned: {},
      layoutStatus: 'idle',
      layoutError: null,
      paletteOpen: false,
      leftPanelOpen: true,
      rightPanelOpen: true,
      reportOpen: false,
      shortcutsOpen: false,
      sourceChanges: null,
      restoreViewport: null,
      exportStatus: null,

      async loadProject(project) {
        const prev = get();
        const reanalysis = prev.baseProject.id === project.id && prev.layoutVersion > 0 && Object.keys(prev.positions).length > 0;
        const corrections = reanalysis ? prev.corrections : loadCorrections(project.id);
        const pinned = reanalysis ? prev.pinned : loadPinnedLayout(project.id);
        const runtime = reanalysis ? prev.runtime : noRuntime();
        const derived = derive(project, corrections, runtime, prev.view);
        // A newly opened project resumes where the previous session left it.
        const session = reanalysis ? undefined : projectSession(project.id);
        const wanted = reanalysis ? prev.selection : (session?.selection ?? null);
        const exists = (sel: Selection) => !!sel && (sel.kind === 'screen' ? derived.index.screensById.has(sel.id) : derived.index.edgesById.has(sel.id));
        set({
          ...derived,
          baseProject: project,
          corrections,
          runtime,
          pinned,
          filters: reanalysis ? prev.filters : (session?.filters ?? defaultFilters()),
          selection: exists(wanted) ? wanted : null,
          highlightedFileId: null,
          code: reanalysis ? prev.code : null,
          ...(reanalysis ? {} : { positions: {}, restoreViewport: session?.viewport ?? null, sourceChanges: null }),
        });
        await layout(reanalysis ? 'stable' : 'fresh');
      },

      applyRuntimeOverlay(captures, observations, images) {
        refresh({ runtime: { captures, observations, images } });
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
          const { content, hash } = await agent.fileContent(workspace.projectId, file.path);
          set((s) => ({ fileContents: { ...s.fileContents, [fileId]: { status: 'ready', content, hash } } }));
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
        updateProjectSession(get().baseProject.id, { selection });
      },

      openCode(target) {
        set({ code: { fileId: target.fileId, line: target.line, endLine: target.endLine, anchor: target.anchor } });
      },

      async reloadFile(fileId) {
        set((s) => {
          const fileContents = { ...s.fileContents };
          delete fileContents[fileId];
          return { fileContents };
        });
        await get().ensureFileContent(fileId);
      },

      revealSource(fileId, line) {
        const target = canvasTargetAt(get().project, fileId, line);
        if (!target) return false;
        get().select(target, { focus: true });
        return true;
      },

      editor: loadEditor(),
      editorStatus: null,

      setEditor(editor) {
        try {
          localStorage.setItem(EDITOR_KEY, editor);
        } catch {
          // Non-fatal.
        }
        set({ editor });
      },

      async openInEditor(target) {
        const { workspace, project, editor } = get();
        const file = project.files.find((f) => f.id === target.fileId);
        if (project.source !== 'analysis' || !workspace.projectId || !file) {
          set({ editorStatus: { ok: false, message: 'Only files of an analyzed project on this computer can be opened in an editor.' } });
          return;
        }
        const result = await agent.openInEditor({ projectId: workspace.projectId, path: file.path, line: target.line, editor });
        set({ editorStatus: result.ok ? { ok: true, message: `Opened ${file.path}${target.line ? `:${target.line}` : ''}` } : { ok: false, message: result.error ?? 'The editor could not be opened.' } });
      },

      closeCode() {
        set({ code: null });
      },

      highlightFile(fileId) {
        set({ highlightedFileId: fileId });
      },

      pinNode(id, position) {
        get().pinNodes({ [id]: position });
      },

      pinNodes(moved) {
        const pinned = { ...get().pinned, ...moved };
        set((s) => ({ pinned, positions: { ...s.positions, ...moved } }));
        savePinnedLayout(get().baseProject.id, pinned);
      },

      async resetLayout() {
        set({ pinned: {} });
        savePinnedLayout(get().baseProject.id, {});
        await layout('reset');
      },

      setPaletteOpen(open) {
        set({ paletteOpen: open });
      },

      setReportOpen(open) {
        set({ reportOpen: open });
      },

      setShortcutsOpen(open) {
        set({ shortcutsOpen: open });
      },

      async checkSourceChanges() {
        const { workspace, project } = get();
        if (workspace.status !== 'ready' || !workspace.projectId || project.source !== 'analysis') return;
        try {
          const changes = await agent.changes(workspace.projectId);
          // Ignore an answer about another analysis, or one that arrives after a re-analysis started.
          if (get().workspace.status !== 'ready' || get().workspace.projectId !== workspace.projectId) return;
          set({ sourceChanges: changes.changed ? changes : null });
        } catch {
          // The agent may be restarting; the next check will tell.
        }
      },

      async exportMap(format) {
        const { project, baseProject, corrections, graph, positions } = get();
        try {
          const file = exportFlowMap(format, project, { featureOverrides: corrections.featureOverrides, positions, graph, nodeSize: (type) => NODE_SIZES[type] });
          const slug = baseProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
          const result = await agent.saveFile({ suggestedName: `${slug}-flow-map.${file.extension}`, content: file.content, extension: file.extension });
          set({ exportStatus: result.cancelled ? null : result.ok ? { ok: true, message: `Exported to ${result.path}` } : { ok: false, message: result.error ?? 'The export could not be saved.' } });
        } catch (error) {
          set({ exportStatus: { ok: false, message: error instanceof Error ? error.message : String(error) } });
        }
      },

      saveViewport(viewport) {
        updateProjectSession(get().baseProject.id, { viewport });
      },

      consumeRestoreViewport() {
        const viewport = get().restoreViewport;
        if (viewport) set({ restoreViewport: null });
        return viewport;
      },

      toggleLeftPanel() {
        set((s) => ({ leftPanelOpen: !s.leftPanelOpen }));
      },

      toggleRightPanel() {
        set((s) => ({ rightPanelOpen: !s.rightPanelOpen }));
      },

      hideEdge(edgeId) {
        const edge = get().index.edgesById.get(edgeId);
        const key = edge?.correction?.key;
        if (!edge || !key) return;
        updateCorrections((c) =>
          edge.correction?.addedByUser
            ? { ...c, addedEdges: c.addedEdges.filter((m) => m.id !== key) }
            : { ...c, hiddenEdges: c.hiddenEdges.includes(key) ? c.hiddenEdges : [...c.hiddenEdges, key] },
        );
      },

      restoreEdge(key) {
        updateCorrections((c) => ({ ...c, hiddenEdges: c.hiddenEdges.filter((k) => k !== key) }));
      },

      resolveEdge(edgeId, screenId) {
        const edge = get().index.edgesById.get(edgeId);
        const key = edge?.correction?.key;
        if (!edge || !key || (edge.to !== null && !edge.correction?.resolvedByUser)) return;
        updateCorrections((c) => {
          const edgeTargets = { ...c.edgeTargets };
          if (screenId) edgeTargets[key] = screenId;
          else delete edgeTargets[key];
          return { ...c, edgeTargets };
        });
      },

      addEdge({ from, to, label, kind }) {
        const id = `${MANUAL_EDGE_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        updateCorrections((c) => ({ ...c, addedEdges: [...c.addedEdges, { id, from, to, label: label.trim() || 'Added by hand', kind, createdAt: new Date().toISOString() }] }));
        return id;
      },

      setFeature(screenId, feature) {
        updateCorrections((c) => {
          const featureOverrides = { ...c.featureOverrides };
          const value = feature?.trim().toLowerCase();
          if (value) featureOverrides[screenId] = value;
          else delete featureOverrides[screenId];
          return { ...c, featureOverrides };
        });
        // Group membership changed: keep positions, the group boxes follow their screens.
      },

      resetCorrections() {
        updateCorrections(() => emptyCorrections());
      },

      setFilters(filters) {
        set((s) => ({ filters: { ...s.filters, ...filters } }));
        updateProjectSession(get().baseProject.id, { filters: get().filters });
      },

      resetFilters() {
        set({ filters: defaultFilters() });
        updateProjectSession(get().baseProject.id, { filters: get().filters });
      },

      async setView(change) {
        const prev = get().view;
        const view = { ...prev, ...change };
        saveViewPrefs(view);
        if (view.groupByFeature === prev.groupByFeature && view.collapseSharedTargets === prev.collapseSharedTargets) {
          set({ view }); // display-only option such as the minimap
          return;
        }
        set({ view, ...derive(get().baseProject, get().corrections, get().runtime, view) });
        // Grouping changes the arrangement itself; manual positions are kept.
        await layout('fresh');
      },
    };
  });
}

export type ExplorerStore = ReturnType<typeof createExplorerStore>;
