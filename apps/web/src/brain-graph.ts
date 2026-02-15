import type { BrainGenome, NodeGene, ConnectionGene } from '@living-bugs/sim-core';

// ============================================================
// Brain Graph Visualization — Canvas 2D network topology viewer
// ============================================================

interface NodeLayout {
  id: number;
  type: 'input' | 'hidden' | 'output';
  activation: string;
  x: number;
  y: number;
  layer: number;
}

const NODE_RADIUS = 10;
const INPUT_COLOR = '#4a90d9';
const OUTPUT_COLOR = '#d94a4a';
const HIDDEN_COLOR = '#888888';
const POSITIVE_COLOR = '#22aa44';
const NEGATIVE_COLOR = '#cc3333';
const DISABLED_COLOR = '#666666';
const BG_COLOR = '#1a1a2e';
const TEXT_COLOR = '#cccccc';
const LABEL_COLOR = '#aaaaaa';

/**
 * Render a neural network graph onto a canvas.
 */
export function renderBrainGraph(
  canvas: HTMLCanvasElement,
  genome: BrainGenome,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  if (genome.nodeGenes.length === 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No brain data', width / 2, height / 2);
    return;
  }

  // Categorize nodes
  const inputs = genome.nodeGenes.filter(n => n.type === 'input');
  const outputs = genome.nodeGenes.filter(n => n.type === 'output');
  const hidden = genome.nodeGenes.filter(n => n.type === 'hidden');

  // Compute layer depths for hidden nodes using topological depth
  const hiddenLayers = computeHiddenLayers(genome, inputs, outputs, hidden);
  const maxLayer = Math.max(1, ...hiddenLayers.values(), 0);

  // Layout nodes
  const nodes = new Map<number, NodeLayout>();
  const padding = 40;
  const layerCount = maxLayer + 2; // 0=input, 1..maxLayer=hidden, maxLayer+1=output
  const layerWidth = (width - 2 * padding) / Math.max(layerCount - 1, 1);

  // Input nodes (left column)
  layoutColumn(inputs, 0, padding, layerWidth, height, padding, nodes);

  // Hidden nodes (middle layers)
  const hiddenByLayer = new Map<number, NodeGene[]>();
  for (const h of hidden) {
    const layer = hiddenLayers.get(h.id) ?? 1;
    if (!hiddenByLayer.has(layer)) hiddenByLayer.set(layer, []);
    hiddenByLayer.get(layer)!.push(h);
  }
  for (const [layer, layerNodes] of hiddenByLayer) {
    layoutColumn(layerNodes, layer, padding, layerWidth, height, padding, nodes);
  }

  // Output nodes (right column)
  layoutColumn(outputs, maxLayer + 1, padding, layerWidth, height, padding, nodes);

  // Draw connections
  for (const conn of genome.connectionGenes) {
    const from = nodes.get(conn.fromNode);
    const to = nodes.get(conn.toNode);
    if (!from || !to) continue;

    drawConnection(ctx, from, to, conn);
  }

  // Draw nodes
  for (const [, node] of nodes) {
    drawNode(ctx, node);
  }

  // Legend
  drawLegend(ctx, width, height, inputs.length, hidden.length, outputs.length,
    genome.connectionGenes.filter(c => c.enabled).length, genome.connectionGenes.length);
}

