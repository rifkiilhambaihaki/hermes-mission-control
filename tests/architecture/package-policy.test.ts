import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, unknown>;
}

const forbiddenPatterns = [
  /ruang/i,
  /^@google/,
  /googleapis/i,
  /telegram/i,
  /telegraf/i,
  /typeorm/i,
  /sequelize/i,
  /prisma/i,
  /mongoose/i,
  /(^|\/)redis$/i,
  /ioredis/i,
  /openai/i,
  /anthropic/i,
  /langchain/i,
  /shelljs/i,
  /execa/i,
  /cross-spawn/i,
];

function forbiddenPackages(names: string[]): string[] {
  return names.filter((name) =>
    forbiddenPatterns.some((pattern) => pattern.test(name)),
  );
}

describe("package policy", () => {
  it("contains no forbidden direct dependency", async () => {
    const manifest = JSON.parse(
      await readFile(`${projectRoot}/package.json`, "utf8"),
    ) as PackageManifest;
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    expect(forbiddenPackages(names)).toEqual([]);
  });

  it("contains no forbidden transitive dependency in the lockfile", async () => {
    const lock = JSON.parse(
      await readFile(`${projectRoot}/package-lock.json`, "utf8"),
    ) as PackageLock;
    const names = Object.keys(lock.packages ?? {})
      .filter((path) => path.startsWith("node_modules/"))
      .map((path) => path.slice("node_modules/".length));

    expect(forbiddenPackages(names)).toEqual([]);
  });
});
