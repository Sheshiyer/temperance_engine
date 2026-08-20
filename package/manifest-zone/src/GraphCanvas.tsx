import { useId, type KeyboardEvent } from 'react'
import type { GraphEdge, GraphNode, GraphView } from './graphModel'
import './graph.css'

export interface GraphSelection {
  type: 'node' | 'edge'
  id: string
  label: string
  provenance: GraphNode['provenance'] | GraphEdge['provenance']
}

interface GraphCanvasProps {
  view: GraphView
  selectedId?: string | null
  onSelect: (selection: GraphSelection) => void
}

function center(node: GraphNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

function selectionForNode(node: GraphNode): GraphSelection {
  return { type: 'node', id: node.id, label: node.label, provenance: node.provenance }
}

function selectionForEdge(edge: GraphEdge): GraphSelection {
  return { type: 'edge', id: edge.id, label: edge.label, provenance: edge.provenance }
}

function activate(event: KeyboardEvent<SVGGElement>, onSelect: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onSelect()
  }
}

export function GraphCanvas({ view, selectedId, onSelect }: GraphCanvasProps) {
  const titleId = useId()
  const descId = useId()
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]))
  return <div className={`graph-surface graph-tone-${view.accent}`}>
    <div className="graph-viewport">
      {view.nodes.length ? <svg className="graph-svg" viewBox="0 0 1000 380" role="img" aria-labelledby={`${titleId} ${descId}`}>
        <title id={titleId}>{view.title}</title>
        <desc id={descId}>{view.description} {view.nodes.length} nodes and {view.edges.length} relationships.</desc>
        <defs><pattern id={`grid-${titleId}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--graph-grid)" strokeWidth="1" /></pattern></defs>
        <rect width="1000" height="380" fill={`url(#grid-${titleId})`} aria-hidden="true" />
        <g className="graph-edges" aria-label="Graph relationships">
          {view.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            const start = center(from)
            const end = center(to)
            const bend = Math.max(36, Math.abs(end.x - start.x) * .32)
            const path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
            const selected = selectedId === edge.id
            return <g className={`graph-edge graph-edge-${edge.tone} ${selected ? 'selected' : ''}`} key={edge.id} role="button" tabIndex={0} aria-label={`${edge.label} relationship from ${from.label} to ${to.label}; ${edge.provenance.basis}`} aria-pressed={selected} onClick={() => onSelect(selectionForEdge(edge))} onKeyDown={(event) => activate(event, () => onSelect(selectionForEdge(edge)))}>
              <path className="graph-edge-hit" d={path} />
              <path className="graph-edge-line" d={path} />
              <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8} className="graph-edge-label">{edge.label}</text>
            </g>
          })}
        </g>
        <g className="graph-nodes" aria-label="Graph nodes">
          {view.nodes.map((node) => { const selected = selectedId === node.id; return <g className={`graph-node graph-node-${node.tone} ${selected ? 'selected' : ''}`} key={node.id} role="button" tabIndex={0} aria-label={`${node.label}, ${node.detail}, ${node.status}; ${node.provenance.basis}`} aria-pressed={selected} onClick={() => onSelect(selectionForNode(node))} onKeyDown={(event) => activate(event, () => onSelect(selectionForNode(node)))}>
            <rect className="graph-node-halo" x={node.x - 5} y={node.y - 5} width={node.width + 10} height={node.height + 10} rx="3" />
            <rect className="graph-node-card" x={node.x} y={node.y} width={node.width} height={node.height} rx="2" />
            <rect className="graph-node-mark" x={node.x} y={node.y} width="5" height={node.height} rx="2" />
            <text x={node.x + 17} y={node.y + 25} className="graph-node-label">{node.label}</text>
            <text x={node.x + 17} y={node.y + 44} className="graph-node-detail">{node.detail}</text>
            <text x={node.x + 17} y={node.y + 61} className="graph-node-status">{node.status} · {node.provenance.basis}</text>
          </g> })}
        </g>
      </svg> : <div className="graph-empty"><strong>NO GRAPH NODES</strong><span>{view.warnings[0] || 'Awaiting source telemetry for this projection.'}</span></div>}
    </div>
    <div className="graph-list" aria-label={`${view.title} accessible list view`}>
      {view.nodes.map((node) => <button type="button" className={`graph-list-item ${selectedId === node.id ? 'selected' : ''}`} key={node.id} onClick={() => onSelect(selectionForNode(node))}><span className={`graph-list-mark ${node.tone}`}></span><span><strong>{node.label}</strong><small>{node.detail} · {node.provenance.basis}</small></span></button>)}
      {view.edges.map((edge) => <button type="button" className={`graph-list-item edge-item ${selectedId === edge.id ? 'selected' : ''}`} key={edge.id} onClick={() => onSelect(selectionForEdge(edge))}><span className={`graph-list-mark ${edge.tone}`}></span><span><strong>{edge.label}</strong><small>{edge.from} → {edge.to} · {edge.provenance.basis}</small></span></button>)}
    </div>
  </div>
}
