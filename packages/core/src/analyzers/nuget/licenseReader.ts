import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface NugetLicenseInfo {
  license?: string;
  licenseSource: "nuget_manifest" | "nuget_license_url" | "unknown";
}

export async function readNugetPackageLicense(
  packageName: string,
  version?: string,
): Promise<NugetLicenseInfo> {
  if (!version) {
    return {
      license: "unknown",
      licenseSource: "unknown",
    };
  }

  const packagePath = getNugetPackagePath(packageName, version);
  const nuspecXml = await readNuspecFile(packagePath);

  if (!nuspecXml) {
    return {
      license: "unknown",
      licenseSource: "unknown",
    };
  }

  const licenseExpression = extractLicenseExpression(nuspecXml);
  if (licenseExpression) {
    return {
      license: normalizeNugetLicenseValue(licenseExpression),
      licenseSource: "nuget_manifest",
    };
  }

  const licenseUrl = extractLicenseUrl(nuspecXml);
  if (licenseUrl) {
    return {
      license: normalizeNugetLicenseValue(licenseUrl),
      licenseSource: "nuget_license_url",
    };
  }

  return {
    license: "unknown",
    licenseSource: "unknown",
  };
}

function getNugetPackagePath(packageName: string, version: string): string {
  const basePath =
    process.env.NUGET_PACKAGES || join(homedir(), ".nuget", "packages");

  return join(basePath, packageName.toLowerCase(), version.toLowerCase());
}

async function readNuspecFile(packagePath: string): Promise<string | null> {
  try {
    const files = await readdir(packagePath);
    const nuspecFile = files.find((file) => file.endsWith(".nuspec"));

    if (!nuspecFile) {
      return null;
    }

    return await readFile(join(packagePath, nuspecFile), "utf8");
  } catch {
    return null;
  }
}
function extractLicenseExpression(nuspecXml: string): string | undefined {
  const regex =
    /<license\b[^>]*type=["']expression["'][^>]*>([^<]+)<\/license>/i;

  const match = regex.exec(nuspecXml);
  return match?.[1]?.trim();
}

function extractLicenseUrl(nuspecXml: string): string | undefined {
  const regex = /<licenseUrl>([^<]+)<\/licenseUrl>/i;

  const match = regex.exec(nuspecXml);
  return match?.[1]?.trim();
}

function normalizeNugetLicenseValue(value: string): string {
  const trimmed = value.trim();

  const regex = /^https:\/\/licenses\.nuget\.org\/(.+)$/i;
  const match = regex.exec(trimmed);

  if (match?.[1]) {
    return match[1];
  }

  return trimmed;
}