function computeHiddenLayers(
  genome: BrainGenome,
  inputs: NodeGene[],
  _outputs: NodeGene[],
  hidden: NodeGene[],
): Map<number, number> {
  const layers = new Map<number, number>();
  const inputIds = new Set(inputs.map(n => n.id));

  // BFS from inputs to compute depth
  const adjacency = new Map<number, number[]>();
  for (const conn of genome.connectionGenes) {
    if (!conn.enabled) continue;
    if (!adjacency.has(conn.fromNode)) adjacency.set(conn.fromNode, []);
    adjacency.get(conn.fromNode)!.push(conn.toNode);
  }

  // BFS
  const queue: { id: number; depth: number }[] = [];
  for (const id of inputIds) {
    queue.push({ id, depth: 0 });
  }

  const visited = new Map<number, number>();
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) && (visited.get(id)! >= depth)) continue;
    visited.set(id, depth);

    const neighbors = adjacency.get(id) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next) || visited.get(next)! < depth + 1) {
        queue.push({ id: next, depth: depth + 1 });
      }
    }
  }

  // Assign layers to hidden nodes (1-indexed from inputs)
  const hiddenIds = new Set(hidden.map(n => n.id));
  for (const [id, depth] of visited) {
    if (hiddenIds.has(id)) {
      layers.set(id, Math.max(1, depth));
    }
  }

  // Any hidden nodes not reached get layer 1
  for (const h of hidden) {
    if (!layers.has(h.id)) {
      layers.set(h.id, 1);
    }
  }

  // Normalize: compress layers to be sequential
  const usedLayers = [...new Set(layers.values())].sort((a, b) => a - b);
  const layerMap = new Map<number, number>();
  usedLayers.forEach((l, i) => layerMap.set(l, i + 1));
  for (const [id, layer] of layers) {
    layers.set(id, layerMap.get(layer) ?? 1);
  }

  return layers;
}

function layoutColumn(
  nodeGenes: NodeGene[],
  layer: number,
  paddingX: number,
  layerWidth: number,
  height: number,
  paddingY: number,
  nodes: Map<number, NodeLayout>,
): void {
  const x = paddingX + layer * layerWidth;
  const count = nodeGenes.length;
  const spacing = Math.min(
    (height - 2 * paddingY) / Math.max(count, 1),
    30
  );
  const totalHeight = spacing * Math.max(count - 1, 0);
  const startY = (height - totalHeight) / 2;

  for (let i = 0; i < count; i++) {
    const n = nodeGenes[i];
    nodes.set(n.id, {
      id: n.id,
      type: n.type,
      activation: n.activation,
      x,
      y: startY + i * spacing,
      layer,
    });
  }
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: NodeLayout,
  to: NodeLayout,
  conn: ConnectionGene,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);

  // Use bezier curves for visual clarity
  const cpOffset = Math.abs(to.x - from.x) * 0.4;
  ctx.bezierCurveTo(
    from.x + cpOffset, from.y,
    to.x - cpOffset, to.y,
    to.x, to.y,
  );

  if (!conn.enabled) {
    ctx.strokeStyle = DISABLED_COLOR;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 0.5;
  } else {
    const absWeight = Math.min(Math.abs(conn.weight), 5);
    ctx.strokeStyle = conn.weight >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
    ctx.setLineDash([]);
    ctx.lineWidth = 0.5 + (absWeight / 5) * 3;
    ctx.globalAlpha = 0.3 + (absWeight / 5) * 0.7;
  }

  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: NodeLayout,
): void {
  // Circle
  ctx.beginPath();
  ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);

  switch (node.type) {
    case 'input': ctx.fillStyle = INPUT_COLOR; break;
    case 'output': ctx.fillStyle = OUTPUT_COLOR; break;
    case 'hidden': ctx.fillStyle = HIDDEN_COLOR; break;
  }
  ctx.fill();

  // Border
  ctx.strokeStyle = '#ffffff44';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Activation label (for hidden/output nodes)
  if (node.type !== 'input') {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Abbreviation
    const abbr = node.activation.slice(0, 3);
    ctx.fillText(abbr, node.x, node.y);
  }
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  inputCount: number,
  hiddenCount: number,
  outputCount: number,
  enabledConns: number,
  totalConns: number,
): void {
  const y = height - 12;
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const items = [
    { color: INPUT_COLOR, text: `In: ${inputCount}` },
    { color: HIDDEN_COLOR, text: `Hid: ${hiddenCount}` },
    { color: OUTPUT_COLOR, text: `Out: ${outputCount}` },
    { color: LABEL_COLOR, text: `Conn: ${enabledConns}/${totalConns}` },
  ];

  let x = 8;
  for (const item of items) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 8, 8, 8);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(item.text, x + 12, y);
    x += ctx.measureText(item.text).width + 22;
  }
}
