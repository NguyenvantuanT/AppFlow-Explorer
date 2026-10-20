import { lookup } from '../shared';
import type { NavigationKind, ScreenKind } from '@appflow/model';
import type { CodeIndex, Located } from '../../core/codeIndex';
import type { ArgFact, CallFact, ClassFact, FileFacts } from '../../parsing/facts';

/** A route declared in an AutoRoute router config (`AutoRoute(page: XRoute.page, path: …)`). */
export interface AutoRouteDecl {
  /** Generated route class, e.g. `LoginRoute`. */
  routeName: string;
  /** Full path with parent paths applied, when declared. */
  path?: string;
  target: string | null;
  kind: ScreenKind;
  initial: boolean;
  /** Route name of the parent route for nested (`children:`) routes. */
  parent?: string;
  file: string;
  line: number;
}

/** AutoRoute navigation methods (StackRouter API and BuildContext extensions) and their kind. */
export const AUTO_NAV: Record<string, NavigationKind> = lookup({
  push: 'push', pushRoute: 'push', navigate: 'push', navigateTo: 'push', pushNamed: 'push', navigateNamed: 'push', pushPath: 'push', navigatePath: 'push',
  replace: 'replace', replaceRoute: 'replace', popAndPush: 'replace', replaceNamed: 'replace',
  pushAndPopUntil: 'reset', replaceAll: 'reset', popAndPushAll: 'reset', pushAll: 'push',
});

const ROUTE_DECL = /Route$/;

/**
 * Collects AutoRoute declarations and the route-class → page-widget mapping.
 * The mapping comes, in order, from: generated `PageRouteInfo` classes
 * (`*.gr.dart`), `PageInfo(XRoute.name, builder: …)` definitions, and finally
 * AutoRoute's naming convention (`LoginRoute` ↔ `LoginPage` / `LoginScreen`).
 */
export function collectAutoRoutes(index: CodeIndex, widgets: Map<string, Located<ClassFact>>) {
  const routeToWidget = new Map<string, string>();
  /** `PageInfo` defined in a getter/variable: name → { route, widget }. */
  const pageInfos = new Map<string, { route?: string; widget?: string }>();

  for (const [, facts] of index.files) {
    for (const call of facts.calls) {
      if (call.name !== 'PageInfo') continue;
      const route = /^(\w+)\.name$/.exec(call.args[0]?.text ?? '')?.[1];
      const widget = call.args.find((a) => a.label === 'builder')?.typeRefs.find((t) => widgets.has(t));
      const owner = call.enclosingFunction ?? facts.variables.find((v) => v.line <= call.line && call.line - v.line < 3)?.name;
      if (route && widget) routeToWidget.set(route, widget);
      if (owner) pageInfos.set(owner, { route, widget });
      // Generated classes: `class LoginRoute extends PageRouteInfo { static PageInfo page = PageInfo(name, builder: …) }`.
      const cls = call.enclosingClass ? index.classNamed(call.enclosingClass)?.fact : undefined;
      if (cls?.supertypes.includes('PageRouteInfo') && widget) routeToWidget.set(cls.name, widget);
    }
  }

  const resolveRoute = (routeName: string): string | null => {
    const mapped = routeToWidget.get(routeName);
    if (mapped) return mapped;
    const base = routeName.replace(/Route$/, '');
    for (const candidate of [`${base}Page`, `${base}Screen`, base, `${base}View`]) if (widgets.has(candidate)) return candidate;
    return null;
  };

  const routes: AutoRouteDecl[] = [];
  for (const [file, facts] of index.files) {
    const byIndex = new Map<number, AutoRouteDecl>();
    for (const call of facts.calls) {
      const pageArg = call.args.find((a) => a.label === 'page');
      if (!call.isInstantiation || !ROUTE_DECL.test(call.name) || !pageArg) continue;
      const routeName = routeNameOf(pageArg, pageInfos);
      if (!routeName) continue;
      const parent = parentDecl(facts, call, byIndex);
      const own = index.resolveString(call.args.find((a) => a.label === 'path')).value;
      const path = own === undefined ? undefined : own.startsWith('/') || !parent?.path ? (own.startsWith('/') ? own : `/${own}`) : `${parent.path.replace(/\/$/, '')}/${own}`;
      const builderText = call.args.find((a) => a.label === 'customRouteBuilder')?.text ?? '';
      const kind: ScreenKind = /Dialog/.test(call.name) ? 'dialog' : /sheet/i.test(call.name) || /sheet/i.test(builderText) ? 'bottomSheet' : 'page';
      const decl: AutoRouteDecl = {
        routeName,
        path,
        target: pageInfos.get(pageArg.text)?.widget ?? resolveRoute(routeName),
        kind,
        initial: call.args.some((a) => a.label === 'initial' && a.text === 'true'),
        parent: parent?.routeName,
        file,
        line: call.line,
      };
      byIndex.set(call.index, decl);
      routes.push(decl);
    }
  }
  return { routes, resolveRoute };
}

function routeNameOf(pageArg: ArgFact, pageInfos: Map<string, { route?: string }>): string | undefined {
  const generated = /^(\w+Route)\.page$/.exec(pageArg.text)?.[1];
  if (generated) return generated;
  return pageInfos.get(pageArg.text)?.route;
}

function parentDecl(facts: FileFacts, call: CallFact, decls: Map<number, AutoRouteDecl>): AutoRouteDecl | undefined {
  for (let p = call.parentCall; p !== undefined; p = facts.calls[p]?.parentCall) {
    const d = decls.get(p);
    if (d) return d;
  }
  return undefined;
}
