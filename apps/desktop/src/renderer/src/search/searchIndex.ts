import { edgeStatus, type AppProject, type EdgeStatus, type SourceLocation } from '@appflow/model';
import Fuse from 'fuse.js';

export type SearchKind = 'screen' | 'route' | 'file' | 'widget' | 'navigation';

export type SearchTarget =
  | { type: 'screen'; screenId: string; location?: SourceLocation }
  | { type: 'file'; fileId: string }
  | { type: 'edge'; edgeId: string };

export interface SearchItem {
  id: string;
  kind: SearchKind;
  label: string;
  detail: string;
  status?: EdgeStatus;
  target: SearchTarget;
}

export function buildSearchItems(project: AppProject): SearchItem[] {
  const items: SearchItem[] = [];
  const nameOf = (id: string | null) =>
    (id && project.screens.find((s) => s.id === id)?.name) ?? 'Unresolved target';

  for (const screen of project.screens) {
    items.push({
      id: `screen:${screen.id}`,
      kind: 'screen',
      label: screen.name,
      detail: `${screen.widgetClass} · ${screen.location.fileId}`,
      target: { type: 'screen', screenId: screen.id },
    });
    if (screen.route) {
      items.push({
        id: `route:${screen.id}`,
        kind: 'route',
        label: screen.route,
        detail: screen.name,
        target: { type: 'screen', screenId: screen.id },
      });
    }
    for (const widget of screen.keyWidgets) {
      items.push({
        id: `widget:${screen.id}:${widget.name}`,
        kind: 'widget',
        label: widget.name,
        detail: `${screen.name} · ${widget.kind}`,
        target: { type: 'screen', screenId: screen.id, location: widget.location },
      });
    }
  }

  for (const file of project.files) {
    items.push({
      id: `file:${file.id}`,
      kind: 'file',
      label: file.path.split('/').pop() ?? file.path,
      detail: file.path,
      target: { type: 'file', fileId: file.id },
    });
  }

  for (const edge of project.edges) {
    items.push({
      id: `edge:${edge.id}`,
      kind: 'navigation',
      label: `${nameOf(edge.from)} → ${nameOf(edge.to)}`,
      detail: edge.trigger.description,
      status: edgeStatus(edge),
      target: { type: 'edge', edgeId: edge.id },
    });
  }

  return items;
}

const KIND_ORDER: Record<SearchKind, number> = { screen: 0, route: 1, navigation: 2, widget: 3, file: 4 };

export function createSearcher(items: SearchItem[]): (query: string, limit?: number) => SearchItem[] {
  const fuse = new Fuse(items, {
    keys: [
      { name: 'label', weight: 2 },
      { name: 'detail', weight: 1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
  return (query, limit = 40) => {
    const q = query.trim();
    if (!q) {
      return items
        .filter((i) => i.kind === 'screen')
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, limit);
    }
    return fuse
      .search(q, { limit })
      .map((r) => r.item)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  };
}
