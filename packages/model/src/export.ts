import { featureOf, type FlowGraph, type FlowNodeType } from './flow';
import { edgeStatus } from './graph';
import { coverageReport, unresolvedReport, UNRESOLVED_CATEGORY_LABELS } from './report';
import type { AppProject, EdgeStatus, SourceLocation } from './types';

/**
 * Flow-map exports. They are built locally from the analysis result and
 * contain names, file paths and line numbers, never file contents. The
 * absolute project path is left out so an export does not reveal where the
 * project lives on the machine.
 */

export type ExportFormat = 'json' | 'markdown' | 'mermaid' | 'svg';

export interface ExportOptions {
  featureOverrides?: Record<string, string>;
  /** Canvas positions to include (JSON), or to draw (SVG). */
  positions?: Record<string, { x: number; y: number }>;
  /** The drawn graph (SVG only). */
  graph?: FlowGraph;
  /** Node box size per node type (SVG only). */
  nodeSize?: (type: FlowNodeType) => { width: number; height: number };
  /** Clock for the export timestamp (tests pass a fixed one). */
  now?: () => Date;
}

export const EXPORT_FORMAT_VERSION = 'appflow-map/1';

const where = (loc?: SourceLocation) => (loc ? `${loc.fileId}:${loc.line}` : undefined);

export function exportJson(project: AppProject, options: ExportOptions = {}): string {
  const overrides = options.featureOverrides ?? {};
  const doc = {
    format: EXPORT_FORMAT_VERSION,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    project: { name: project.name, framework: project.framework, platforms: project.platforms ?? [project.framework], analyzedAt: project.analyzedAt },
    screens: project.screens.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      route: s.route,
      feature: featureOf(s, overrides),
      entryPoint: s.isEntryPoint,
      source: where(s.location),
      uiStates: (s.discoveredStates ?? []).map((st) => ({ kind: st.kind, label: st.label, source: where(st.location) })),
      ...(options.positions?.[s.id] ? { position: options.positions[s.id] } : {}),
    })),
    connections: project.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      status: edgeStatus(e),
      trigger: e.trigger.label,
      source: where(e.trigger.location),
      ...(e.to === null ? { unresolvedReason: e.unresolvedReason } : {}),
    })),
    deepLinks: (project.deepLinks ?? []).map((d) => ({ url: d.url, platform: d.platform, screen: d.screenId, source: where(d.location) })),
    coverage: coverageReport(project),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const STATUS_LABEL: Record<EdgeStatus, string> = { verified: 'Verified', manual: 'Manual', declared: 'Declared', inferred: 'Inferred', unresolved: 'Unresolved' };
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function exportMarkdown(project: AppProject, options: ExportOptions = {}): string {
  const names = new Map(project.screens.map((s) => [s.id, s.name]));
  const cov = coverageReport(project);
  const unresolved = unresolvedReport(project);
  const lines: string[] = [
    `# ${project.name} — App flow map`,
    '',
    `Exported ${(options.now?.() ?? new Date()).toISOString()}${project.analyzedAt ? ` from the analysis of ${project.analyzedAt}` : ''}.`,
    '',
    '## Coverage',
    '',
    `- Screens: ${cov.screens.total} (${cov.screens.byKind.page} pages, ${cov.screens.byKind.dialog} dialogs, ${cov.screens.byKind.bottomSheet} bottom sheets), ${cov.screens.entryPoints} start screen(s)`,
    `- Reachable from a start screen: ${cov.screens.reachable} of ${cov.screens.total}`,
    `- Captured at runtime: ${cov.screens.captured} of ${cov.screens.total}`,
    `- Connections: ${cov.edges.total} — ${(Object.keys(STATUS_LABEL) as EdgeStatus[]).map((s) => `${cov.edges.byStatus[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}`,
    `- Deep links: ${cov.deepLinks.total} (${cov.deepLinks.resolved} with a known screen)`,
    '',
    '## Screens',
    '',
    '| Screen | Kind | Route | UI states | Source |',
    '| --- | --- | --- | --- | --- |',
    ...project.screens.map(
      (s) =>
        `| ${cell(s.name)}${s.isEntryPoint ? ' (start)' : ''} | ${s.kind} | ${cell(s.route ?? '')} | ${cell((s.discoveredStates ?? []).map((st) => st.label).join(', '))} | ${where(s.location)} |`,
    ),
    '',
    '## Connections',
    '',
    '| From | To | Trigger | Status | Source |',
    '| --- | --- | --- | --- | --- |',
    ...project.edges.map(
      (e) =>
        `| ${cell(names.get(e.from) ?? e.from)} | ${cell(e.to === null ? 'Unknown destination' : names.get(e.to) ?? e.to)} | ${cell(e.trigger.label)} | ${STATUS_LABEL[edgeStatus(e)]} | ${where(e.trigger.location) ?? ''} |`,
    ),
  ];
  if (unresolved.flows.length) {
    lines.push('', '## Unresolved flows', '');
    for (const f of unresolved.flows) lines.push(`- **${f.fromName}** — ${f.trigger} (${UNRESOLVED_CATEGORY_LABELS[f.category]}): ${f.reason}${f.location ? ` — ${where(f.location)}` : ''}`);
  }
  if (project.deepLinks?.length) {
    lines.push('', '## Deep links', '');
    for (const d of project.deepLinks) lines.push(`- \`${d.url}\` (${d.platform}) → ${d.screenId ? names.get(d.screenId) ?? d.screenId : `unknown: ${d.unresolvedReason ?? 'routed at runtime'}`}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Mermaid flowchart; unresolved targets become one placeholder node per call. */
export function exportMermaid(project: AppProject): string {
  const ids = new Map(project.screens.map((s, i) => [s.id, `s${i}`]));
  const label = (text: string) => `"${text.replace(/"/g, '#quot;')}"`;
  const lines = ['flowchart LR'];
  for (const s of project.screens) {
    const id = ids.get(s.id)!;
    const shape = s.kind === 'page' ? `[${label(s.name)}]` : `([${label(s.name)}])`;
    lines.push(`  ${id}${shape}`);
    if (s.isEntryPoint) lines.push(`  style ${id} stroke-width:3px`);
  }
  let unknown = 0;
  project.edges.forEach((e) => {
    const from = ids.get(e.from);
    if (!from) return;
    let to = e.to === null ? undefined : ids.get(e.to);
    if (!to) {
      to = `u${unknown++}`;
      lines.push(`  ${to}{{"?"}}`);
    }
    const status = edgeStatus(e);
    const arrow = status === 'verified' || status === 'declared' ? '-->' : '-.->';
    lines.push(`  ${from} ${arrow}|${label(`${e.trigger.label || e.kind} · ${status}`)}| ${to}`);
  });
  return `${lines.join('\n')}\n`;
}

