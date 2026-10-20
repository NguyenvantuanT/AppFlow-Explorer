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
import { useEffect, useMemo, useRef } from 'react';
import { useExplorer } from '../store';
import { CloseIcon, FileIcon, PhoneIcon } from './icons';

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

export function CodePanel() {
  const code = useExplorer((s) => s.code);
  const index = useExplorer((s) => s.index);
  const closeCode = useExplorer((s) => s.closeCode);
  const select = useExplorer((s) => s.select);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ensureFileContent = useExplorer((s) => s.ensureFileContent);
  const loaded = useExplorer((s) => (code ? s.fileContents[code.fileId] : undefined));
  const file = code ? index.filesById.get(code.fileId) : undefined;
  const screensInFile = code ? (index.screensByFile.get(code.fileId) ?? []) : [];
  const content = file?.content ?? loaded?.content;

  // Analysis results do not carry source text: fetch the one file being viewed.
  useEffect(() => {
    if (code && file && file.content === undefined) void ensureFileContent(code.fileId);
  }, [code, file, ensureFileContent]);

  const highlighted = useMemo(() => {
    if (content === undefined || !file) return null;
    const name = HLJS_LANGUAGE[file.language] ?? file.language;
    const lang = hljs.getLanguage(name) ? name : null;
    // highlight.js escapes the source, so the result is safe to inject.
    const html = lang ? hljs.highlight(content, { language: lang }).value : escapeHtml(content);
    return { html, lineCount: content.split('\n').length };
  }, [file, content]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !code?.line) return;
    el.scrollTo({ top: Math.max(0, (code.line - 1) * LINE_HEIGHT - el.clientHeight / 3), behavior: 'smooth' });
  }, [code, highlighted]);

  if (!code) return null;

  const start = code.line;
  const end = code.endLine ?? code.line;

  return (
    <section className="flex h-full flex-col border-t border-line bg-[#0b1120]" aria-label="Code viewer">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <FileIcon size={13} className="text-[#4fc3f7]" />
        <span className="truncate font-mono text-[12px] text-ink">{code.fileId}</span>
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
        <span className="ml-auto text-[11px] text-muted">Read-only</span>
        <button type="button" onClick={closeCode} aria-label="Close code viewer" className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <CloseIcon size={14} />
        </button>
      </header>

      {!file ? (
        <div className="p-4 text-ink-2">File not found in the analyzed project.</div>
      ) : !highlighted ? (
        <div className="p-4 text-ink-2">
          {loaded?.status === 'loading'
            ? 'Loading file from the local agent…'
            : loaded?.status === 'error'
              ? `Could not load this file: ${loaded.error}`
              : 'Preview not available for this file type.'}
        </div>
      ) : (
        <div ref={scrollRef} className="code-view relative min-h-0 flex-1 overflow-auto">
          <div className="relative flex min-w-max font-mono text-[12.5px]" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
            {start !== undefined && (
              <div
                className="pointer-events-none absolute left-0 right-0 border-l-2 border-primary bg-primary/12"
                style={{ top: 8 + (start - 1) * LINE_HEIGHT, height: (end! - start + 1) * LINE_HEIGHT }}
                data-testid="code-highlight"
              />
            )}
            <div className="sticky left-0 z-[1] select-none bg-[#0b1120] py-2 pl-3 pr-4 text-right text-muted/70" aria-hidden>
              {Array.from({ length: highlighted.lineCount }, (_, i) => (
                <div key={i} className={start !== undefined && i + 1 >= start && i + 1 <= end! ? 'text-ink' : undefined}>
                  {i + 1}
                </div>
              ))}
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
