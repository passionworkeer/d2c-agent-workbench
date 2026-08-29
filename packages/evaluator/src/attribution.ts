import {
  productionViolationSchema,
  type D2CSourceMap,
  type ProductionViolation,
  type Rect,
} from "@d2c/contracts";

export interface DiffCluster {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AttributionNode extends Rect {
  parentId?: string | null;
}

const OVERLAP_THRESHOLD = 0.05;

const clusterRect = (cluster: DiffCluster): Rect => ({
  x: cluster.left, y: cluster.top, width: Math.max(0, cluster.right - cluster.left), height: Math.max(0, cluster.bottom - cluster.top),
});

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function minimalNodes(nodeIds: string[], geometry: Record<string, AttributionNode>): string[] {
  const isAncestor = (candidate: string, nodeId: string): boolean => {
    let parentId = geometry[nodeId]?.parentId ?? null;
    while (parentId) {
      if (parentId === candidate) return true;
      parentId = geometry[parentId]?.parentId ?? null;
    }
    return false;
  };
  return nodeIds.filter((nodeId) => !nodeIds.some((other) => other !== nodeId && isAncestor(nodeId, other)));
}

function locatorFor(sourceMap: D2CSourceMap, nodeIds: string[]) {
  const ids = new Set(nodeIds);
  return sourceMap.locators.filter((locator) => ids.has(locator.nodeId));
}

const union = (clusters: DiffCluster[]): Rect => ({
  x: Math.min(...clusters.map((cluster) => cluster.left)),
  y: Math.min(...clusters.map((cluster) => cluster.top)),
  width: Math.max(...clusters.map((cluster) => cluster.right)) - Math.min(...clusters.map((cluster) => cluster.left)),
  height: Math.max(...clusters.map((cluster) => cluster.bottom)) - Math.min(...clusters.map((cluster) => cluster.top)),
});

export function attributeDiffClusters(
  clusters: DiffCluster[],
  geometry: Record<string, AttributionNode>,
  sourceMap: D2CSourceMap,
): ProductionViolation[] {
  const entries = clusters
    .map((cluster) => {
      const rect = clusterRect(cluster);
      const overlapped = Object.entries(geometry)
        .filter(([, node]) => {
          const smaller = Math.min(rect.width * rect.height, node.width * node.height);
          return smaller > 0 && intersectionArea(rect, node) / smaller > OVERLAP_THRESHOLD;
        })
        .map(([nodeId]) => nodeId);
      return { cluster, rect, minimal: minimalNodes(overlapped, geometry) };
    })
    .filter((entry) => entry.minimal.length > 0);

  const childrenByParent = new Map<string, Set<string>>();
  for (const nodeId of new Set(entries.flatMap((entry) => entry.minimal))) {
    const parentId = geometry[nodeId]?.parentId;
    if (!parentId) continue;
    const siblings = childrenByParent.get(parentId) ?? new Set<string>();
    siblings.add(nodeId);
    childrenByParent.set(parentId, siblings);
  }

  const violations: ProductionViolation[] = [];
  const consumed = new Set<number>();
  for (const [parent, siblings] of childrenByParent) {
    if (siblings.size < 2) continue;
    const involved = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.minimal.some((nodeId) => siblings.has(nodeId)));
    if (involved.length < 2) continue;
    involved.forEach(({ index }) => consumed.add(index));
    violations.push(productionViolationSchema.parse({
      id: `layout:${parent}`, severity: "P1", type: "layout", region: union(involved.map(({ entry }) => entry.cluster)),
      nodeIds: [parent], sourceLocators: locatorFor(sourceMap, [parent]),
      expected: { sharedTranslation: true }, actual: { siblings: [...siblings] },
      evidence: [], confidence: .95, suggestedAction: "多个子节点同向偏移，优先修正父容器布局或间距",
    }));
  }

  const styleByNode = new Map<string, DiffCluster[]>();
  for (const { cluster, index, minimal } of entries.map((entry, index) => ({ ...entry, index }))) {
    if (consumed.has(index)) continue;
    const nodeId = minimal[0] ?? "";
    if (!nodeId) continue;
    const list = styleByNode.get(nodeId) ?? [];
    list.push(cluster);
    styleByNode.set(nodeId, list);
  }
  for (const [nodeId, nodeClusters] of styleByNode) {
    const node = geometry[nodeId];
    const relativeArea = node ? union(nodeClusters).width * union(nodeClusters).height / Math.max(1, node.width * node.height) : 0;
    violations.push(productionViolationSchema.parse({
      id: `style:${nodeId}`, severity: relativeArea >= .3 ? "P2" : "P3", type: "style", region: union(nodeClusters),
      nodeIds: [nodeId], sourceLocators: locatorFor(sourceMap, [nodeId]),
      expected: { clusterCount: nodeClusters.length }, actual: { relativeArea },
      evidence: [], confidence: .9, suggestedAction: "修正该节点的局部样式差异",
    }));
  }

  return violations;
}
