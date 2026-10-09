import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

async function source(relativePath: string): Promise<string> {
  return readFile(`${projectRoot}/${relativePath}`, "utf8");
}

describe("production dashboard delivery contract", () => {
  it("keeps demo fixture imports out of the App production component", async () => {
    const app = await source("src/web/App.tsx");
    const main = await source("src/web/main.tsx");

    expect(app).not.toContain("./demo-fixture");
    expect(main).toContain('import.meta.env.MODE === "demo"');
    expect(main).toMatch(/import\(["']\.\/demo-fixture["']\)/);
  });

  it("disables production browser source maps", async () => {
    const vite = await source("vite.config.ts");
    expect(vite).toContain("sourcemap: false");
    expect(vite).not.toContain("sourcemap: true");
  });
});
