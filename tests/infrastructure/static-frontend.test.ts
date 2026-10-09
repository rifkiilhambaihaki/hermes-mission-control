import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadFrontendAssets } from "../../src/infrastructure/static-frontend.js";

const temporaryDirectories: string[] = [];

async function createBuild(indexHtml: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hmc-static-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), indexHtml);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("fixed production frontend asset loader", () => {
  it("loads only JS and CSS files explicitly referenced by index.html", async () => {
    const root = await createBuild(
      '<link rel="stylesheet" href="/assets/app-123.css"><div id="root"></div><script type="module" src="/assets/app-123.js"></script>',
    );
    await writeFile(join(root, "assets", "app-123.js"), "const production = true;");
    await writeFile(join(root, "assets", "app-123.css"), "body { margin: 0; }");
    await writeFile(join(root, "assets", "app-123.js.map"), "SOURCE-MAP-CANARY");
    await writeFile(join(root, "private.txt"), "PRIVATE-FILE-CANARY");

    const bundle = await loadFrontendAssets(root);

    expect(bundle.indexHtml.toString("utf8")).toContain('id="root"');
    expect([...bundle.assets.keys()].sort()).toEqual([
      "/assets/app-123.css",
      "/assets/app-123.js",
    ]);
    expect(JSON.stringify([...bundle.assets.keys()])).not.toContain(".map");
    expect(JSON.stringify([...bundle.assets.keys()])).not.toContain("private.txt");
  });

  it.each([
    ["relative traversal", '<script src="/assets/../private.js"></script>'],
    ["encoded traversal", '<script src="/assets/%2e%2e%2fprivate.js"></script>'],
    ["source map", '<script src="/assets/app.js.map"></script>'],
    ["unsupported extension", '<script src="/assets/app.json"></script>'],
    ["external URL", '<script src="https://example.invalid/app.js"></script>'],
  ])("rejects %s references", async (_name, indexHtml) => {
    const root = await createBuild(indexHtml);
    await expect(loadFrontendAssets(root)).rejects.toThrow();
  });

  it("rejects symlinked assets instead of following them", async () => {
    const root = await createBuild('<script type="module" src="/assets/app.js"></script>');
    const outside = join(root, "outside.js");
    await writeFile(outside, "PRIVATE-SYMLINK-TARGET");
    await symlink(outside, join(root, "assets", "app.js"));

    await expect(loadFrontendAssets(root)).rejects.toThrow();
  });

  it("rejects a symlinked assets directory that escapes the canonical build root", async () => {
    const root = await createBuild('<script type="module" src="/assets/app.js"></script>');
    const outside = await mkdtemp(join(tmpdir(), "hmc-static-outside-"));
    temporaryDirectories.push(outside);
    await writeFile(join(outside, "app.js"), "PRIVATE-DIRECTORY-SYMLINK-CANARY");
    await rm(join(root, "assets"), { recursive: true });
    await symlink(outside, join(root, "assets"));

    await expect(loadFrontendAssets(root)).rejects.toThrow();
  });

  it("opens the fixed root before validating the descriptor target", async () => {
    const loaderSource = await readFile(
      new URL("../../src/infrastructure/static-frontend.ts", import.meta.url),
      "utf8",
    );
    const openRoot = loaderSource.indexOf("openNoFollowDirectory(approvedRoot)");
    const validateRoot = loaderSource.indexOf("realpath(descriptorRoot(rootDirectory))");

    expect(openRoot).toBeGreaterThan(-1);
    expect(validateRoot).toBeGreaterThan(openRoot);
  });

  it("uses descriptor-anchored traversal for intermediary-directory race resistance", async () => {
    const loaderSource = await readFile(
      new URL("../../src/infrastructure/static-frontend.ts", import.meta.url),
      "utf8",
    );

    expect(loaderSource).toContain("constants.O_DIRECTORY");
    expect(loaderSource).toContain("/proc/self/fd/");
    expect(loaderSource).toContain("directory.fd");
  });

  it("uses a maximum-plus-one bounded read instead of reading to EOF after stat", async () => {
    const loaderSource = await readFile(
      new URL("../../src/infrastructure/static-frontend.ts", import.meta.url),
      "utf8",
    );

    expect(loaderSource).toContain("maximumBytes + 1");
    expect(loaderSource).not.toContain("handle.readFile()");
  });

  it("fails closed when index.html is absent", async () => {
    const root = await createBuild("");
    await rm(join(root, "index.html"));

    await expect(loadFrontendAssets(root)).rejects.toThrow();
  });
});
