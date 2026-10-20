import { visibleFlow, type FlowGraph, type ProjectIndex } from '@appflow/model';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExplorer } from '../store';
import { AliasNode, type AliasFlowNode } from './AliasNode';
import { CanvasControls } from './CanvasControls';
import { CanvasHeader } from './CanvasHeader';
import { GroupNode, type GroupFlowNode } from './GroupNode';
import { GROUP_PADDING, NODE_SIZES, PHONE_NODE_SIZE, type Positions, type XY } from './layout';
import { LimitationsPanel } from './LimitationsPanel';
import { EDGE_COLORS, NavEdge, type NavFlowEdge } from './NavEdge';
import { PhoneNode, type PhoneFlowNode } from './PhoneNode';
import { UnresolvedNode, type UnresolvedFlowNode } from './UnresolvedNode';
import { useFitAll } from './useFitAll';

type LeafNode = PhoneFlowNode | UnresolvedFlowNode | AliasFlowNode;
type FlowNode = LeafNode | GroupFlowNode;

const nodeTypes = { phone: PhoneNode, unresolved: UnresolvedNode, alias: AliasNode, group: GroupNode };
const edgeTypes = { nav: NavEdge };

function buildLeafNodes(graph: FlowGraph, index: ProjectIndex, positions: Positions): LeafNode[] {
  return graph.nodes.flatMap((n): LeafNode[] => {
    const position = positions[n.id] ?? { x: 0, y: 0 };
    if (n.type === 'screen') {
      const screen = index.screensById.get(n.screenId!);
      return screen ? [{ id: n.id, type: 'phone', position, data: { screen, fileHighlighted: false } }] : [];
    }
    if (n.type === 'unresolved') {
      return [{ id: n.id, type: 'unresolved', position, data: { edgeId: n.edgeId!, reason: index.edgesById.get(n.edgeId!)?.unresolvedReason } }];
    }
    const target = index.screensById.get(n.screenId!);
    return [{ id: n.id, type: 'alias', position, data: { screenId: n.screenId!, screenName: target?.name ?? n.screenId!, edgeId: n.edgeId! } }];
  });
}

const sizeOfLeaf = (n: LeafNode) => NODE_SIZES[n.type === 'phone' ? 'screen' : n.type];

/** Box around a group's members, from their current (possibly dragged) positions. */
function groupBox(members: LeafNode[]): XY & { width: number; height: number } {
  const xs = members.map((n) => n.position.x);
  const ys = members.map((n) => n.position.y);
  const right = Math.max(...members.map((n) => n.position.x + sizeOfLeaf(n).width));
  const bottom = Math.max(...members.map((n) => n.position.y + sizeOfLeaf(n).height));
  const x = Math.min(...xs) - GROUP_PADDING.side;
  const y = Math.min(...ys) - GROUP_PADDING.top;
  return { x, y, width: right + GROUP_PADDING.side - x, height: bottom + GROUP_PADDING.bottom - y };
}

