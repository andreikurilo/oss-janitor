import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, basename } from "node:path";
import type {
  AnalysisIssue,
  AnalysisResult,
  DependencyEdge,
  DependencyNode,
} from "../../domain/types.js";
import { readCsproj } from "./csproj.js";
import { readNugetPackagesLock } from "./packagesLock.js";
import { readNugetPackageLicense } from "./licenseReader.js";
import { finalizeAnalysis } from "../../common/analysisHelpers.js";

type PackageReference = { name: string; version?: string };

function addNugetProjectNode(
  nodes: DependencyNode[],
  rootId: string,
  projectName: string,
): void {
  nodes.push({
    id: rootId,
    name: projectName,
    ecosystem: "nuget",
    direct: true,
    dev: false,
  });
}

function addDirectPackageReferences(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  rootId: string,
  packageReferences: Array<PackageReference>,
): void {
  for (const pkg of packageReferences) {
    const nodeId = makeNugetNodeId(pkg.name, pkg.version);

    nodes.push({
      id: nodeId,
      name: pkg.name,
      versionRange: pkg.version,
      resolvedVersion: pkg.version,
      ecosystem: "nuget",
      direct: true,
      dev: false,
    });

    edges.push({
      from: rootId,
      to: nodeId,
      kind: "depends_on",
    });
  }
}

async function addLockfileDependencies(
  rootPath: string,
  packageReferences: Array<PackageReference>,
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  issues: AnalysisIssue[],
): Promise<void> {
  const lockPath = join(rootPath, "packages.lock.json");

  if (!(await exists(lockPath))) {
    issues.push({
      id: "missing-lockfile",
      type: "missing_lockfile",
      severity: "low",
      message:
        "packages.lock.json was not found. Falling back to direct dependency analysis from .csproj.",
    });
    return;
  }

  const directPackageNames = new Set(packageReferences.map((pkg) => pkg.name));
  const lock = await readNugetPackagesLock(rootPath);

  for (const framework of Object.values(lock.dependencies ?? {})) {
    addFrameworkDependencies(
      nodes,
      edges,
      framework.dependencies ?? {},
      directPackageNames,
    );
  }
}

function addFrameworkDependencies(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  dependencies: Record<
    string,
    {
      resolved?: string;
      dependencies?: Record<string, string>;
    }
  >,
  directPackageNames: Set<string>,
): void {
  for (const [name, dep] of Object.entries(dependencies)) {
    const fromId = makeNugetNodeId(name, dep.resolved);

    nodes.push({
      id: fromId,
      name,
      resolvedVersion: dep.resolved,
      ecosystem: "nuget",
      direct: directPackageNames.has(name),
      dev: false,
    });

    addTransitiveDependencies(nodes, edges, fromId, dep.dependencies ?? {});
  }
}

function addTransitiveDependencies(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  fromId: string,
  dependencies: Record<string, string>,
): void {
  for (const [childName, childVersion] of Object.entries(dependencies)) {
    const childId = makeNugetNodeId(childName, childVersion);

    nodes.push({
      id: childId,
      name: childName,
      resolvedVersion: childVersion,
      ecosystem: "nuget",
      direct: false,
      dev: false,
    });

    edges.push({
      from: fromId,
      to: childId,
      kind: "depends_on",
    });
  }
}

async function finalizeNugetAnalysis(input: {
  projectName: string;
  rootPath: string;
  rootId: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  issues: AnalysisIssue[];
}): Promise<AnalysisResult> {
  return finalizeAnalysis(
    {
      rootId: input.rootId,
      project: {
        name: input.projectName,
        rootPath: input.rootPath,
        ecosystem: "nuget",
      },
      nodes: input.nodes,
      edges: input.edges,
      issues: input.issues,
    },
    enrichNugetNodeLicenses,
  );
}

export class NugetAnalyzer {
  async canAnalyze(rootPath: string): Promise<boolean> {
    const csprojPath = await findSingleCsproj(rootPath);
    return csprojPath !== null;
  }

  async analyze(rootPath: string): Promise<AnalysisResult> {
    const issues: AnalysisIssue[] = [];

    try {
      const csprojPath = await findSingleCsproj(rootPath);

      if (!csprojPath) {
        return emptyResult(rootPath, issues, {
          id: "missing-manifest",
          type: "missing_manifest",
          severity: "high",
          message: "No .csproj file found.",
        });
      }

      const projectName = basename(csprojPath).replace(/\.csproj$/, "");
      const rootId = `project:nuget:${projectName}`;
      const nodes: DependencyNode[] = [];
      const edges: DependencyEdge[] = [];

      addNugetProjectNode(nodes, rootId, projectName);

      const csproj = await readCsproj(csprojPath);
      addDirectPackageReferences(
        nodes,
        edges,
        rootId,
        csproj.packageReferences,
      );

      await addLockfileDependencies(
        rootPath,
        csproj.packageReferences,
        nodes,
        edges,
        issues,
      );

      return finalizeNugetAnalysis({
        projectName,
        rootPath,
        rootId,
        nodes,
        edges,
        issues,
      });
    } catch (error) {
      issues.push({
        id: "invalid-manifest",
        type: "invalid_manifest",
        severity: "high",
        message: error instanceof Error ? error.message : "Unknown error",
      });

      return emptyResult(rootPath, issues);
    }
  }
}

async function enrichNugetNodeLicenses(
  nodes: DependencyNode[],
): Promise<DependencyNode[]> {
  const enriched: DependencyNode[] = [];

  for (const node of nodes) {
    if (node.id.startsWith("project:")) {
      enriched.push(node);
      continue;
    }

    const licenseInfo = await readNugetPackageLicense(
      node.name,
      node.resolvedVersion ?? node.versionRange,
    );

    enriched.push({
      ...node,
      license: licenseInfo.license ?? "unknown",
      licenseSource: licenseInfo.licenseSource,
    });
  }

  return enriched;
}

async function findSingleCsproj(rootPath: string): Promise<string | null> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const csproj = entries.find(
    (entry) => entry.isFile() && entry.name.endsWith(".csproj"),
  );
  return csproj ? join(rootPath, csproj.name) : null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function makeNugetNodeId(name: string, version?: string): string {
  return `pkg:nuget:${name}@${version ?? "unknown"}`;
}

function emptyResult(
  rootPath: string,
  issues: AnalysisIssue[],
  extraIssue?: AnalysisIssue,
): AnalysisResult {
  const allIssues = extraIssue ? [...issues, extraIssue] : issues;

  return {
    project: {
      name: "unknown-project",
      rootPath,
      ecosystem: "nuget",
    },
    summary: {
      totalPackages: 0,
      directPackages: 0,
      transitivePackages: 0,
      devPackages: 0,
      knownLicenses: 0,
      unknownLicenses: 0,
    },
    nodes: [],
    edges: [],
    issues: allIssues,
  };
}
