import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type {
  AnalysisIssue,
  AnalysisResult,
  DependencyEdge,
  DependencyNode,
} from "../../domain/types.js";
import { readPackageJson } from "./packageJson.js";
import {
  readPackageLock,
  type PackageLock,
  type PackageLockDependency,
  type PackageLockPackageEntry,
} from "./packageLock.js";
import { readInstalledPackageLicense } from "./licenseReader.js";
import { finalizeAnalysis } from "../../common/analysisHelpers.js";

export class NpmAnalyzer {
  async canAnalyze(rootPath: string): Promise<boolean> {
    try {
      await access(join(rootPath, "package.json"), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async analyze(rootPath: string): Promise<AnalysisResult> {
    const issues: AnalysisIssue[] = [];

    try {
      const pkg = await readPackageJson(rootPath);
      const projectName = pkg.name ?? "unknown-project";
      const rootId = `project:npm:${projectName}`;

      const hasLockfile = await fileExists(join(rootPath, "package-lock.json"));

      if (hasLockfile) {
        try {
          const lock = await readPackageLock(rootPath);
          return analyzeFromLockfile({
            rootPath,
            rootId,
            projectName,
            projectVersion: pkg.version,
            lock,
            issues,
          });
        } catch (error) {
          issues.push({
            id: "invalid-lockfile",
            type: "invalid_lockfile",
            severity: "high",
            message:
              error instanceof Error
                ? `Failed to read package-lock.json: ${error.message}`
                : "Failed to read package-lock.json",
          });
        }
      } else {
        issues.push({
          id: "missing-lockfile",
          type: "missing_lockfile",
          severity: "low",
          message:
            "package-lock.json was not found. Falling back to direct dependency analysis from package.json.",
        });
      }

      return analyzeFromManifest({
        rootPath,
        rootId,
        projectName,
        projectVersion: pkg.version,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        issues,
      });
    } catch (error) {
      issues.push({
        id: "invalid-manifest",
        type: "invalid_manifest",
        severity: "high",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while reading package.json",
      });

      return {
        project: {
          name: "unknown-project",
          rootPath,
          ecosystem: "npm",
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
        issues,
      };
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function analyzeFromManifest(input: {
  rootPath: string;
  rootId: string;
  projectName: string;
  projectVersion?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  issues: AnalysisIssue[];
}): Promise<AnalysisResult> {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];

  nodes.push({
    id: input.rootId,
    name: input.projectName,
    versionRange: input.projectVersion,
    ecosystem: "npm",
    direct: true,
    dev: false,
  });

  addManifestDeps(input.rootId, input.dependencies, false, nodes, edges);
  addManifestDeps(input.rootId, input.devDependencies, true, nodes, edges);

  return finalizeAnalysis(
    {
      rootId: input.rootId,
      project: {
        name: input.projectName,
        version: input.projectVersion,
        rootPath: input.rootPath,
        ecosystem: "npm",
      },
      nodes,
      edges,
      issues: input.issues,
    },
    (nodes) => enrichNodeLicenses(input.rootPath, nodes),
  );
}

function addManifestDeps(
  parentId: string,
  deps: Record<string, string> | undefined,
  dev: boolean,
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): void {
  for (const [name, versionRange] of Object.entries(deps ?? {})) {
    const depId = makePackageId(name);

    nodes.push({
      id: depId,
      name,
      versionRange,
      ecosystem: "npm",
      direct: true,
      dev,
    });

    edges.push({
      from: parentId,
      to: depId,
      kind: "depends_on",
    });
  }
}

async function analyzeFromLockfile(input: {
  rootPath: string;
  rootId: string;
  projectName: string;
  projectVersion?: string;
  lock: PackageLock;
  issues: AnalysisIssue[];
}): Promise<AnalysisResult> {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];

  nodes.push({
    id: input.rootId,
    name: input.projectName,
    versionRange: input.projectVersion,
    resolvedVersion: input.lock.version ?? input.projectVersion,
    ecosystem: "npm",
    direct: true,
    dev: false,
  });

  const packageEntries = input.lock.packages ?? {};

  if (Object.keys(packageEntries).length > 0) {
    buildGraphFromPackagesField({
      rootId: input.rootId,
      packages: packageEntries,
      nodes,
      edges,
    });
  } else {
    for (const [name, dep] of Object.entries(input.lock.dependencies ?? {})) {
      addDependencyTree({
        parentId: input.rootId,
        name,
        dependency: dep,
        nodes,
        edges,
        direct: true,
      });
    }
  }

  return finalizeAnalysis(
    {
      rootId: input.rootId,
      project: {
        name: input.projectName,
        version: input.projectVersion,
        rootPath: input.rootPath,
        ecosystem: "npm",
      },
      nodes,
      edges,
      issues: input.issues,
    },
    (nodes) => enrichNodeLicenses(input.rootPath, nodes),
  );
}

function buildGraphFromPackagesField(input: {
  rootId: string;
  packages: Record<string, PackageLockPackageEntry>;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}): void {
  const rootDependencyNames = getRootDependencyNames(input.packages);

  addPackageNodes(input.packages, rootDependencyNames, input.nodes);
  addRootDependencyEdges(
    input.rootId,
    input.packages,
    rootDependencyNames,
    input.edges,
  );
  addPackageDependencyEdges(input.packages, input.edges);
}

function getRootDependencyNames(
  packages: Record<string, PackageLockPackageEntry>,
): Set<string> {
  const rootEntry = packages[""] ?? {};

  return new Set<string>([
    ...Object.keys(rootEntry.dependencies ?? {}),
    ...Object.keys(rootEntry.devDependencies ?? {}),
    ...Object.keys(rootEntry.optionalDependencies ?? {}),
  ]);
}

function addPackageNodes(
  packages: Record<string, PackageLockPackageEntry>,
  rootDependencyNames: Set<string>,
  nodes: DependencyNode[],
): void {
  for (const [pkgPath, pkgEntry] of Object.entries(packages)) {
    const packageName = getValidPackageName(pkgPath);
    if (!packageName) {
      continue;
    }

    nodes.push({
      id: makeResolvedPackageId(packageName, pkgEntry.version),
      name: packageName,
      resolvedVersion: pkgEntry.version,
      ecosystem: "npm",
      direct: isDirectDependencyPath(pkgPath, packageName, rootDependencyNames),
      dev: pkgEntry.dev ?? false,
    });
  }
}

function addRootDependencyEdges(
  rootId: string,
  packages: Record<string, PackageLockPackageEntry>,
  rootDependencyNames: Set<string>,
  edges: DependencyEdge[],
): void {
  for (const directName of rootDependencyNames) {
    const directEntryInfo = findInstalledPackage(packages, "", directName);
    if (!directEntryInfo) {
      continue;
    }

    edges.push({
      from: rootId,
      to: makeResolvedPackageId(directName, directEntryInfo.entry.version),
      kind: "depends_on",
    });
  }
}

function addPackageDependencyEdges(
  packages: Record<string, PackageLockPackageEntry>,
  edges: DependencyEdge[],
): void {
  for (const [pkgPath, pkgEntry] of Object.entries(packages)) {
    const packageName = getValidPackageName(pkgPath);
    if (!packageName) {
      continue;
    }

    const fromId = makeResolvedPackageId(packageName, pkgEntry.version);

    for (const childName of Object.keys(pkgEntry.dependencies ?? {})) {
      const childInfo = findInstalledPackage(packages, pkgPath, childName);
      if (!childInfo) {
        continue;
      }

      edges.push({
        from: fromId,
        to: makeResolvedPackageId(childName, childInfo.entry.version),
        kind: "depends_on",
      });
    }
  }
}

function getValidPackageName(pkgPath: string): string | null {
  if (pkgPath === "") {
    return null;
  }

  if (shouldIgnorePackagePath(pkgPath)) {
    return null;
  }

  return getPackageNameFromPath(pkgPath);
}

function shouldIgnorePackagePath(pkgPath: string): boolean {
  return pkgPath.startsWith("apps/") || pkgPath.startsWith("packages/");
}

function isDirectDependencyPath(
  pkgPath: string,
  packageName: string,
  rootDependencyNames: Set<string>,
): boolean {
  return (
    pkgPath === `node_modules/${packageName}` &&
    rootDependencyNames.has(packageName)
  );
}

function findInstalledPackage(
  packages: Record<string, PackageLockPackageEntry>,
  fromPkgPath: string,
  dependencyName: string,
): { path: string; entry: PackageLockPackageEntry } | null {
  const candidatePaths = buildCandidateDependencyPaths(
    fromPkgPath,
    dependencyName,
  );

  for (const candidatePath of candidatePaths) {
    const entry = packages[candidatePath];
    if (entry) {
      return { path: candidatePath, entry };
    }
  }

  return null;
}

function buildCandidateDependencyPaths(
  fromPkgPath: string,
  dependencyName: string,
): string[] {
  const result: string[] = [];
  let currentPath: string | null = fromPkgPath;

  while (currentPath !== null) {
    if (currentPath === "") {
      result.push(`node_modules/${dependencyName}`);
      break;
    }

    result.push(`${currentPath}/node_modules/${dependencyName}`);
    currentPath = getParentPackagePath(currentPath);
  }

  result.push(`node_modules/${dependencyName}`);

  return [...new Set(result)];
}

function getParentPackagePath(pkgPath: string): string | null {
  const marker = "/node_modules/";
  const index = pkgPath.lastIndexOf(marker);

  if (index === -1) {
    return "";
  }

  return pkgPath.slice(0, index);
}

function getPackageNameFromPath(pkgPath: string): string | null {
  const marker = "node_modules/";
  const index = pkgPath.lastIndexOf(marker);

  if (index === -1) {
    return null;
  }

  return pkgPath.slice(index + marker.length);
}

function addDependencyTree(input: {
  parentId: string;
  name: string;
  dependency: PackageLockDependency;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  direct: boolean;
}): void {
  const nodeId = makeResolvedPackageId(input.name, input.dependency.version);

  input.nodes.push({
    id: nodeId,
    name: input.name,
    resolvedVersion: input.dependency.version,
    ecosystem: "npm",
    direct: input.direct,
    dev: input.dependency.dev ?? false,
  });

  input.edges.push({
    from: input.parentId,
    to: nodeId,
    kind: "depends_on",
  });

  for (const [childName, childDependency] of Object.entries(
    input.dependency.dependencies ?? {},
  )) {
    addDependencyTree({
      parentId: nodeId,
      name: childName,
      dependency: childDependency,
      nodes: input.nodes,
      edges: input.edges,
      direct: false,
    });
  }
}

function makePackageId(name: string): string {
  return `pkg:npm:${name}`;
}

function makeResolvedPackageId(name: string, version?: string): string {
  return `pkg:npm:${name}@${version ?? "unknown"}`;
}

async function enrichNodeLicenses(
  rootPath: string,
  nodes: DependencyNode[],
): Promise<DependencyNode[]> {
  const enriched: DependencyNode[] = [];

  for (const node of nodes) {
    if (node.id.startsWith("project:")) {
      enriched.push(node);
      continue;
    }

    const installedLicense = await readInstalledPackageLicense(
      rootPath,
      node.name,
    );

    if (installedLicense) {
      enriched.push({
        ...node,
        license: installedLicense,
        licenseSource: "installed_manifest",
      });
      continue;
    }

    enriched.push({
      ...node,
      license: "unknown",
      licenseSource: "unknown",
    });
  }

  return enriched;
}