const STATUS_COLOR: Record<EdgeStatus, string> = { verified: '#3b82f6', manual: '#5eead4', declared: '#c4b5fd', inferred: '#a9bce6', unresolved: '#f59e0b' };
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The canvas as a standalone SVG: feature boxes, screens and connections at
 * their current positions. Nodes without a position are left out.
 */
export function exportSvg(project: AppProject, options: ExportOptions = {}): string {
  const graph = options.graph;
  const positions = options.positions ?? {};
  const sizeOf = options.nodeSize ?? ((type: FlowNodeType) => (type === 'screen' ? { width: 220, height: 520 } : { width: 180, height: 64 }));
  if (!graph) throw new Error('An SVG export needs the drawn graph.');
  const names = new Map(project.screens.map((s) => [s.id, s]));
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const n of graph.nodes) {
    const p = positions[n.id];
    if (p) boxes.set(n.id, { ...p, ...sizeOf(n.type) });
  }
  if (!boxes.size) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n';
  const all = [...boxes.values()];
  const pad = 48;
  const minX = Math.min(...all.map((b) => b.x)) - pad;
  const minY = Math.min(...all.map((b) => b.y)) - pad;
  const width = Math.max(...all.map((b) => b.x + b.width)) - minX + pad;
  const height = Math.max(...all.map((b) => b.y + b.height)) - minY + pad;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}" font-family="Inter, system-ui, sans-serif">`,
    `<title>${xml(project.name)} — App flow map</title>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#0b1222"/>`,
    '<defs>',
    ...(Object.keys(STATUS_COLOR) as EdgeStatus[]).map((s) => `<marker id="arrow-${s}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${STATUS_COLOR[s]}"/></marker>`),
    '</defs>',
  ];
  for (const g of graph.groups) {
    const members = g.nodeIds.map((id) => boxes.get(id)).filter((b) => !!b);
    if (!members.length) continue;
    const x = Math.min(...members.map((b) => b.x)) - 24;
    const y = Math.min(...members.map((b) => b.y)) - 40;
    const w = Math.max(...members.map((b) => b.x + b.width)) - x + 24;
    const h = Math.max(...members.map((b) => b.y + b.height)) - y + 24;
    out.push(`<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#3d5486" fill-opacity="0.12" stroke="#3d5486"/><text x="${x + 16}" y="${y + 26}" fill="#aab4c8" font-size="14" font-weight="600">${xml(g.label)}</text></g>`);
  }
  for (const e of graph.edges) {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    if (!a || !b) continue;
    const x1 = a.x + a.width;
    const y1 = a.y + Math.min(a.height / 2, 232);
    const x2 = b.x;
    const y2 = b.y + Math.min(b.height / 2, 232);
    const dash = e.status === 'inferred' || e.status === 'unresolved' ? ' stroke-dasharray="6 5"' : '';
    out.push(`<path d="M${x1} ${y1} C${x1 + 60} ${y1} ${x2 - 60} ${y2} ${x2} ${y2}" fill="none" stroke="${STATUS_COLOR[e.status]}" stroke-width="2"${dash} marker-end="url(#arrow-${e.status})"><title>${xml(`${e.label} (${e.status})`)}</title></path>`);
  }
  for (const n of graph.nodes) {
    const b = boxes.get(n.id);
    if (!b) continue;
    const screen = n.screenId ? names.get(n.screenId) : undefined;
    const label = n.type === 'unresolved' ? 'Unknown destination' : (screen?.name ?? n.id);
    const stroke = n.type === 'unresolved' ? '#f59e0b' : screen?.isEntryPoint && n.type === 'screen' ? '#22c55e' : '#5f78b0';
    const rx = n.type === 'screen' ? 28 : 10;
    const dash = n.type === 'screen' && screen?.kind !== 'page' ? ' stroke-dasharray="8 6"' : n.type !== 'screen' ? ' stroke-dasharray="4 4"' : '';
    out.push(`<g><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" fill="#131d33" stroke="${stroke}" stroke-width="3"${dash}/>`);
    out.push(`<text x="${b.x + b.width / 2}" y="${b.y + (n.type === 'screen' ? 40 : b.height / 2 + 5)}" text-anchor="middle" fill="#e6ebf5" font-size="15" font-weight="600">${xml(label)}</text>`);
    if (n.type === 'screen' && screen?.route) out.push(`<text x="${b.x + b.width / 2}" y="${b.y + 62}" text-anchor="middle" fill="#93b8ff" font-size="12" font-family="monospace">${xml(screen.route)}</text>`);
    if (n.type === 'screen' && screen?.discoveredStates?.length) {
      screen.discoveredStates.slice(0, 8).forEach((st, i) => out.push(`<text x="${b.x + 18}" y="${b.y + 100 + i * 20}" fill="#aab4c8" font-size="12">• ${xml(st.label)}</text>`));
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

export function exportFlowMap(format: ExportFormat, project: AppProject, options: ExportOptions = {}): { content: string; extension: string; mimeType: string } {
  switch (format) {
    case 'json':
      return { content: exportJson(project, options), extension: 'json', mimeType: 'application/json' };
    case 'markdown':
      return { content: exportMarkdown(project, options), extension: 'md', mimeType: 'text/markdown' };
    case 'mermaid':
      return { content: exportMermaid(project), extension: 'mmd', mimeType: 'text/plain' };
    case 'svg':
      return { content: exportSvg(project, options), extension: 'svg', mimeType: 'image/svg+xml' };
  }
}
