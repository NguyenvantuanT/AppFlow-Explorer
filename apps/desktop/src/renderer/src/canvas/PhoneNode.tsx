import type { Screen, WidgetKind } from '@appflow/model';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { PhoneIcon } from '../components/icons';

export interface PhoneNodeData extends Record<string, unknown> {
  screen: Screen;
  fileHighlighted: boolean;
}

export type PhoneFlowNode = Node<PhoneNodeData, 'phone'>;

const KIND_LABEL: Record<Screen['kind'], string | null> = {
  page: null,
  dialog: 'Dialog',
  bottomSheet: 'Sheet',
};

const PLATFORM_KIND: Record<NonNullable<Screen['platformKind']>, string> = {
  widget: 'Widget',
  activity: 'Activity',
  fragment: 'Fragment',
  composable: 'Composable',
  'view-controller': 'View controller',
  'swiftui-view': 'SwiftUI view',
  'storyboard-scene': 'Storyboard scene',
  component: 'Component',
};

const KIND_GLYPH: Record<WidgetKind, string> = {
  button: '▭',
  input: '⌨',
  list: '☰',
  tab: '⊟',
  image: '▣',
  container: '□',
  navigation: '≡',
  custom: '◇',
  other: '·',
};

/**
 * Stand-in for a screen that has not been captured from the running app:
 * a schematic of what the code says the screen contains. Never styled to look
 * like a real screenshot.
 */
export function Wireframe({ screen }: { screen: Screen }) {
  const widgets = screen.keyWidgets.slice(0, 7);
  return (
    <div className="flex h-full flex-col bg-[repeating-linear-gradient(135deg,#111a2e_0,#111a2e_8px,#0f1729_8px,#0f1729_16px)] p-4 text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{screen.platformKind ? PLATFORM_KIND[screen.platformKind] : 'Screen'}</div>
      <div className="mt-1 break-words text-[19px] font-semibold leading-tight text-ink">{screen.name}</div>
      {screen.route && <div className="mt-1 truncate font-mono text-[11px] text-[#6f9cf0]">{screen.route}</div>}
      <div className="mt-4 space-y-1.5">
        {widgets.map((w) => (
          <div key={`${w.name}@${w.location?.line ?? ''}`} className="flex items-center gap-1.5 rounded border border-line-strong/70 bg-panel/80 px-2 py-1 text-[10.5px] text-ink-2">
            <span className="w-3 shrink-0 text-center text-muted">{KIND_GLYPH[w.kind]}</span>
            <span className="truncate">{w.name}</span>
          </div>
        ))}
        {screen.keyWidgets.length > widgets.length && <div className="pl-1 text-[10px] text-muted">+{screen.keyWidgets.length - widgets.length} more</div>}
      </div>
      <div className="mt-auto flex items-center gap-1.5 text-[10px] text-muted">
        <PhoneIcon size={12} /> Not captured yet — layout from code
      </div>
    </div>
  );
}

export const PhoneNode = memo(function PhoneNode({ data, selected }: NodeProps<PhoneFlowNode>) {
  const { screen, fileHighlighted } = data;
  const state = screen.states[0];
  const shot = state?.screenshot;
  const kindLabel = KIND_LABEL[screen.kind];
  const isOverlay = screen.kind !== 'page';

  const frameTone = selected
    ? 'border-primary shadow-[0_0_0_4px_rgb(59_130_246/0.28),0_20px_44px_-14px_rgb(0_0_0/0.85)]'
    : screen.isEntryPoint
      ? 'border-success shadow-[0_0_0_4px_rgb(34_197_94/0.18),0_20px_44px_-14px_rgb(0_0_0/0.85)]'
      : fileHighlighted
        ? 'border-primary/70 shadow-[0_0_0_3px_rgb(59_130_246/0.18),0_18px_40px_-14px_rgb(0_0_0/0.8)]'
        : `${isOverlay ? 'border-dashed border-[#4a5d86]' : 'border-[#33446a]'} shadow-[0_18px_40px_-14px_rgb(0_0_0/0.8)] group-hover:border-[#5a6f9c]`;

  return (
    <div className="group w-[220px] cursor-pointer" data-testid={`screen-node-${screen.id}`}>
      <div className={`relative rounded-[30px] border-2 bg-[#05070d] p-[5px] transition-[border-color,box-shadow] ${frameTone}`}>
        <div className="relative aspect-[360/780] overflow-hidden rounded-[24px] bg-panel-2">
          {shot ? (
            <img
              src={shot.uri}
              alt={`${screen.name} preview`}
              draggable={false}
              className="h-full w-full select-none object-cover"
            />
          ) : (
            <Wireframe screen={screen} />
          )}
          {state?.provenance === 'mock' && (
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-white/80">
              Mock preview
            </span>
          )}
          {state?.provenance === 'runtime' && shot && (
            <span
              className="absolute bottom-2 right-2 rounded bg-success/85 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-white"
              title={`Captured ${shot.capturedAt ? new Date(shot.capturedAt).toLocaleString() : ''} on ${shot.device ?? 'device'}`}
            >
              Captured
            </span>
          )}
        </div>
      </div>

      <div className="mt-2.5 h-[40px] px-1 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span className={`truncate text-[14px] font-semibold ${selected ? 'text-white' : 'text-ink'}`}>
            {screen.widgetClass}
          </span>
          {kindLabel && (
            <span className="shrink-0 rounded border border-line-strong px-1.5 py-px text-[10px] text-ink-2">{kindLabel}</span>
          )}
        </div>
        <div className="truncate font-mono text-[11.5px] text-[#6f9cf0]">{screen.route ?? '—'}</div>
      </div>

      <Handle type="target" position={Position.Left} style={{ top: 232 }} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={{ top: 232 }} isConnectable={false} />
    </div>
  );
});
