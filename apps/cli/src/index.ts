import { resolve } from "node:path";
import type { AnalysisResult, DependencyNode } from "@oss-janitor/core";
import { NpmAnalyzer, NugetAnalyzer } from "@oss-janitor/core";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const inputPath = getInputPath(args) ?? ".";
  const jsonMode = args.includes("--json");
  const summaryMode = args.includes("--summary");

  if (command !== "scan") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const rootPath = resolve(process.cwd(), inputPath);

  const npmAnalyzer = new NpmAnalyzer();
  if (await npmAnalyzer.canAnalyze(rootPath)) {
    const result = await npmAnalyzer.analyze(rootPath);
    renderResult(result, jsonMode, summaryMode);
    return;
  }

  const nugetAnalyzer = new NugetAnalyzer();
  if (await nugetAnalyzer.canAnalyze(rootPath)) {
    const result = await nugetAnalyzer.analyze(rootPath);
    renderResult(result, jsonMode, summaryMode);
    return;
  }

  console.error(
    "No supported manifest found. Expected package.json or .csproj.",
  );
  process.exitCode = 1;
}

function renderResult(
  result: AnalysisResult,
  jsonMode: boolean,
  summaryMode: boolean,
): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (summaryMode) {
    printSummary(result);
    return;
  }

  printPrettyResult(result);
}

function getInputPath(args: string[]): string | undefined {
  for (const arg of args.slice(1)) {
    if (!arg.startsWith("--")) {
      return arg;
    }
  }

  return undefined;
}

function printUsage(): void {
  console.log("Usage: oss-janitor scan <project-path> [--json] [--summary]");
}

function printPrettyResult(result: AnalysisResult): void {
  console.log("OSS Janitor");
  console.log(`Project: ${result.project.name}`);
  console.log(`Ecosystem: ${result.project.ecosystem}`);
  console.log("");

  printSummary(result);
  console.log("");
  printLicenseBreakdown(result);
  console.log("");

  const directDeps = result.nodes.filter(
    (node) => !node.id.startsWith("project:") && node.direct,
  );

  console.log("Direct dependencies");
  if (directDeps.length === 0) {
    console.log("- none");
  } else {
    for (const dep of sortNodesByName(directDeps)) {
      console.log(`- ${formatNode(dep)}`);
    }
  }

  console.log("");
  console.log("Dependency chains");

  const chains = buildDependencyChains(result);
  if (chains.length === 0) {
    console.log("- none");
  } else {
    for (const chain of chains) {
      console.log(`- ${chain}`);
    }
  }

  console.log("");
  console.log("Issues");
  if (result.issues.length === 0) {
    console.log("- none");
  } else {
    for (const issue of result.issues) {
      console.log(`- [${issue.severity}] ${issue.message}`);
    }
  }
}

function printSummary(result: AnalysisResult): void {
  console.log("Summary");
  console.log(`- Total packages: ${result.summary.totalPackages}`);
  console.log(`- Direct packages: ${result.summary.directPackages}`);
  console.log(`- Transitive packages: ${result.summary.transitivePackages}`);
  console.log(`- Dev packages: ${result.summary.devPackages}`);
  console.log(`- Known licenses: ${result.summary.knownLicenses}`);
  console.log(`- Unknown licenses: ${result.summary.unknownLicenses}`);
}

function sortNodesByName(nodes: DependencyNode[]): DependencyNode[] {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name));
}

function formatNode(node: DependencyNode): string {
  const version = node.resolvedVersion ?? node.versionRange ?? "unknown";
  const license = node.license ?? "unknown";
  return `${node.name}@${version} [${license}]`;
}

function buildDependencyChains(result: AnalysisResult): string[] {
  const projectNode = result.nodes.find((node) =>
    node.id.startsWith("project:"),
  );
  if (!projectNode) {
    return [];
  }

  const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();

  for (const edge of result.edges) {
    const existing = outgoing.get(edge.from) ?? [];
    existing.push(edge.to);
    outgoing.set(edge.from, existing);
  }

  const chains: string[] = [];
  const directIds = outgoing.get(projectNode.id) ?? [];

  for (const directId of directIds) {
    const directNode = nodeById.get(directId);
    if (!directNode) {
      continue;
    }

    const childChains = collectChains(directId, outgoing, nodeById);

    if (childChains.length === 0) {
      chains.push(directNode.name);
      continue;
    }

    for (const chain of childChains) {
      chains.push(`${directNode.name} -> ${chain}`);
    }
  }

  return [...new Set(chains)].sort((a, b) => a.localeCompare(b));
}

function collectChains(
  startId: string,
  outgoing: Map<string, string[]>,
  nodeById: Map<string, DependencyNode>,
): string[] {
  const children = outgoing.get(startId) ?? [];
  if (children.length === 0) {
    return [];
  }

  const results: string[] = [];

  for (const childId of children) {
    const childNode = nodeById.get(childId);
    if (!childNode) {
      continue;
    }

    const childChains = collectChains(childId, outgoing, nodeById);

    if (childChains.length === 0) {
      results.push(childNode.name);
      continue;
    }

    for (const chain of childChains) {
      results.push(`${childNode.name} -> ${chain}`);
    }
  }

  return results;
}

function printLicenseBreakdown(result: AnalysisResult): void {
  const counts = new Map<string, number>();

  for (const node of result.nodes) {
    if (node.id.startsWith("project:")) {
      continue;
    }

    const license = node.license ?? "unknown";
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }

    return a[0].localeCompare(b[0]);
  });

  console.log("License breakdown");
  if (sorted.length === 0) {
    console.log("- none");
    return;
  }

  for (const [license, count] of sorted) {
    console.log(`- ${license}: ${count}`);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}
