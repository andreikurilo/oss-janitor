import { readFile } from "node:fs/promises";

export interface CsprojPackageReference {
  name: string;
  version?: string;
}

export interface CsprojFile {
  packageReferences: CsprojPackageReference[];
}

export async function readCsproj(filePath: string): Promise<CsprojFile> {
  const raw = await readFile(filePath, "utf8");

  const packageReferences: CsprojPackageReference[] = [];
  const regex =
    /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?[\s\S]*?(?:\/>|>([\s\S]*?)<\/PackageReference>)/g;

  for (const match of raw.matchAll(regex)) {
    const name = match[1];
    const versionFromAttr = match[2];
    const innerXml = match[3] ?? "";

    const versionRegex = /<Version>([^<]+)<\/Version>/;
    const versionMatch = versionRegex.exec(innerXml);
    const versionFromInner = versionMatch?.[1];

    packageReferences.push({
      name,
      version: versionFromAttr ?? versionFromInner,
    });
  }

  return { packageReferences };
}
