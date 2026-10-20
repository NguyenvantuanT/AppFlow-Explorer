import { agentApi } from '../agent/client';
import { useState } from 'react';
import { useExplorer } from '../store';
import { forgetLastProject, loadSession } from '../store/session';
import { ImportIcon, PhoneIcon } from './icons';
import { SampleList } from './SampleProjects';

const PLATFORMS = [
  { name: 'Flutter / Dart', detail: 'Navigator & routes tables, go_router, dialogs and sheets' },
  { name: 'Android', detail: 'Manifest activities, fragments, nav graphs, Compose NavHost' },
  { name: 'iOS', detail: 'Storyboards & segues, UIKit, SwiftUI, Objective-C (basic)' },
  { name: 'React Native', detail: 'React Navigation, Expo Router, native modules' },
];

export function WelcomeScreen() {
  const openProjectFolder = useExplorer((s) => s.openProjectFolder);
  const loadDemo = useExplorer((s) => s.loadDemo);
  const workspace = useExplorer((s) => s.workspace);
  const openProjectPath = useExplorer((s) => s.openProjectPath);
  const canOpen = agentApi.available();
  const [last, setLast] = useState(() => (canOpen ? loadSession().lastProject : undefined));

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-canvas p-8" data-testid="welcome">
      <div className="w-full max-w-[640px]">
        <h1 className="text-[26px] font-semibold text-white">Map an app you just inherited</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Open a project folder to discover its screens, routes and navigation. Everything is analyzed on this computer by a local agent.
        </p>

        {workspace.status === 'error' && workspace.error && (
          <div className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-ink">
            <span className="font-semibold text-danger">Could not analyze the project.</span> {workspace.error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => void openProjectFolder()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#2f74e6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImportIcon size={16} /> Open project folder…
          </button>
          <button
            type="button"
            onClick={() => void loadDemo()}
            className="flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-[14px] text-ink hover:bg-raised"
          >
            <PhoneIcon size={16} /> Explore the demo project
          </button>
        </div>
        {!canOpen && <p className="mt-2 text-[12px] text-muted">Opening folders requires the desktop app.</p>}
        {last && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3" data-testid="reopen-last">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-muted">Last project</div>
              <div className="truncate text-[13px] font-semibold text-ink">{last.name}</div>
              <div className="truncate font-mono text-[11px] text-muted" title={last.path}>
                {last.path}
              </div>
            </div>
            <button type="button" onClick={() => void openProjectPath(last.path)} className="shrink-0 rounded-md bg-primary/15 px-3 py-1.5 text-[12.5px] font-semibold text-primary hover:bg-primary/25">
              Reopen and analyze
            </button>
            <button
              type="button"
              onClick={() => {
                forgetLastProject();
                setLast(undefined);
              }}
              aria-label="Forget the last project"
              className="shrink-0 rounded-md px-2 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
            >
              Forget
            </button>
          </div>
        )}

        <SampleList />

        <div className="mt-8 grid grid-cols-2 gap-3">
          {PLATFORMS.map((p) => (
            <div key={p.name} className="rounded-lg border border-line bg-panel px-4 py-3">
              <div className="text-[13px] font-semibold text-ink">{p.name}</div>
              <div className="mt-0.5 text-[12px] text-ink-2">{p.detail}</div>
            </div>
          ))}
        </div>

        <ul className="mt-6 space-y-1.5 text-[12.5px] text-ink-2">
          <li>• Source code never leaves this computer; only the normalized map is shown.</li>
          <li>• .env files, signing keys and credential files are skipped and never read.</li>
          <li>• Nothing in the project is executed. Relationships found in code are marked as inferred, not verified.</li>
        </ul>
      </div>
    </div>
  );
}

export function AnalysisProgress() {
  const workspace = useExplorer((s) => s.workspace);
  const cancelAnalysis = useExplorer((s) => s.cancelAnalysis);
  const percent = workspace.progress?.percent ?? 0;
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-8" data-testid="analysis-progress">
      <div className="w-full max-w-[460px] rounded-xl border border-line bg-panel p-6 shadow-2xl">
        <div className="text-[15px] font-semibold text-white">Analyzing project</div>
        <div className="mt-1 truncate font-mono text-[12px] text-muted" title={workspace.projectPath}>
          {workspace.projectPath}
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-bg">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, percent)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-ink-2">
          <span className="truncate">{workspace.progress?.message ?? 'Starting…'}</span>
          <span className="font-mono">{percent}%</span>
        </div>
        <button
          type="button"
          onClick={() => void cancelAnalysis()}
          disabled={!workspace.analysisId}
          className="mt-5 rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
