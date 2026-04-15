import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PackageLockDependency {
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  dependencies?: Record<string, PackageLockDependency>;
}

export interface PackageLockPackageEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface PackageLock {
  name?: string;
  version?: string;
  lockfileVersion?: number;
  dependencies?: Record<string, PackageLockDependency>;
  packages?: Record<string, PackageLockPackageEntry>;
}

export async function readPackageLock(rootPath: string): Promise<PackageLock> {
  const filePath = join(rootPath, "package-lock.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as PackageLock;
}
