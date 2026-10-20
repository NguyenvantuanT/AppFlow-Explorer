import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  /** `x` resizes a side panel's width, `y` the code panel's height. */
  axis: 'x' | 'y';
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  /** Pixels per unit of `value` (1 for pixel sizes, the container height for a fraction). */
  scale?: number;
  /** The panel grows when dragged left (x) or up (y). */
  invert?: boolean;
}

const KEY_STEP_PX = 24;

/**
 * Drag handle between two panels. Also works from the keyboard (arrow keys,
 * Home/End) and resets to the default size on double-click.
 */
export function ResizeHandle({ axis, label, value, min, max, onChange, onReset, scale = 1, invert = false }: Props) {
  const start = useRef<{ pointer: number; value: number } | null>(null);
  const sign = invert ? -1 : 1;
  const at = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pointer: at(e), value };
    document.body.dataset['resizing'] = axis;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || !scale) return;
    onChange(start.current.value + (sign * (at(e) - start.current.pointer)) / scale);
  };
  const onPointerUp = () => {
    start.current = null;
    delete document.body.dataset['resizing'];
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow: Record<string, number> = axis === 'x' ? { ArrowRight: sign, ArrowLeft: -sign } : { ArrowDown: sign, ArrowUp: -sign };
    const dir = grow[e.key];
    if (dir) onChange(value + (dir * KEY_STEP_PX) / scale);
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value * (scale === 1 ? 1 : 100))}
      aria-valuemin={Math.round(min * (scale === 1 ? 1 : 100))}
      aria-valuemax={Math.round(max * (scale === 1 ? 1 : 100))}
      tabIndex={0}
      title={`${label} (double-click to reset)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={`group relative z-20 shrink-0 outline-none ${axis === 'x' ? '-mx-[3px] w-[6px] cursor-col-resize' : '-my-[3px] h-[6px] cursor-row-resize'}`}
    >
      <div className={`absolute bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary ${axis === 'x' ? 'inset-y-0 left-[2px] w-[2px]' : 'inset-x-0 top-[2px] h-[2px]'}`} />
    </div>
  );
}
