import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readPackageJson(rootPath: string): Promise<PackageJson> {
  const filePath = join(rootPath, "package.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as PackageJson;
}
