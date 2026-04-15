import type { AnalysisIssue, DependencyNode } from "../domain/types.js";

const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "0BSD",
  "ISC",
  "Python-2.0",
]);

type Reason = "weak_copyleft" | "attribution_or_data" | "other";
type Kind = "safe" | "review" | "risky";

const REVIEW_LICENSES = new Set(["MPL-2.0", "EPL-2.0", "CC-BY-4.0"]);

const STRONG_COPYLEFT_PATTERNS = ["GPL", "AGPL", "LGPL"];

export function analyzeLicenseIssues(nodes: DependencyNode[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  for (const node of nodes) {
    if (node.id.startsWith("project:")) {
      continue;
    }

    const issue = createLicenseIssue(node);
    if (issue) {
      issues.push(issue);
    }
  }

  return dedupeIssues(issues);
}

function createLicenseIssue(node: DependencyNode): AnalysisIssue | null {
  const rawLicense = normalizeLicense(node.license);

  if (!rawLicense || rawLicense === "unknown") {
    return {
      id: `unknown-license:${node.id}`,
      type: "unknown_license",
      severity: "medium",
      message: `Package ${node.name} has an unknown license.`,
      packageId: node.id,
      packageName: node.name,
    };
  }

  const classification = classifyLicenseExpression(rawLicense);

  if (classification.kind === "safe") {
    return null;
  }

  if (classification.kind === "review") {
    return {
      id: `review-license:${node.id}`,
      type: "disallowed_license",
      severity: "medium",
      message: `Package ${node.name} ${getReviewReasonText(classification.reason)}: ${rawLicense}.`,
      packageId: node.id,
      packageName: node.name,
    };
  }

  return {
    id: `copyleft-license:${node.id}`,
    type: "copyleft_license",
    severity: "high",
    message: `Package ${node.name} uses a strong copyleft license: ${rawLicense}.`,
    packageId: node.id,
    packageName: node.name,
  };
}

function getReviewReasonText(reason?: Reason): string {
  if (reason === "weak_copyleft") {
    return "uses a weak copyleft license";
  }

  if (reason === "attribution_or_data") {
    return "uses a license that should be reviewed for attribution or data usage";
  }

  return "uses a non-standard license that should be reviewed";
}

function normalizeLicense(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseLicenseExpression(license: string): string[] {
  return license
    .replaceAll(/[()]/g, "")
    .split(/\s+OR\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function classifyLicenseExpression(license: string): {
  kind: Kind;
  reason?: Reason;
} {
  const parts = parseLicenseExpression(license);

  if (parts.length === 0) {
    return { kind: "review", reason: "other" };
  }

  // If any option is clearly permissive, the expression is effectively safe.
  // Example: "BSD-3-Clause OR GPL-2.0" or "WTFPL OR MIT"
  if (parts.some(isPermissiveLicense)) {
    return { kind: "safe" };
  }

  // Weak copyleft / attribution / review-style licenses
  if (parts.some((part) => REVIEW_LICENSES.has(part))) {
    if (parts.includes("MPL-2.0") || parts.includes("EPL-2.0")) {
      return { kind: "review", reason: "weak_copyleft" };
    }

    if (parts.includes("CC-BY-4.0")) {
      return { kind: "review", reason: "attribution_or_data" };
    }

    return { kind: "review", reason: "other" };
  }

  // Only mark as risky if no safe option exists and some option is strong copyleft.
  if (parts.some(isStrongCopyleftLicense)) {
    return { kind: "risky" };
  }

  return { kind: "review", reason: "other" };
}

function isPermissiveLicense(license: string): boolean {
  if (PERMISSIVE_LICENSES.has(license)) {
    return true;
  }

  // Treat dual permissive forms as safe when split doesn't catch them.
  return false;
}

function isStrongCopyleftLicense(license: string): boolean {
  return STRONG_COPYLEFT_PATTERNS.some((pattern) => license.includes(pattern));
}

function dedupeIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  const seen = new Set<string>();
  const result: AnalysisIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.type}:${issue.packageId ?? ""}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(issue);
  }

  return result;
}
