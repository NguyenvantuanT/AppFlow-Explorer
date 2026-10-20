import { useEffect } from 'react';
import { FlowCanvas } from './canvas/FlowCanvas';
import { CodePanel } from './components/CodePanel';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DetailsPanel } from './components/DetailsPanel';
import { FileExplorer } from './components/FileExplorer';
import { TopBar } from './components/TopBar';
import { AnalysisProgress, WelcomeScreen } from './components/WelcomeScreen';
import { useExplorer } from './store';

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { paletteOpen, setPaletteOpen, select, highlightFile } = useExplorer.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (e.key === 'Escape' && !paletteOpen) {
        select(null);
        highlightFile(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const leftOpen = useExplorer((s) => s.leftPanelOpen);
  const rightOpen = useExplorer((s) => s.rightPanelOpen);
  const codeOpen = useExplorer((s) => s.code !== null);
  const workspace = useExplorer((s) => s.workspace);
  useGlobalShortcuts();

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
        <div className="min-h-0 flex-1">{workspace.status === 'analyzing' ? <AnalysisProgress /> : <WelcomeScreen />}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <div className="w-[264px] shrink-0">
            <FileExplorer />
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
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
          <div className="w-[328px] shrink-0">
            <DetailsPanel />
          </div>
        )}
      </div>
      <CommandPalette />
      <ConfirmDialog />
    </div>
  );
}
