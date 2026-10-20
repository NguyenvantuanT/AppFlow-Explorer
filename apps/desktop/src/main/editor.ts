/** Local editors a source location can be opened in. */
export const EDITORS = {
  vscode: { name: 'Visual Studio Code', scheme: 'vscode' },
  cursor: { name: 'Cursor', scheme: 'cursor' },
} as const;

export type EditorId = keyof typeof EDITORS;

export interface OpenInEditorRequest {
  projectId: string;
  /** Project-relative path, as in analysis results. */
  path: string;
  line?: number;
  column?: number;
  editor: EditorId;
}

/** Validates an untrusted request from the renderer. */
export function parseOpenRequest(input: unknown): OpenInEditorRequest | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  const positive = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < 10_000_000);
  if (typeof r['projectId'] !== 'string' || !/^[\w-]{1,128}$/.test(r['projectId'])) return null;
  if (typeof r['path'] !== 'string' || !r['path'] || r['path'].length > 4096 || r['path'].includes('\0')) return null;
  if (typeof r['editor'] !== 'string' || !(r['editor'] in EDITORS)) return null;
  if (!positive(r['line']) || !positive(r['column'])) return null;
  return { projectId: r['projectId'], path: r['path'], line: r['line'] as number | undefined, column: r['column'] as number | undefined, editor: r['editor'] as EditorId };
}

/**
 * `vscode://file/C:/work/app/lib/main.dart:12:5`. The editor's URL handler
 * opens the file at that position; nothing in the project is executed.
 */
export function editorUrl(editor: EditorId, absolutePath: string, line?: number, column?: number): string {
  const forward = absolutePath.replace(/\\/g, '/');
  const withRoot = forward.startsWith('/') ? forward : `/${forward}`;
  const encoded = withRoot
    .split('/')
    .map((segment, i) => (i === 1 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  const position = line ? `:${line}${column ? `:${column}` : ''}` : '';
  return `${EDITORS[editor].scheme}://file${encoded}${position}`;
}
