import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface NugetLockDependency {
  type?: string;
  resolved?: string;
  contentHash?: string;
  dependencies?: Record<string, string>;
}

export interface NugetLockFramework {
  dependencies?: Record<string, NugetLockDependency>;
}

export interface NugetPackagesLock {
  version?: number;
  dependencies?: Record<string, NugetLockFramework>;
}

export async function readNugetPackagesLock(
  rootPath: string,
): Promise<NugetPackagesLock> {
  const filePath = join(rootPath, "packages.lock.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as NugetPackagesLock;
}
