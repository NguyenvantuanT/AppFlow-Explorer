import type { PlatformId } from '@appflow/model';
import { agentApi } from '../agent/client';
import { useExplorer } from '../store';
import { ImportIcon, SearchIcon, SidebarLeftIcon, SidebarRightIcon, WidgetIcon } from './icons';

const PLATFORM_LABEL: Record<PlatformId, string> = { flutter: 'Flutter', android: 'Android', ios: 'iOS', 'react-native': 'React Native' };

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="8" height="13" rx="2" fill="none" stroke="#3b82f6" strokeWidth="2" />
      <rect x="14" y="8" width="8" height="13" rx="2" fill="none" stroke="#22c55e" strokeWidth="2" />
      <path d="M10 9.5h4" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TopBar() {
  const project = useExplorer((s) => s.project);
  const workspace = useExplorer((s) => s.workspace);
  const setPaletteOpen = useExplorer((s) => s.setPaletteOpen);
  const openProjectFolder = useExplorer((s) => s.openProjectFolder);
  const leftOpen = useExplorer((s) => s.leftPanelOpen);
  const rightOpen = useExplorer((s) => s.rightPanelOpen);
  const toggleLeft = useExplorer((s) => s.toggleLeftPanel);
  const toggleRight = useExplorer((s) => s.toggleRightPanel);
  const isMac = typeof window !== 'undefined' && window.appflow?.platform === 'darwin';
  const showsProject = workspace.status === 'demo' || workspace.status === 'ready' || (workspace.hasResult && workspace.status !== 'welcome');
  const platforms = project.platforms?.length ? project.platforms : [project.framework];

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight text-white">AppFlow Explorer</span>
        <span className="rounded-md bg-raised px-1.5 py-px text-[10px] font-medium text-ink-2">Beta</span>
      </div>
      {showsProject && (
        <>
          <div className="h-5 w-px bg-line" />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-ink" title={project.rootPath}>
              {project.name}
            </span>
            {platforms.map((p) => (
              <span key={p} className="rounded border border-[#2a5a8a] bg-[#0f2a44] px-1.5 py-px text-[10px] font-semibold text-[#7cc4ff]">
                {PLATFORM_LABEL[p]}
              </span>
            ))}
            {project.source === 'mock' && (
              <span
                className="rounded border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] font-semibold text-warning"
                title="Bundled demo dataset. No real project has been analyzed; previews and runtime observations are illustrative."
              >
                Mock data
              </span>
            )}
          </div>

          <div className="flex h-full items-center">
            <span className="flex h-full items-center gap-1.5 border-b-2 border-primary px-3 text-[13px] font-medium text-primary">
              <WidgetIcon size={14} /> Flow Map
            </span>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex w-[320px] max-w-[32vw] items-center gap-2 rounded-md border border-line bg-bg px-3 py-1.5 text-left text-muted hover:border-line-strong"
          >
            <SearchIcon size={14} />
            <span className="flex-1 truncate">Search screens, routes, files…</span>
            <kbd className="rounded border border-line px-1.5 font-mono text-[10px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
        </>
      )}

      <div className={`flex items-center gap-1 ${showsProject ? '' : 'ml-auto'}`}>
        {showsProject && (
          <button
            type="button"
            disabled={!agentApi.available() || workspace.status === 'analyzing'}
            onClick={() => void openProjectFolder()}
            title={agentApi.available() ? 'Open and analyze a project folder' : 'Opening folders requires the desktop app'}
            className="mr-2 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ImportIcon size={13} /> Open project
          </button>
        )}
        {showsProject && (
          <>
            <button
              type="button"
              onClick={toggleLeft}
              aria-pressed={leftOpen}
              title="Toggle file explorer"
              className={`rounded p-1.5 hover:bg-raised ${leftOpen ? 'text-ink' : 'text-muted'}`}
            >
              <SidebarLeftIcon size={16} />
            </button>
            <button
              type="button"
              onClick={toggleRight}
              aria-pressed={rightOpen}
              title="Toggle details panel"
              className={`rounded p-1.5 hover:bg-raised ${rightOpen ? 'text-ink' : 'text-muted'}`}
            >
              <SidebarRightIcon size={16} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
