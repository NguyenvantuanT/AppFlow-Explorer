import type { Confidence, DiscoveredUiState, NavigationEdge, Screen, UiStateKind } from '@appflow/model';
import type { FileFacts } from '../parsing/facts';

/**
 * A code pattern that shows a screen has a given UI state. Adapters provide
 * rules for their framework; matching is framework-independent, so a new
 * adapter (React Native, Android…) only declares patterns.
 */
export interface UiStateRule {
  kind: UiStateKind;
  label: string;
  pattern: RegExp;
  confidence: Confidence;
}

/** Fallback scan length when a screen's declaration range is unknown. */
const FALLBACK_LINES = 200;
const COMMENT = /^\s*(\/\/|\*|\/\*|#)/;

/**
 * Line ranges that make up a screen in its file: its class or function and
 * companion classes (a Flutter `State<HomeScreen>`).
 */
export function screenRanges(screen: Screen, facts: FileFacts | null, lineCount: number): Array<[number, number]> {
  const name = screen.widgetClass;
  const ranges: Array<[number, number]> = [];
  for (const c of facts?.classes ?? []) {
    if (c.name === name || c.supertypeArgs.includes(name)) ranges.push([c.line, c.endLine]);
  }
  for (const f of facts?.functions ?? []) {
    if (f.name === name && !f.enclosingClass) ranges.push([f.line, f.endLine]);
  }
  if (ranges.length) return ranges;
  // Unknown extent (e.g. `const Screen = () => …`): scan until the next declaration.
  const start = screen.location.line;
  const next = [...(facts?.classes ?? []), ...(facts?.functions ?? []).filter((f) => !f.enclosingClass)]
    .map((d) => d.line)
    .filter((l) => l > start)
    .sort((a, b) => a - b)[0];
  return [[start, Math.min(next ? next - 1 : lineCount, start + FALLBACK_LINES, lineCount)]];
}

/**
 * UI states of one screen: the first match of each rule kind inside the
 * screen's code. Dialogs and sheets already drawn as resolved connections from
 * the same call are skipped so they are not reported twice.
 */
export function discoverUiStates(screen: Screen, text: string, facts: FileFacts | null, rules: UiStateRule[], outgoing: NavigationEdge[] = []): DiscoveredUiState[] {
  const lines = text.split(/\r?\n/);
  const file = screen.location.fileId;
  const drawnAt = new Set(outgoing.filter((e) => e.kind === 'modal' && e.to !== null && e.trigger.location?.fileId === file).map((e) => e.trigger.location!.line));
  // `class X extends DialogFragment` names a supertype, not a state.
  const declarations = new Set((facts?.classes ?? []).map((c) => c.line));
  const found = new Map<UiStateKind, DiscoveredUiState>();
  const ranges = screenRanges(screen, facts, lines.length).sort((a, b) => a[0] - b[0]);
  for (const [from, to] of ranges) {
    for (let n = from; n <= to && n <= lines.length; n++) {
      const line = lines[n - 1]!;
      if (COMMENT.test(line) || declarations.has(n)) continue;
      for (const rule of rules) {
        if (found.has(rule.kind)) continue;
        if ((rule.kind === 'dialog' || rule.kind === 'bottomSheet') && drawnAt.has(n)) continue;
        const m = rule.pattern.exec(line);
        if (!m) continue;
        found.set(rule.kind, { id: rule.kind, kind: rule.kind, label: rule.label, detail: m[0].trim().slice(0, 60), location: { fileId: file, line: n }, confidence: rule.confidence });
      }
    }
  }
  const order = rules.map((r) => r.kind);
  return [...found.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
