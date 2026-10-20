import { useEffect } from 'react';
import { FlowCanvas } from './canvas/FlowCanvas';
import { CodePanel } from './components/CodePanel';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DetailsPanel } from './components/DetailsPanel';
import { ReportPanel } from './components/ReportPanel';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { SourceChangesBanner } from './components/SourceChangesBanner';
import { FileExplorer } from './components/FileExplorer';
import { TopBar } from './components/TopBar';
import { AnalysisProgress, WelcomeScreen } from './components/WelcomeScreen';
import { matchShortcut } from './lib/shortcuts';
import { useExplorer, useRuntime } from './store';

/** Every app-wide shortcut (see lib/shortcuts.ts); map-only keys are handled by the canvas. */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (!id) return;
      const state = useExplorer.getState();
      const { paletteOpen, reportOpen, shortcutsOpen, workspace, project, selection } = state;
      const showsProject = workspace.status === 'demo' || workspace.hasResult;
      const dialogOpen = paletteOpen || reportOpen || shortcutsOpen || !!useRuntime.getState().pending;
      if (dialogOpen && id !== 'palette' && id !== 'escape') return;
      switch (id) {
        case 'palette':
          if (!showsProject) return;
          state.setPaletteOpen(!paletteOpen);
          break;
        case 'help':
          state.setShortcutsOpen(true);
          break;
        case 'escape':
          if (dialogOpen) return; // dialogs close themselves
          state.select(null);
          state.highlightFile(null);
          return;
        case 'export':
          if (!showsProject) return;
          window.dispatchEvent(new Event('appflow:open-export'));
          break;
        case 'reanalyze':
          if (workspace.status !== 'ready' || !workspace.projectId) return;
          void state.reanalyze();
          break;
        case 'report':
          if (!showsProject) return;
          state.setReportOpen(true);
          break;
        case 'nextUnresolved': {
          const unresolved = project.edges.filter((edge) => edge.to === null);
          if (!unresolved.length) return;
          const at = selection?.kind === 'edge' ? unresolved.findIndex((edge) => edge.id === selection.id) : -1;
          state.select({ kind: 'edge', id: unresolved[(at + 1) % unresolved.length]!.id }, { focus: true, openCode: 'follow' });
          break;
        }
        case 'openCode':
          if (!selection) return;
          state.select(selection, { openCode: true });
          break;
        case 'toggleFiles':
          state.toggleLeftPanel();
          break;
        case 'toggleDetails':
          state.toggleRightPanel();
          break;
        case 'minimap':
          void state.setView({ showMinimap: !state.view.showMinimap });
          break;
        default:
          return; // canvas shortcuts
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const CHANGE_CHECK_MS = 15_000;

/**
 * Checks for edited project files while the window is visible and when it
 * regains focus (e.g. after switching back from the editor). The agent rescans
 * on request; nothing watches the file system in the background.
 */
function useSourceChangeWatch() {
  const watching = useExplorer((s) => s.workspace.status === 'ready' && s.project.source === 'analysis');
  useEffect(() => {
    if (!watching) return;
    let busy = false;
    const check = () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      void useExplorer.getState().checkSourceChanges().finally(() => (busy = false));
    };
    const timer = setInterval(check, CHANGE_CHECK_MS);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [watching]);
}

export function App() {
  const leftOpen = useExplorer((s) => s.leftPanelOpen);
  const rightOpen = useExplorer((s) => s.rightPanelOpen);
  const codeOpen = useExplorer((s) => s.code !== null);
  const workspace = useExplorer((s) => s.workspace);
  useGlobalShortcuts();
  useSourceChangeWatch();

  // `--open <dir>` on the command line.
  useEffect(() => {
    void window.appflow?.initialProjectPath?.().then((path) => {
      if (path) void useExplorer.getState().openProjectPath(path);
    });
  }, []);

  // A loaded project stays visible while it is re-analyzed or when a re-analysis fails.
  const showsProject = workspace.status === 'demo' || workspace.status === 'ready' || ((workspace.status === 'analyzing' || workspace.status === 'error') && workspace.hasResult);

  if (!showsProject) {
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <main className="min-h-0 flex-1">{workspace.status === 'analyzing' ? <AnalysisProgress /> : <WelcomeScreen />}</main>
        <ShortcutsHelp />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <nav aria-label="Project files" className="w-[264px] shrink-0">
            <FileExplorer />
          </nav>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <SourceChangesBanner />
          <div className="min-h-0 flex-1">
            <FlowCanvas />
          </div>
          {codeOpen && (
            <div className="h-[38%] min-h-[180px] shrink-0">
              <CodePanel />
            </div>
          )}
        </main>
        {rightOpen && (
          <aside aria-label="Details" className="w-[328px] shrink-0">
            <DetailsPanel />
          </aside>
        )}
      </div>
      <CommandPalette />
      <ReportPanel />
      <ShortcutsHelp />
      <ConfirmDialog />
    </div>
  );
}
