import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MarkerType, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export type Graph = { nodes: { id: string; label: string; kind?: string; description?: string }[]; edges: { source: string; target: string; label?: string }[] };

const columns: Record<string, number> = { client: 0, external: 3, service: 1, queue: 2, database: 3, storage: 3 };

/** Parse the component JSON the model returns, tolerating fences and stray prose. */
export function parseGraph(text: string): Graph | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(data.nodes) || !data.nodes.length) return null;
    const ids = new Set(data.nodes.map((n: { id: string }) => String(n.id)));
    return {
      nodes: data.nodes.slice(0, 30).map((n: Record<string, unknown>) => ({ id: String(n.id), label: String(n.label || n.id).slice(0, 60), kind: String(n.kind || 'service'), description: String(n.description || '').slice(0, 200) })),
      edges: (Array.isArray(data.edges) ? data.edges : []).filter((e: Record<string, unknown>) => ids.has(String(e.source)) && ids.has(String(e.target))).slice(0, 60).map((e: Record<string, unknown>) => ({ source: String(e.source), target: String(e.target), label: e.label ? String(e.label).slice(0, 40) : undefined })),
    };
  } catch { return null; }
}

export default function ArchitectureFlow({ graph }: { graph: Graph }) {
  const { nodes, edges } = useMemo(() => {
    const rows: Record<number, number> = {};
    const nodes: Node[] = graph.nodes.map(item => {
      const column = columns[item.kind || 'service'] ?? 1;
      const row = rows[column] = (rows[column] ?? -1) + 1;
      return {
        id: item.id, position: { x: column * 250, y: row * 118 + (column % 2) * 30 },
        data: { label: <div className="zy-flow-node"><small>{item.kind}</small><strong>{item.label}</strong>{item.description && <span>{item.description}</span>}</div> },
        className: `zy-flow kind-${item.kind}`,
      };
    });
    const edges: Edge[] = graph.edges.map((edge, index) => ({
      id: `e${index}`, source: edge.source, target: edge.target, label: edge.label, animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, className: 'zy-flow-edge', labelBgPadding: [4, 2], labelBgBorderRadius: 3,
    }));
    return { nodes, edges };
  }, [graph]);
  return <div className="zy-flow-canvas"><ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} proOptions={{ hideAttribution: true }} nodesConnectable={false} minZoom={0.3} maxZoom={1.6}><Background gap={22} size={1}/><Controls showInteractive={false}/></ReactFlow></div>;
}
