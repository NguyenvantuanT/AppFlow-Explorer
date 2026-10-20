import { useMemo, useState } from 'react';
import { buildFileTree, filterFileTree, folderPaths, type FileTreeNode } from '../lib/fileTree';
import { useExplorer } from '../store';
import { ChevronIcon, FileIcon, FolderIcon, PhoneIcon, SearchIcon } from './icons';

const DEFAULT_OPEN = ['lib', 'lib/features', 'lib/app'];

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const code = useExplorer((s) => s.code);
  const highlightedFileId = useExplorer((s) => s.highlightedFileId);
  const screenCount = useExplorer((s) => (node.kind === 'file' ? (s.index.screensByFile.get(node.path)?.length ?? 0) : 0));
  const openCode = useExplorer((s) => s.openCode);
  const highlightFile = useExplorer((s) => s.highlightFile);
  const select = useExplorer((s) => s.select);

  const pad = { paddingLeft: 8 + depth * 14 };

  if (node.kind === 'folder') {
    const open = expanded.has(node.path);
    return (
      <>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded py-[3px] pr-2 text-left text-ink-2 hover:bg-raised"
          style={pad}
          onClick={() => toggle(node.path)}
          aria-expanded={open}
        >
          <ChevronIcon size={12} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          <FolderIcon size={14} className="shrink-0 text-[#6f8fd6]" />
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} />
          ))}
      </>
    );
  }

  const active = code?.fileId === node.path || highlightedFileId === node.path;
  const isBinary = node.file?.content === undefined;
  return (
    <button
      type="button"
      title={node.file?.path}
      className={`flex w-full items-center gap-1.5 rounded py-[3px] pr-2 text-left ${
        active ? 'bg-primary-soft/70 text-white' : 'text-ink-2 hover:bg-raised'
      }`}
      style={{ paddingLeft: 8 + depth * 14 + 18 }}
      onClick={() => {
        highlightFile(node.path);
        if (!isBinary) openCode({ fileId: node.path });
        select(null);
      }}
    >
      <FileIcon size={14} className={`shrink-0 ${node.name.endsWith('.dart') ? 'text-[#4fc3f7]' : 'text-muted'}`} />
      <span className="truncate">{node.name}</span>
      {screenCount > 0 && (
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-success/10 px-1 text-[10px] text-success"
          title={`${screenCount} screen${screenCount > 1 ? 's' : ''} defined in this file`}
        >
          <PhoneIcon size={10} />
          {screenCount}
        </span>
      )}
    </button>
  );
}

export function FileExplorer() {
  const project = useExplorer((s) => s.project);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(DEFAULT_OPEN));

  const tree = useMemo(() => buildFileTree(project.files), [project.files]);
  const visible = useMemo(() => filterFileTree(tree, query), [tree, query]);
  const effectiveExpanded = useMemo(
    () => (query.trim() && visible ? new Set(folderPaths(visible)) : expanded),
    [query, visible, expanded],
  );

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <aside className="flex h-full flex-col border-r border-line bg-panel" aria-label="Project files">
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <span className="text-[14px] font-semibold text-white">Project Files</span>
        <span className="text-[11px] text-muted">{project.files.length} files</span>
      </div>
      <div className="px-2 pb-2">
        <label className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 focus-within:border-primary">
          <SearchIcon size={13} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files"
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 text-[12.5px]">
        <div className="truncate px-2 pb-1 font-semibold text-ink">{project.name.toLowerCase()}</div>
        {visible && visible.children.length > 0 ? (
          visible.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={0} expanded={effectiveExpanded} toggle={toggle} />
          ))
        ) : (
          <div className="px-3 py-4 text-[12px] text-muted">No files match “{query}”.</div>
        )}
      </div>
      <AnalysisStatus />
    </aside>
  );
}

function AnalysisStatus() {
  const project = useExplorer((s) => s.project);
  const workspace = useExplorer((s) => s.workspace);
  const reanalyze = useExplorer((s) => s.reanalyze);
  const cancelAnalysis = useExplorer((s) => s.cancelAnalysis);
  const isMock = project.source === 'mock';
  const warnings = project.warnings?.filter((w) => w.severity !== 'info').length ?? 0;
  const partial = project.adapters?.some((a) => a.status !== 'complete') ?? false;

  let tone: 'warning' | 'success' | 'danger' | 'primary' = isMock ? 'warning' : partial ? 'warning' : 'success';
  let title = isMock ? 'Mock data loaded' : partial ? 'Analysis partially complete' : 'Analysis complete';
  if (workspace.status === 'analyzing') {
    tone = 'primary';
    title = 'Re-analyzing…';
  } else if (workspace.status === 'error') {
    tone = 'danger';
    title = 'Last analysis failed';
  }
  const toneClass = { warning: 'text-warning', success: 'text-success', danger: 'text-danger', primary: 'text-primary' }[tone];
  const dotClass = { warning: 'bg-warning', success: 'bg-success', danger: 'bg-danger', primary: 'bg-primary' }[tone];

  return (
    <div className="m-3 shrink-0 rounded-lg border border-line bg-bg/60 p-3" data-testid="analysis-status">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={toneClass}>{title}</span>
      </div>
      {workspace.status === 'analyzing' ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(3, workspace.progress?.percent ?? 0)}%` }} />
          </div>
          <p className="mt-1 truncate text-[11.5px] text-ink-2">{workspace.progress?.message}</p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-ink-2">
          {project.screens.length} screens · {project.edges.length} flows{!isMock && ` · ${warnings} warning${warnings === 1 ? '' : 's'}`}
        </p>
      )}
      {workspace.status === 'error' && workspace.error && <p className="mt-1 text-[11.5px] text-danger">{workspace.error}</p>}
      {workspace.status === 'analyzing' ? (
        <button type="button" onClick={() => void cancelAnalysis()} className="mt-3 w-full rounded-md border border-line-strong py-2 text-[12.5px] text-ink hover:bg-raised">
          Cancel
        </button>
      ) : (
        <button
          type="button"
          disabled={isMock || !workspace.projectId}
          onClick={() => void reanalyze()}
          title={isMock ? 'The demo project is not analyzed from source' : 'Run the analysis again'}
          className="mt-3 w-full rounded-md bg-primary py-2 text-[12.5px] font-semibold text-white hover:bg-[#2f74e6] disabled:bg-primary/40 disabled:text-white/70"
        >
          Re-analyze
        </button>
      )}
    </div>
  );
}
