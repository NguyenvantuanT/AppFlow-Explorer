import { edgeStatus, type AppProject } from '@appflow/model';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExplorer } from '../store';
import { CanvasControls } from './CanvasControls';
import { CanvasHeader } from './CanvasHeader';
import { FIT_PADDING, PHONE_NODE_SIZE, unresolvedNodeId, type Positions } from './layout';
import { EDGE_COLORS, NavEdge, type NavFlowEdge } from './NavEdge';
import { PhoneNode, type PhoneFlowNode } from './PhoneNode';
import { UnresolvedNode, type UnresolvedFlowNode } from './UnresolvedNode';

type FlowNode = PhoneFlowNode | UnresolvedFlowNode;

const nodeTypes = { phone: PhoneNode, unresolved: UnresolvedNode };
const edgeTypes = { nav: NavEdge };

function buildNodes(project: AppProject, positions: Positions): FlowNode[] {
  const nodes: FlowNode[] = project.screens.map((screen) => ({
    id: screen.id,
    type: 'phone',
    position: positions[screen.id] ?? { x: 0, y: 0 },
    data: { screen, fileHighlighted: false },
  }));
  for (const edge of project.edges) {
    if (edge.to !== null) continue;
    const id = unresolvedNodeId(edge.id);
    nodes.push({
      id,
      type: 'unresolved',
      position: positions[id] ?? { x: 0, y: 0 },
      data: { edgeId: edge.id, reason: edge.unresolvedReason },
    });
  }
  return nodes;
}

