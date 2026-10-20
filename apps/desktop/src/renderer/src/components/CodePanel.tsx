import { relocate, sourceMarkers, type RelocatedRange, type SourceMarker } from '@appflow/model';
import hljs from 'highlight.js/lib/core';
import dart from 'highlight.js/lib/languages/dart';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import groovy from 'highlight.js/lib/languages/groovy';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import objectivec from 'highlight.js/lib/languages/objectivec';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorId } from '../agent/client';
import { useExplorer, type CodeTarget } from '../store';
import { AlertIcon, CloseIcon, FileIcon, PhoneIcon } from './icons';

hljs.registerLanguage('dart', dart);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('java', java);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('objectivec', objectivec);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('groovy', groovy);

/** Model language → highlight.js language. */
const HLJS_LANGUAGE: Record<string, string> = { objc: 'objectivec', gradle: 'groovy', plist: 'xml' };

const LINE_HEIGHT = 20;

const MARKER_GLYPH: Record<SourceMarker['kind'], string> = { screen: '▣', edge: '→', route: '#' };
const MARKER_TITLE: Record<SourceMarker['kind'], string> = { screen: 'Screen', edge: 'Navigation', route: 'Route declaration' };
const MARKER_COLOR: Record<SourceMarker['kind'], string> = { screen: 'text-success', edge: 'text-[#93c5fd]', route: 'text-[#c4b5fd]' };

