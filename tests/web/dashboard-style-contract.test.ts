import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("dashboard visual contract", () => {
  it("keeps the DEMO DATA badge visible at every responsive breakpoint", async () => {
    const css = await readFile(`${projectRoot}/src/web/styles.css`, "utf8");
    const responsiveBlocks = css.match(/@media \(max-width:[\s\S]*?(?=\n@media |$)/g) ?? [];

    expect(responsiveBlocks.some((block) => /\.demo-badge\s*\{[^}]*display:\s*none/.test(block)))
      .toBe(false);
  });
});