function CanvasInner() {
  const project = useExplorer((s) => s.project);
  const index = useExplorer((s) => s.index);
  const layoutVersion = useExplorer((s) => s.layoutVersion);
  const layoutStatus = useExplorer((s) => s.layoutStatus);
  const layoutError = useExplorer((s) => s.layoutError);
  const selection = useExplorer((s) => s.selection);
  const highlightedFileId = useExplorer((s) => s.highlightedFileId);
  const focusRequest = useExplorer((s) => s.focusRequest);
  const select = useExplorer((s) => s.select);
  const pinNode = useExplorer((s) => s.pinNode);
  const resetLayout = useExplorer((s) => s.resetLayout);

  const rf = useReactFlow<FlowNode, NavFlowEdge>();
  const nodesInitialized = useNodesInitialized();
  const needsFit = useRef(false);

  // Nodes are owned locally so React Flow can keep its measurements; they are
  // rebuilt only when a new layout is produced.
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    if (layoutVersion === 0) return;
    const positions = useExplorer.getState().positions;
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return buildNodes(project, positions).map((n) => {
        const measured = prevById.get(n.id)?.measured;
        return measured ? { ...n, measured } : n;
      });
    });
    needsFit.current = true;
  }, [project, layoutVersion]);

  useEffect(() => {
    if (!needsFit.current || !nodesInitialized || nodes.length === 0) return;
    needsFit.current = false;
    void rf.fitView({ padding: FIT_PADDING });
  }, [nodes, nodesInitialized, rf]);

  // Which elements relate to the current selection (others are dimmed).
  const related = useMemo(() => {
    if (!selection) return null;
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const addEdge = (id: string) => {
      const edge = index.edgesById.get(id);
      if (!edge) return;
      edgeIds.add(edge.id);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to ?? unresolvedNodeId(edge.id));
    };
    if (selection.kind === 'screen') {
      nodeIds.add(selection.id);
      for (const e of index.outgoing.get(selection.id) ?? []) addEdge(e.id);
      for (const e of index.incoming.get(selection.id) ?? []) addEdge(e.id);
    } else {
      addEdge(selection.id);
    }
    return { nodeIds, edgeIds };
  }, [selection, index]);

  const fileScreens = useMemo(() => {
    if (!highlightedFileId) return null;
    const ids = new Set((index.screensByFile.get(highlightedFileId) ?? []).map((s) => s.id));
    return ids.size > 0 ? ids : null;
  }, [highlightedFileId, index]);

  const renderNodes = useMemo<FlowNode[]>(
    () =>
      nodes.map((node) => {
        const isSelected =
          node.type === 'phone'
            ? selection?.kind === 'screen' && selection.id === node.id
            : selection?.kind === 'edge' && selection.id === node.data.edgeId;
        const dimmed = related ? !related.nodeIds.has(node.id) : fileScreens ? !fileScreens.has(node.id) : false;
        const className = dimmed ? 'is-dimmed' : undefined;
        if (node.type === 'phone') {
          const fileHighlighted = fileScreens?.has(node.id) ?? false;
          return {
            ...node,
            selected: isSelected,
            className,
            data: node.data.fileHighlighted === fileHighlighted ? node.data : { ...node.data, fileHighlighted },
          };
        }
        return { ...node, selected: isSelected, className };
      }),
    [nodes, selection, related, fileScreens],
  );

  const edges = useMemo<NavFlowEdge[]>(
    () =>
      project.edges.map((edge) => {
        const status = edgeStatus(edge);
        const isSelected = selection?.kind === 'edge' && selection.id === edge.id;
        const emphasized = !!related && related.edgeIds.has(edge.id);
        return {
          id: edge.id,
          type: 'nav',
          source: edge.from,
          target: edge.to ?? unresolvedNodeId(edge.id),
          selected: isSelected,
          className: related && !emphasized ? 'is-dimmed' : undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isSelected ? '#60a5fa' : EDGE_COLORS[status],
            width: 16,
            height: 16,
          },
          data: { status, kind: edge.kind, label: edge.trigger.label, emphasized },
        };
      }),
    [project, selection, related],
  );

  // Bring the requested element into view.
  useEffect(() => {
    if (!focusRequest) return;
    const { target } = focusRequest;
    if (target.kind === 'screen') {
      const node = rf.getNode(target.id);
      if (!node) return;
      void rf.setCenter(node.position.x + PHONE_NODE_SIZE.width / 2, node.position.y + PHONE_NODE_SIZE.height / 2, {
        zoom: Math.max(rf.getZoom(), 0.85),
        duration: 450,
      });
    } else {
      const edge = index.edgesById.get(target.id);
      if (!edge) return;
      void rf.fitView({
        nodes: [{ id: edge.from }, { id: edge.to ?? unresolvedNodeId(edge.id) }],
        padding: 0.35,
        maxZoom: 1,
        duration: 450,
      });
    }
  }, [focusRequest, rf, index]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    // Selection is owned by the explorer store, not React Flow.
    const relevant = changes.filter((c) => c.type !== 'select' && c.type !== 'remove');
    if (relevant.length) setNodes((nds) => applyNodeChanges(relevant, nds));
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>(
    (_event, _node, dragged) => dragged.forEach((n) => pinNode(n.id, n.position)),
    [pinNode],
  );

  const onNodeClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      if (node.type === 'phone') select({ kind: 'screen', id: node.id }, { openCode: 'follow' });
      else select({ kind: 'edge', id: node.data.edgeId }, { openCode: 'follow' });
    },
    [select],
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      if (node.type === 'phone') select({ kind: 'screen', id: node.id }, { openCode: true });
      else select({ kind: 'edge', id: node.data.edgeId }, { openCode: true });
    },
    [select],
  );

  const minimapColor = useCallback(
    (node: FlowNode) => {
      if (node.type === 'unresolved') return '#f59e0b';
      if (selection?.kind === 'screen' && selection.id === node.id) return '#3b82f6';
      return node.data.screen.isEntryPoint ? '#22c55e' : '#33456b';
    },
    [selection],
  );

  return (
    <div className="relative h-full w-full" data-testid="flow-canvas">
      <ReactFlow<FlowNode, NavFlowEdge>
        nodes={renderNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={(_e, edge) => select({ kind: 'edge', id: edge.id }, { openCode: 'follow' })}
        onEdgeDoubleClick={(_e, edge) => select({ kind: 'edge', id: edge.id }, { openCode: true })}
        onPaneClick={() => select(null)}
        colorMode="dark"
        minZoom={0.08}
        maxZoom={2.5}
        panOnScroll
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#1d2945" />
        <MiniMap<FlowNode>
          position="bottom-right"
          nodeColor={minimapColor}
          nodeBorderRadius={12}
          style={{ width: 168, height: 112 }}
          pannable
          zoomable
          ariaLabel="Canvas minimap"
        />
      </ReactFlow>

      <CanvasHeader />
      <CanvasControls />

      {layoutStatus === 'computing' && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-2">
          Arranging screens…
        </div>
      )}
      {layoutStatus === 'error' && (
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-danger/50 bg-panel px-4 py-2 text-[12px]">
          <span className="text-danger">Automatic layout failed: {layoutError}</span>
          <button className="rounded border border-line-strong px-2 py-0.5 hover:bg-raised" onClick={() => void resetLayout()}>
            Retry
          </button>
        </div>
      )}
      {project.screens.length === 0 && layoutStatus === 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-[15px] font-semibold text-ink">No screens discovered</div>
          <div className="max-w-sm text-ink-2">The project was analyzed but no screen widgets were identified.</div>
        </div>
      )}
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