export function CodePanel() {
  const code = useExplorer((s) => s.code);
  const index = useExplorer((s) => s.index);
  const project = useExplorer((s) => s.project);
  const closeCode = useExplorer((s) => s.closeCode);
  const select = useExplorer((s) => s.select);
  const revealSource = useExplorer((s) => s.revealSource);
  const reloadFile = useExplorer((s) => s.reloadFile);
  const reanalyze = useExplorer((s) => s.reanalyze);
  const canReanalyze = useExplorer((s) => s.workspace.hasResult && s.project.source === 'analysis');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ensureFileContent = useExplorer((s) => s.ensureFileContent);
  const loaded = useExplorer((s) => (code ? s.fileContents[code.fileId] : undefined));
  const file = code ? index.filesById.get(code.fileId) : undefined;
  const screensInFile = code ? (index.screensByFile.get(code.fileId) ?? []) : [];
  const content = file?.content ?? loaded?.content;
  // Inline content (demo data) is what was analyzed; fetched content is compared by hash.
  const changed = !!file && file.content === undefined && !!loaded?.hash && !!file.contentHash && loaded.hash !== file.contentHash;
  const unchanged = !!file && (file.content !== undefined || (!!loaded?.hash && loaded.hash === file.contentHash));

  // Analysis results do not carry source text: fetch the one file being viewed.
  useEffect(() => {
    if (code && file && file.content === undefined) void ensureFileContent(code.fileId);
  }, [code, file, ensureFileContent]);

  useEffect(() => setNotice(null), [code]);

  const highlighted = useMemo(() => {
    if (content === undefined || !file) return null;
    const name = HLJS_LANGUAGE[file.language] ?? file.language;
    const lang = hljs.getLanguage(name) ? name : null;
    // highlight.js escapes the source, so the result is safe to inject.
    const html = lang ? hljs.highlight(content, { language: lang }).value : escapeHtml(content);
    return { html, lineCount: content.split('\n').length };
  }, [file, content]);

  // Where the requested range is now, if the file changed after analysis.
  const range = useMemo<RelocatedRange | null>(() => {
    if (!code?.line || content === undefined) return null;
    return relocate({ line: code.line, endLine: code.endLine, anchor: code.anchor }, content, unchanged);
  }, [code, content, unchanged]);

  // Screens, navigation calls and routes in this file, at their current lines.
  const markers = useMemo(() => {
    const byLine = new Map<number, SourceMarker[]>();
    if (!code || content === undefined) return byLine;
    for (const m of sourceMarkers(project, code.fileId)) {
      const at = relocate(m.location, content, unchanged);
      if (at.status === 'stale') continue; // the code it pointed to is gone
      byLine.set(at.line, [...(byLine.get(at.line) ?? []), m]);
    }
    return byLine;
  }, [project, code, content, unchanged]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !range) return;
    el.scrollTo({ top: Math.max(0, (range.line - 1) * LINE_HEIGHT - el.clientHeight / 3), behavior: 'smooth' });
  }, [range, highlighted]);

  if (!code) return null;

  const start = range?.line;
  const end = range?.endLine;
  const onLine = (line: number) => setNotice(revealSource(code.fileId, line) ? null : `Nothing on the map corresponds to line ${line}.`);
  const openMarker = (m: SourceMarker) => {
    if (m.kind === 'route') {
      const screenId = project.routes?.find((r) => r.id === m.id)?.screenId;
      if (screenId) select({ kind: 'screen', id: screenId }, { focus: true });
      else setNotice(`Route ${m.label} does not lead to a known screen.`);
      return;
    }
    select({ kind: m.kind, id: m.id }, { focus: true });
  };

  return (
    <section className="flex h-full flex-col border-t border-line bg-[#0b1120]" aria-label="Code viewer">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <FileIcon size={13} className="text-[#4fc3f7]" />
        <span className="truncate font-mono text-[12px] text-ink" title={file?.path}>
          {code.fileId}
        </span>
        {start && <span className="font-mono text-[11px] text-muted">:{start}</span>}
        <div className="ml-3 flex min-w-0 items-center gap-1 overflow-hidden">
          {screensInFile.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select({ kind: 'screen', id: s.id }, { focus: true, openCode: true })}
              className="flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-px text-[11px] text-ink-2 hover:border-primary hover:text-ink"
              title="Show on canvas"
            >
              <PhoneIcon size={11} /> {s.name}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-[11px] text-muted">Read-only</span>
        <EditorButton target={{ ...code, line: start ?? code.line }} />
        <button type="button" onClick={closeCode} aria-label="Close code viewer" className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <CloseIcon size={14} />
        </button>
      </header>

      {changed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11.5px] text-ink-2" data-testid="stale-banner">
          <AlertIcon size={13} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            This file changed after it was analyzed.{' '}
            {range?.status === 'moved'
              ? `The highlighted code moved from line ${code.line} to line ${range.line}.`
              : range?.status === 'stale'
                ? `The code analyzed at line ${code.line} is no longer there; the highlight may point to different code.`
                : range?.status === 'exact'
                  ? 'The highlighted line is unchanged.'
                  : 'Line numbers may be out of date.'}{' '}
            Re-analyze to update the map.
          </span>
          {canReanalyze && (
            <button type="button" className="shrink-0 rounded border border-line-strong px-2 py-px hover:bg-raised" onClick={() => void reanalyze()}>
              Re-analyze
            </button>
          )}
        </div>
      )}
      {notice && <div className="shrink-0 border-b border-line bg-panel px-3 py-1 text-[11.5px] text-ink-2">{notice}</div>}

      {!file ? (
        <div className="p-4 text-ink-2">This file is not part of the analyzed project, so it cannot be shown.</div>
      ) : !highlighted ? (
        <div className="flex items-center gap-3 p-4 text-ink-2">
          {loaded?.status === 'loading'
            ? 'Loading file from the local agent…'
            : loaded?.status === 'error'
              ? `Could not load this file: ${loaded.error}`
              : 'Preview not available for this file type.'}
          {loaded?.status === 'error' && (
            <button type="button" className="rounded border border-line-strong px-2 py-px text-[12px] hover:bg-raised" onClick={() => void reloadFile(code.fileId)}>
              Retry
            </button>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="code-view relative min-h-0 flex-1 overflow-auto">
          <div className="relative flex min-w-max font-mono text-[12.5px]" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
            {start !== undefined && end !== undefined && (
              <div
                className={`pointer-events-none absolute left-0 right-0 border-l-2 ${range?.status === 'stale' ? 'border-warning bg-warning/10' : 'border-primary bg-primary/12'}`}
                style={{ top: 8 + (start - 1) * LINE_HEIGHT, height: (end - start + 1) * LINE_HEIGHT }}
                data-testid="code-highlight"
                data-status={range?.status}
              />
            )}
            <div className="sticky left-0 z-[1] flex select-none bg-[#0b1120] py-2 pl-1">
              <div className="w-5 text-center" aria-label="Map markers">
                {Array.from({ length: highlighted.lineCount }, (_, i) => {
                  const here = markers.get(i + 1);
                  const first = here?.[0];
                  return (
                    <div key={i} style={{ height: LINE_HEIGHT }}>
                      {first && (
                        <button
                          type="button"
                          onClick={() => openMarker(first)}
                          title={`${here.map((m) => `${MARKER_TITLE[m.kind]}: ${m.label}`).join('\n')}\nShow on the map`}
                          className={`w-5 text-[11px] hover:text-white ${MARKER_COLOR[first.kind]}`}
                          style={{ lineHeight: `${LINE_HEIGHT}px` }}
                          data-testid={`marker-${i + 1}`}
                        >
                          {MARKER_GLYPH[first.kind]}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="pl-1 pr-4 text-right text-muted/70">
                {Array.from({ length: highlighted.lineCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onLine(i + 1)}
                    title="Show this code on the map"
                    style={{ height: LINE_HEIGHT }}
                    className={`block w-full text-right hover:text-[#93c5fd] ${start !== undefined && i + 1 >= start && i + 1 <= end! ? 'text-ink' : ''}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
            <pre className="m-0 py-2 pr-6 text-[#d6deeb]">
              <code dangerouslySetInnerHTML={{ __html: highlighted.html }} />
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

const EDITOR_NAME: Record<EditorId, string> = { vscode: 'VS Code', cursor: 'Cursor' };

/** "Open in VS Code" with a choice of editor; the main process checks the path before opening. */
export function EditorButton({ target, compact = false }: { target: CodeTarget; compact?: boolean }) {
  const editor = useExplorer((s) => s.editor);
  const setEditor = useExplorer((s) => s.setEditor);
  const openInEditor = useExplorer((s) => s.openInEditor);
  const status = useExplorer((s) => s.editorStatus);
  const available = useExplorer((s) => s.project.source === 'analysis');
  if (!available) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" title={status && !status.ok ? status.message : undefined}>
      <button
        type="button"
        onClick={() => void openInEditor(target)}
        className="rounded border border-line px-1.5 py-px text-[11px] text-ink-2 hover:border-primary hover:text-ink"
        title={`Open ${target.fileId}${target.line ? `:${target.line}` : ''} in ${EDITOR_NAME[editor]}`}
      >
        {compact ? EDITOR_NAME[editor] : `Open in ${EDITOR_NAME[editor]}`}
      </button>
      {!compact && (
        <select
          aria-label="Editor"
          value={editor}
          onChange={(e) => setEditor(e.target.value as EditorId)}
          className="rounded border border-line bg-panel px-0.5 py-px text-[11px] text-ink-2"
        >
          {(Object.keys(EDITOR_NAME) as EditorId[]).map((id) => (
            <option key={id} value={id}>
              {EDITOR_NAME[id]}
            </option>
          ))}
        </select>
      )}
      {status && !status.ok && <AlertIcon size={12} className="text-warning" />}
    </span>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
