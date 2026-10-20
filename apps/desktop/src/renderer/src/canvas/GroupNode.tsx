import type { Node, NodeProps } from '@xyflow/react';
import { memo } from 'react';

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  /** Screens in the group (references and unknown destinations excluded). */
  screenCount: number;
  width: number;
  height: number;
}

export type GroupFlowNode = Node<GroupNodeData, 'group'>;

/** Background box around one feature's screens. Dragging its title moves the whole feature. */
export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      className="rounded-[28px] border-2 border-dashed border-[#3d5486] bg-[#16223d]/55"
      style={{ width: data.width, height: data.height }}
      data-testid="feature-group"
    >
      <div className="group-handle flex h-11 cursor-grab items-center gap-2 px-6 active:cursor-grabbing" title="Drag to move this feature">
        <span className="text-[17px] font-semibold text-[#c7d6f5]">{data.label}</span>
        <span className="rounded bg-[#2a3a5e] px-1.5 text-[11px] text-[#a3b3d4]">
          {data.screenCount} screen{data.screenCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
});
