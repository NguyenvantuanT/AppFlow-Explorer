import type { CodeIndex, Located } from '../../core/codeIndex';
import type { CallFact, ClassFact, FileFacts } from '../../parsing/facts';

export interface GoRouteDecl {
  /** Full path, with parent paths of nested routes applied. */
  path: string;
  name?: string;
  target: string | null;
  file: string;
  line: number;
}

/**
 * Collects go_router `GoRoute` declarations. Nested routes (`routes: [...]`
 * inside a GoRoute) get their parent's path prepended, as go_router does.
 */
export function collectGoRoutes(index: CodeIndex, widgets: Map<string, Located<ClassFact>>): { routes: GoRouteDecl[]; initialLocation?: string } {
  const routes: GoRouteDecl[] = [];
  let initialLocation: string | undefined;

  for (const [file, facts] of index.files) {
    const fullPaths = new Map<number, string | null>();
    const fullPath = (call: CallFact): string | null => {
      if (fullPaths.has(call.index)) return fullPaths.get(call.index)!;
      const own = index.resolveString(call.args.find((a) => a.label === 'path')).value;
      let result: string | null = own ?? null;
      if (own !== undefined && !own.startsWith('/')) {
        const parent = parentRoute(facts, call);
        const base = parent ? fullPath(parent) : '';
        result = base === null ? null : `${base === '/' ? '' : (base ?? '')}/${own}`;
      }
      fullPaths.set(call.index, result);
      return result;
    };

    for (const call of facts.calls) {
      if (call.name === 'GoRouter' && call.isInstantiation) {
        initialLocation ??= index.resolveString(call.args.find((a) => a.label === 'initialLocation')).value;
      }
      if (call.name !== 'GoRoute' || !call.isInstantiation) continue;
      const path = fullPath(call);
      if (path === null) continue;
      const builder = call.args.find((a) => a.label === 'builder' || a.label === 'pageBuilder');
      routes.push({
        path,
        name: index.resolveString(call.args.find((a) => a.label === 'name')).value,
        target: builder?.typeRefs.find((t) => widgets.has(t)) ?? null,
        file,
        line: call.line,
      });
    }
  }
  return { routes, initialLocation };
}

function parentRoute(facts: FileFacts, call: CallFact): CallFact | undefined {
  let p = call.parentCall;
  while (p !== undefined) {
    const parent = facts.calls[p];
    if (!parent) return undefined;
    if (parent.name === 'GoRoute') return parent;
    p = parent.parentCall;
  }
  return undefined;
}
