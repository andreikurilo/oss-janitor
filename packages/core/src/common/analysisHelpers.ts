import type {
  AnalysisIssue,
  AnalysisResult,
  DependencyEdge,
  DependencyNode,
} from "../domain/types.js";
import { analyzeLicenseIssues } from "../policies/licensePolicy.js";

function dedupeNodes(nodes: DependencyNode[]): DependencyNode[] {
  const map = new Map<string, DependencyNode>();

  for (const node of nodes) {
    const existing = map.get(node.id);

    if (!existing) {
      map.set(node.id, node);
      continue;
    }

    map.set(node.id, {
      ...existing,
      direct: existing.direct || node.direct,
      dev: existing.dev || node.dev,
      versionRange: existing.versionRange ?? node.versionRange,
      resolvedVersion: existing.resolvedVersion ?? node.resolvedVersion,
      license: existing.license ?? node.license,
      licenseSource: existing.licenseSource ?? node.licenseSource,
    });
  }

  return [...map.values()];
}

function dedupeEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const map = new Map<string, DependencyEdge>();

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}:${edge.kind}`;
    if (!map.has(key)) {
      map.set(key, edge);
    }
  }

  return [...map.values()];
}

function pruneToReachableSubgraph(
  rootId: string,
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): { nodes: DependencyNode[]; edges: DependencyEdge[] } {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const existing = adjacency.get(edge.from) ?? [];
    existing.push(edge.to);
    adjacency.set(edge.from, existing);
  }

  const visited = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return {
    nodes: nodes.filter((node) => visited.has(node.id)),
    edges: edges.filter(
      (edge) => visited.has(edge.from) && visited.has(edge.to),
    ),
  };
}

function buildSummary(nodes: DependencyNode[]): {
  totalPackages: number;
  directPackages: number;
  transitivePackages: number;
  devPackages: number;
  knownLicenses: number;
  unknownLicenses: number;
} {
  const packageNodes = nodes.filter((node) => !node.id.startsWith("project:"));
  const directPackages = packageNodes.filter((node) => node.direct).length;
  const devPackages = packageNodes.filter((node) => node.dev).length;
  const knownLicenses = packageNodes.filter(
    (node) => node.license && node.license !== "unknown",
  ).length;
  const unknownLicenses = packageNodes.length - knownLicenses;

  return {
    totalPackages: packageNodes.length,
    directPackages,
    transitivePackages: packageNodes.length - directPackages,
    devPackages,
    knownLicenses,
    unknownLicenses,
  };
}

export async function finalizeAnalysis(
  input: {
    rootId: string;
    project: AnalysisResult["project"];
    nodes: DependencyNode[];
    edges: DependencyEdge[];
    issues: AnalysisIssue[];
  },
  enrichLicenses: (nodes: DependencyNode[]) => Promise<DependencyNode[]>,
): Promise<AnalysisResult> {
  const dedupedNodes = dedupeNodes(input.nodes);
  const dedupedEdges = dedupeEdges(input.edges);
  const pruned = pruneToReachableSubgraph(
    input.rootId,
    dedupedNodes,
    dedupedEdges,
  );

  const enrichedNodes = await enrichLicenses(pruned.nodes);
  const summary = buildSummary(enrichedNodes);
  const licenseIssues = analyzeLicenseIssues(enrichedNodes);

  return {
    project: input.project,
    summary,
    nodes: enrichedNodes,
    edges: pruned.edges,
    issues: [...input.issues, ...licenseIssues],
  };
}
