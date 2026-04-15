export type Ecosystem = "npm" | "nuget";

export interface ProjectDescriptor {
  name: string;
  version?: string;
  rootPath: string;
  ecosystem: Ecosystem;
}

export interface DependencyNode {
  id: string;
  name: string;
  versionRange?: string;
  resolvedVersion?: string;
  ecosystem: Ecosystem;
  direct: boolean;
  dev: boolean;
  license?: string;
  licenseSource?:
    | "lockfile"
    | "installed_manifest"
    | "nuget_manifest"
    | "nuget_license_url"
    | "unknown";
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "depends_on";
}

export interface AnalysisIssue {
  id: string;
  type:
    | "missing_manifest"
    | "missing_lockfile"
    | "unsupported_project"
    | "invalid_manifest"
    | "invalid_lockfile"
    | "unknown_license"
    | "disallowed_license"
    | "copyleft_license";
  severity: "low" | "medium" | "high";
  message: string;
  packageId?: string;
  packageName?: string;
}

export interface AnalysisResult {
  project: ProjectDescriptor;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  issues: AnalysisIssue[];
}

export interface AnalysisSummary {
  totalPackages: number;
  directPackages: number;
  transitivePackages: number;
  devPackages: number;
  knownLicenses: number;
  unknownLicenses: number;
}

export interface AnalysisResult {
  project: ProjectDescriptor;
  summary: AnalysisSummary;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  issues: AnalysisIssue[];
}
