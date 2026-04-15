import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface InstalledPackageJson {
  license?: string;
  licenses?: Array<{ type?: string }> | string[];
}

function isStringAndNotEmpty(str?: string | undefined | object): str is string {
  return typeof str === "string" && str.trim().length > 0;
}

export async function readInstalledPackageLicense(
  rootPath: string,
  packageName: string,
): Promise<string | undefined> {
  const packageJsonPath = join(
    rootPath,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as InstalledPackageJson;

    if (isStringAndNotEmpty(pkg.license)) {
      return pkg.license;
    }

    if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
      const first = pkg.licenses[0];

      if (isStringAndNotEmpty(first)) {
        return first;
      }

      if (
        typeof first === "object" &&
        first !== null &&
        isStringAndNotEmpty(first.type)
      ) {
        return first.type;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
