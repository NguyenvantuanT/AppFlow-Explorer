import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { AlertIcon } from '../components/icons';

export interface UnresolvedNodeData extends Record<string, unknown> {
  edgeId: string;
  reason?: string;
}

export type UnresolvedFlowNode = Node<UnresolvedNodeData, 'unresolved'>;

export const UnresolvedNode = memo(function UnresolvedNode({ data, selected }: NodeProps<UnresolvedFlowNode>) {
  return (
    <div
      className={`flex h-[92px] w-[180px] cursor-pointer flex-col justify-center gap-1 rounded-xl border-2 border-dashed bg-warning/5 px-3 ${
        selected ? 'border-warning' : 'border-warning/50'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-warning">
        <AlertIcon size={14} /> Unknown destination
      </div>
      <div className="line-clamp-2 text-[11px] leading-snug text-ink-2">
        {data.reason ?? 'Target could not be determined automatically.'}
      </div>
      <Handle type="target" position={Position.Left} isConnectable={false} />
    </div>
  );
});
