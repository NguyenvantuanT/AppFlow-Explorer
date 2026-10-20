/** File types an exported flow map can be saved as. */
export const EXPORT_TYPES = {
  json: 'JSON',
  md: 'Markdown',
  mmd: 'Mermaid diagram',
  svg: 'SVG image',
} as const;

export type ExportExtension = keyof typeof EXPORT_TYPES;

export interface SaveFileRequest {
  suggestedName: string;
  content: string;
  extension: ExportExtension;
}

/** Large projects export to a few MB; anything far beyond that is not an export. */
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

/** Validates an untrusted request from the renderer. The user still picks the destination. */
export function parseSaveRequest(input: unknown): SaveFileRequest | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r['extension'] !== 'string' || !Object.hasOwn(EXPORT_TYPES, r['extension'])) return null;
  if (typeof r['content'] !== 'string' || r['content'].length > MAX_EXPORT_BYTES) return null;
  if (typeof r['suggestedName'] !== 'string') return null;
  return { suggestedName: safeFileName(r['suggestedName'], r['extension'] as ExportExtension), content: r['content'], extension: r['extension'] as ExportExtension };
}

/** A bare file name (no directories or reserved characters) ending in the extension. */
export function safeFileName(name: string, extension: ExportExtension): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[\\/:*?"<>|\0-\x1f]/g, '-')
    .replace(/^[.\s-]+/, '')
    .slice(0, 120)
    .trim();
  return `${base || 'flow-map'}.${extension}`;
}
