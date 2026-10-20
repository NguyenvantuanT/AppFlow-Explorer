import { Command } from 'cmdk';
import { useMemo, useState, type ComponentType } from 'react';
import { buildSearchItems, createSearcher, type SearchItem, type SearchKind } from '../search/searchIndex';
import { useExplorer } from '../store';
import { ArrowIcon, FileIcon, PhoneIcon, RouteIcon, SearchIcon, WidgetIcon } from './icons';
import { StatusBadge } from './StatusBadge';

const KIND_META: Record<SearchKind, { label: string; Icon: ComponentType<{ size?: number; className?: string }> }> = {
  screen: { label: 'Screens', Icon: PhoneIcon },
  route: { label: 'Routes', Icon: RouteIcon },
  navigation: { label: 'Navigation', Icon: ArrowIcon },
  widget: { label: 'Widgets', Icon: WidgetIcon },
  file: { label: 'Files', Icon: FileIcon },
};

export function CommandPalette() {
  const open = useExplorer((s) => s.paletteOpen);
  const setOpen = useExplorer((s) => s.setPaletteOpen);
  const project = useExplorer((s) => s.project);
  const select = useExplorer((s) => s.select);
  const openCode = useExplorer((s) => s.openCode);
  const highlightFile = useExplorer((s) => s.highlightFile);
  const [query, setQuery] = useState('');

  const search = useMemo(() => createSearcher(buildSearchItems(project)), [project]);
  const results = useMemo(() => search(query), [search, query]);
  const groups = useMemo(() => {
    const map = new Map<SearchKind, SearchItem[]>();
    for (const item of results) map.set(item.kind, [...(map.get(item.kind) ?? []), item]);
    return [...map.entries()];
  }, [results]);

  const activate = (item: SearchItem) => {
    const { target } = item;
    if (target.type === 'screen') {
      highlightFile(null);
      select({ kind: 'screen', id: target.screenId }, { focus: true, openCode: target.location ? false : 'follow' });
      if (target.location) openCode(target.location);
    } else if (target.type === 'edge') {
      highlightFile(null);
      select({ kind: 'edge', id: target.edgeId }, { focus: true, openCode: true });
    } else {
      select(null);
      highlightFile(target.fileId);
      openCode({ fileId: target.fileId });
    }
    setOpen(false);
    setQuery('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/50 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <Command
        label="Search project"
        shouldFilter={false}
        loop
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="flex h-fit max-h-[60vh] w-[640px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <SearchIcon size={16} className="text-muted" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search screens, routes, files, widgets, navigation…"
            className="h-12 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">Esc</kbd>
        </div>
        <Command.List className="min-h-0 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-ink-2">No results for “{query}”.</Command.Empty>
          {groups.map(([kind, items]) => {
            const { label, Icon } = KIND_META[kind];
            return (
              <Command.Group
                key={kind}
                heading={label}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted"
              >
                {items.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    onSelect={() => activate(item)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-ink-2 data-[selected=true]:bg-primary-soft data-[selected=true]:text-white"
                  >
                    <Icon size={15} className="shrink-0 text-muted" />
                    <span className={`truncate ${kind === 'route' || kind === 'widget' ? 'font-mono text-[12.5px]' : ''} text-ink`}>
                      {item.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{item.detail}</span>
                    {item.status && <StatusBadge status={item.status} compact />}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}
