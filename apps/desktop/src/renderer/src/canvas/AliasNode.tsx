import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

export interface AliasNodeData extends Record<string, unknown> {
  screenId: string;
  screenName: string;
  edgeId: string;
}

export type AliasFlowNode = Node<AliasNodeData, 'alias'>;

/**
 * Stands for a destination that many screens lead to (e.g. Login). The screen
 * itself is drawn once; clicking this reference jumps to it.
 */
export const AliasNode = memo(function AliasNode({ data, selected }: NodeProps<AliasFlowNode>) {
  return (
    <div
      className={`flex h-[64px] w-[180px] cursor-pointer flex-col justify-center rounded-xl border-2 bg-[#1b2844] px-3 ${
        selected ? 'border-[#93c5fd]' : 'border-[#4f6699]'
      }`}
      title={`Goes to ${data.screenName}. The screen is drawn once on the map; click to jump to it.`}
    >
      <div className="truncate text-[13px] font-semibold text-white">↪ {data.screenName}</div>
      <div className="text-[10.5px] text-[#a3b3d4]">Shared destination · click to locate</div>
      <Handle type="target" position={Position.Left} isConnectable={false} />
    </div>
  );
});