function CanvasInner() {
  const project = useExplorer((s) => s.project);
  const index = useExplorer((s) => s.index);
  const graph = useExplorer((s) => s.graph);
  const filters = useExplorer((s) => s.filters);
  const layoutVersion = useExplorer((s) => s.layoutVersion);
  const layoutStatus = useExplorer((s) => s.layoutStatus);
  const layoutError = useExplorer((s) => s.layoutError);
  const selection = useExplorer((s) => s.selection);
  const highlightedFileId = useExplorer((s) => s.highlightedFileId);
  const focusRequest = useExplorer((s) => s.focusRequest);
  const select = useExplorer((s) => s.select);
  const pinNodes = useExplorer((s) => s.pinNodes);
  const resetLayout = useExplorer((s) => s.resetLayout);

  const rf = useReactFlow<FlowNode, NavFlowEdge>();
  const fitAll = useFitAll();

  // Leaf nodes are owned locally so React Flow can keep its measurements and
  // drags stay smooth; they are rebuilt when a new layout is produced.
  const [nodes, setNodes] = useState<LeafNode[]>([]);
  const builtFor = useRef(0);
  useEffect(() => {
    if (layoutVersion === 0) return;
    const positions = useExplorer.getState().positions;
    const relayout = builtFor.current !== layoutVersion;
    builtFor.current = layoutVersion;
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return buildLeafNodes(graph, index, positions).map((n) => {
        const old = prevById.get(n.id);
        // Between layouts (runtime overlay, corrections), keep positions from local drags.
        const position = !relayout && old ? old.position : n.position;
        return old?.measured ? { ...n, position, measured: old.measured } : { ...n, position };
      });
    });
    // Fit only after a full layout; placing new nodes after a correction keeps the view.
    // Bounds come from layout positions, so this does not wait for React Flow to measure nodes.
    if (relayout && useExplorer.getState().lastLayoutMode !== 'stable') requestAnimationFrame(() => fitAll());
  }, [graph, index, layoutVersion, fitAll]);

  const visible = useMemo(() => visibleFlow(graph, project, filters), [graph, project, filters]);
  const graphEdgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);

  // Which elements relate to the current selection (others are dimmed).
  const related = useMemo(() => {
    if (!selection) return null;
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const addEdge = (id: string) => {
      const edge = graphEdgeById.get(id);
      if (!edge) return;
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    };
    if (selection.kind === 'screen') {
      nodeIds.add(selection.id);
      for (const e of graph.edges) if (e.source === selection.id || e.target === selection.id) addEdge(e.id);
      // References to this screen elsewhere on the map.
      for (const n of graph.nodes) if (n.type === 'alias' && n.screenId === selection.id) addEdge(n.edgeId!);
    } else {
      addEdge(selection.id);
    }
    return { nodeIds, edgeIds };
  }, [selection, graph, graphEdgeById]);

  const fileScreens = useMemo(() => {
    if (!highlightedFileId) return null;
    const ids = new Set((index.screensByFile.get(highlightedFileId) ?? []).map((s) => s.id));
    return ids.size > 0 ? ids : null;
  }, [highlightedFileId, index]);

  const leafById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const groupNodes = useMemo<GroupFlowNode[]>(
    () =>
      graph.groups.flatMap((g): GroupFlowNode[] => {
        const members = g.nodeIds.filter((id) => visible.nodeIds.has(id)).map((id) => leafById.get(id)).filter((n): n is LeafNode => !!n);
        if (!members.length) return [];
        const box = groupBox(members);
        return [
          {
            id: g.id,
            type: 'group',
            position: { x: box.x, y: box.y },
            data: { label: g.label, screenCount: members.filter((m) => m.type === 'phone').length, width: box.width, height: box.height },
            draggable: true,
            selectable: false,
            dragHandle: '.group-handle',
            zIndex: -1,
            style: { width: box.width, height: box.height },
          },
        ];
      }),
    [graph.groups, visible, leafById],
  );

  const renderNodes = useMemo<FlowNode[]>(() => {
    const leaves = nodes.map((node): LeafNode => {
      const hidden = !visible.nodeIds.has(node.id);
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
          hidden,
          selected: isSelected,
          className,
          data: node.data.fileHighlighted === fileHighlighted ? node.data : { ...node.data, fileHighlighted },
        };
      }
      return { ...node, hidden, selected: isSelected, className };
    });
    return [...groupNodes, ...leaves];
  }, [nodes, groupNodes, visible, selection, related, fileScreens]);

  const edges = useMemo<NavFlowEdge[]>(
    () =>
      graph.edges.map((edge) => {
        const isSelected = selection?.kind === 'edge' && selection.id === edge.id;
        const emphasized = !!related && related.edgeIds.has(edge.id);
        return {
          id: edge.id,
          type: 'nav',
          source: edge.source,
          target: edge.target,
          hidden: !visible.edgeIds.has(edge.id),
          selected: isSelected,
          className: related && !emphasized ? 'is-dimmed' : undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isSelected ? '#93c5fd' : EDGE_COLORS[edge.status],
            width: 16,
            height: 16,
          },
          data: { status: edge.status, kind: edge.kind, label: edge.label, emphasized, parallelIndex: edge.parallelIndex, parallelCount: edge.parallelCount },
        };
      }),
    [graph, visible, selection, related],
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
      const edge = graphEdgeById.get(target.id);
      if (!edge) return;
      void rf.fitView({ nodes: [{ id: edge.source }, { id: edge.target }], padding: 0.35, maxZoom: 1, duration: 450 });
    }
  }, [focusRequest, rf, graphEdgeById]);

  // Dragging a feature box moves its members from where they were when the drag started.
  const groupDrag = useRef<{ id: string; start: XY; members: Map<string, XY> } | null>(null);
  const onNodeDragStart = useCallback<OnNodeDrag<FlowNode>>(
    (_event, node) => {
      if (node.type !== 'group') return;
      const ids = new Set(graph.groups.find((g) => g.id === node.id)?.nodeIds ?? []);
      groupDrag.current = { id: node.id, start: { ...node.position }, members: new Map(nodes.filter((n) => ids.has(n.id)).map((n) => [n.id, n.position])) };
    },
    [graph.groups, nodes],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const leafChanges: NodeChange<LeafNode>[] = [];
    let groupMove: XY | null = null;
    for (const c of changes) {
      // Selection is owned by the explorer store; group boxes are derived from their members.
      if (c.type === 'select' || c.type === 'remove' || c.type === 'add') continue;
      if (c.id.startsWith('group:')) {
        const drag = groupDrag.current;
        if (c.type === 'position' && c.position && drag?.id === c.id) groupMove = { x: c.position.x - drag.start.x, y: c.position.y - drag.start.y };
        continue;
      }
      leafChanges.push(c as NodeChange<LeafNode>);
    }
    setNodes((nds) => {
      let next = leafChanges.length ? applyNodeChanges(leafChanges, nds) : nds;
      const drag = groupDrag.current;
      if (groupMove && drag) {
        const delta = groupMove;
        next = next.map((n) => {
          const start = drag.members.get(n.id);
          return start ? { ...n, position: { x: start.x + delta.x, y: start.y + delta.y } } : n;
        });
      }
      return next;
    });
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>(
    (_event, _node, dragged) => {
      const moved: Positions = {};
      for (const n of dragged) {
        if (n.type === 'group') {
          const members = groupDrag.current?.members ?? new Map();
          for (const leaf of nodes) if (members.has(leaf.id)) moved[leaf.id] = leaf.position;
          groupDrag.current = null;
        } else {
          moved[n.id] = n.position;
        }
      }
      pinNodes(moved);
    },
    [pinNodes, nodes],
  );

  const onNodeClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      if (node.type === 'phone') select({ kind: 'screen', id: node.id }, { openCode: 'follow' });
      else if (node.type === 'alias') select({ kind: 'screen', id: node.data.screenId }, { focus: true, openCode: 'follow' });
      else if (node.type === 'unresolved') select({ kind: 'edge', id: node.data.edgeId }, { openCode: 'follow' });
    },
    [select],
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      if (node.type === 'phone') select({ kind: 'screen', id: node.id }, { openCode: true });
      else if (node.type === 'unresolved') select({ kind: 'edge', id: node.data.edgeId }, { openCode: true });
    },
    [select],
  );

  const minimapColor = useCallback(
    (node: FlowNode) => {
      if (node.type === 'group') return 'rgba(61, 84, 134, 0.35)';
      if (node.type === 'unresolved') return '#f59e0b';
      if (node.type === 'alias') return '#4f6699';
      if (selection?.kind === 'screen' && selection.id === node.id) return '#3b82f6';
      return node.data.screen.isEntryPoint ? '#22c55e' : '#6b82b8';
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
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={(_e, edge) => select({ kind: 'edge', id: edge.id }, { openCode: 'follow' })}
        onEdgeDoubleClick={(_e, edge) => select({ kind: 'edge', id: edge.id }, { openCode: true })}
        onPaneClick={() => select(null)}
        colorMode="dark"
        minZoom={0.05}
        maxZoom={2.5}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        nodesConnectable={false}
        elevateNodesOnSelect={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#2c3b5e" />
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
      <LimitationsPanel hiddenByFilters={{ screens: visible.hiddenScreens, edges: visible.hiddenEdges }} />

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
      {project.screens.length > 0 && visible.nodeIds.size === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-[15px] font-semibold text-ink">Everything is filtered out</div>
          <div className="max-w-sm text-ink-2">Change the filters to show screens again.</div>
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
