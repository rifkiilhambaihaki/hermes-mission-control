import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceRoot = resolve(projectRoot, "src");
const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function importsOf(source: string): string[] {
  return [...source.matchAll(importPattern)].map((match) => match[1] ?? "");
}

function isNodeFs(specifier: string): boolean {
  return specifier === "node:fs" || specifier === "node:fs/promises" || specifier === "fs";
}

describe("architecture dependency boundaries", () => {
  it("keeps domain independent from frameworks, I/O, process execution, and adapters", async () => {
    const files = (await sourceFiles(resolve(sourceRoot, "domain"))).sort();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      if (/\bprocess\.env\b/.test(source)) {
        violations.push(`${relative(projectRoot, file)} -> process.env`);
      }
      for (const specifier of imports) {
        if (
          specifier === "fastify" ||
          specifier === "react" ||
          specifier === "react-dom" ||
          isNodeFs(specifier) ||
          specifier === "node:child_process" ||
          specifier.includes("adapters") ||
          specifier.includes("infrastructure")
        ) {
          violations.push(`${relative(projectRoot, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps frontend independent from server and adapters", async () => {
    const files = (await sourceFiles(resolve(sourceRoot, "web"))).sort();
    const violations: string[] = [];

    for (const file of files) {
      const imports = importsOf(await readFile(file, "utf8"));
      for (const specifier of imports) {
        if (
          specifier === "fastify" ||
          specifier === "node:child_process" ||
          isNodeFs(specifier) ||
          /(?:^|\/)(?:adapters|bootstrap|http|infrastructure|security)(?:\/|$)/.test(specifier)
        ) {
          violations.push(`${relative(projectRoot, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("reserves child_process exclusively for the exact safe-runner executor module", async () => {
    const files = (await sourceFiles(sourceRoot)).sort();
    const violations: string[] = [];
    const approvedModule =
      "src/adapters/hermes-cli/runner/bounded-process-executor.ts";
    let approvedImportCount = 0;

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      const relativeFile = relative(projectRoot, file);
      if (!imports.includes("node:child_process")) continue;
      if (relativeFile !== approvedModule) {
        violations.push(relativeFile);
        continue;
      }
      approvedImportCount += 1;
      if (!/import\s*\{\s*spawn\s*,\s*type\s+ChildProcess\s*\}\s*from\s*["']node:child_process["']/.test(source)) {
        violations.push(`${relativeFile} -> import must remain spawn-only`);
      }
      if (/\b(?:exec|execFile|fork)\s*\(/.test(source)) {
        violations.push(`${relativeFile} -> forbidden process primitive`);
      }
    }

    expect(approvedImportCount).toBe(1);
    expect(violations).toEqual([]);
  });

  it("keeps HTTP, domain, security, web, and generic infrastructure away from runner internals", async () => {
    const protectedRoots = ["http", "domain", "security", "web", "infrastructure"];
    const violations: string[] = [];

    for (const root of protectedRoots) {
      const files = (await sourceFiles(resolve(sourceRoot, root))).sort();
      for (const file of files) {
        const source = await readFile(file, "utf8");
        const imports = importsOf(source);
        if (
          imports.some(
            (specifier) =>
              specifier.includes("hermes-cli/runner") || specifier.includes("hermes-cli/parsers"),
          ) ||
          /\brawStdout\b|\brawStderr\b/.test(source)
        ) {
          violations.push(relative(projectRoot, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the retired status-all capability out of HTTP, frontend, and orchestration surfaces", async () => {
    const protectedRoots = ["http", "domain", "security", "web", "infrastructure", "bootstrap"];
    const violations: string[] = [];

    for (const root of protectedRoots) {
      for (const file of await sourceFiles(resolve(sourceRoot, root))) {
        const source = await readFile(file, "utf8");
        if (/HERMES_STATUS_ALL|status\s+--all|["']status["']\s*,\s*["']--all["']/.test(source)) {
          violations.push(relative(projectRoot, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps adapters independent from the UI", async () => {
    const files = (await sourceFiles(resolve(sourceRoot, "adapters"))).sort();
    const violations: string[] = [];
    const approvedFilesystemAdapters = new Set([
      "src/adapters/hermes-version-metadata/local-hermes-version-metadata-adapter.ts",
      "src/adapters/hermes-gateway-local/local-gateway-observation-adapter.ts",
      "src/adapters/hermes-scheduler-local/local-scheduler-observation-adapter.ts",
      "src/adapters/accounting-v2-snapshot/local-accounting-v2-snapshot-adapter.ts",
      "src/adapters/submission-tracker-snapshot/local-submission-tracker-snapshot-adapter.ts",
      "src/adapters/bank-journal-quality-snapshot/local-bank-journal-quality-snapshot-adapter.ts",
    ]);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      for (const specifier of imports) {
        if (specifier === "react" || specifier === "react-dom" || specifier.includes("web")) {
          violations.push(`${relative(projectRoot, file)} -> ${specifier}`);
        }
      }
      if (/\bprocess\.execPath\b/.test(source)) {
        violations.push(`${relative(projectRoot, file)} -> process.execPath`);
      }
      if (
        imports.some((specifier) => isNodeFs(specifier)) &&
        !approvedFilesystemAdapters.has(relative(projectRoot, file))
      ) {
        violations.push(`${relative(projectRoot, file)} -> filesystem I/O`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("confines local Hermes version metadata to a read-only server adapter", async () => {
    const adapterRoot = resolve(sourceRoot, "adapters/hermes-version-metadata");
    const files = (await sourceFiles(adapterRoot)).sort();
    const violations: string[] = [];
    const forbiddenImports = new Set([
      "node:child_process",
      "child_process",
      "node:http",
      "node:https",
      "node:net",
      "node:dns",
      "node:dns/promises",
      "node:tls",
    ]);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      const relativeFile = relative(projectRoot, file);
      for (const specifier of imports) {
        if (
          forbiddenImports.has(specifier) ||
          specifier.includes("hermes-cli/runner") ||
          specifier.includes("safe-hermes-runner")
        ) {
          violations.push(`${relativeFile} -> ${specifier}`);
        }
      }
      if (
        /(?:^|[^.A-Za-z0-9_$])(?:spawn|exec|execFile|fork)\s*\(/.test(source) ||
        /(?:^|["'`/])\.hermes(?:["'`/]|$)/.test(source)
      ) {
        violations.push(`${relativeFile} -> prohibited live integration marker`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("confines local Gateway observation to bounded read-only filesystem primitives", async () => {
    const adapterFile = resolve(
      sourceRoot,
      "adapters/hermes-gateway-local/local-gateway-observation-adapter.ts",
    );
    const source = await readFile(adapterFile, "utf8");
    const imports = importsOf(source);
    const forbiddenImports = new Set([
      "node:child_process",
      "child_process",
      "node:http",
      "node:https",
      "node:net",
      "node:dns",
      "node:dns/promises",
      "node:tls",
    ]);

    expect(imports.filter((specifier) => forbiddenImports.has(specifier))).toEqual([]);
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW");
    expect(source).toContain('resolve(paths.profileRoot, "gateway.pid")');
    expect(source).not.toMatch(
      /\b(?:writeFile|appendFile|truncate|unlink|rename|rm|mkdir|readdir|opendir|spawn|exec|execFile|fork)\s*\(/,
    );
    expect(source).not.toMatch(/\bprocess\.env\b|\/cmdline|\/environ|systemctl|journalctl/);
    expect(source).not.toMatch(/hermes(?:-agent)?\s+(?:gateway|status|cron|sessions|insights|skills|tools|memory|kanban)/);
  });

  it("confines local Scheduler observation to one bounded read-only registry", async () => {
    const adapterFile = resolve(
      sourceRoot,
      "adapters/hermes-scheduler-local/local-scheduler-observation-adapter.ts",
    );
    const source = await readFile(adapterFile, "utf8");
    const imports = importsOf(source);
    const forbiddenImports = new Set([
      "node:child_process",
      "child_process",
      "node:http",
      "node:https",
      "node:net",
      "node:dns",
      "node:dns/promises",
      "node:tls",
    ]);

    expect(imports.filter((specifier) => forbiddenImports.has(specifier))).toEqual([]);
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW");
    expect(source).toContain('resolve(cronRoot, "jobs.json")');
    expect(source).not.toMatch(
      /\b(?:writeFile|appendFile|truncate|unlink|rename|rm|mkdir|readdir|opendir|spawn|exec|execFile|fork)\s*\(/,
    );
    expect(source).not.toMatch(
      /\bprocess\.env\b|session(?:s)?\.db|systemctl|journalctl|\b(?:prompt|deliver|origin|chat_id|user_id|payload|credential)\b/,
    );
    expect(source).not.toMatch(/hermes(?:-agent)?\s+(?:cron|gateway|status|sessions|insights|skills|tools|memory|kanban)/);
  });

  it("confines local Accounting observation to the fixed sanitized snapshot", async () => {
    const adapterFile = resolve(
      sourceRoot,
      "adapters/accounting-v2-snapshot/local-accounting-v2-snapshot-adapter.ts",
    );
    const source = await readFile(adapterFile, "utf8");
    const imports = importsOf(source);
    const forbiddenImports = new Set([
      "node:child_process",
      "child_process",
      "node:http",
      "node:https",
      "node:net",
      "node:dns",
      "node:dns/promises",
      "node:tls",
    ]);

    expect(imports.filter((specifier) => forbiddenImports.has(specifier))).toEqual([]);
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW");
    expect(source).not.toMatch(
      /\b(?:writeFile|appendFile|truncate|unlink|rename|rm|mkdir|readdir|opendir|spawn|exec|execFile|fork)\s*\(/,
    );
    expect(source).not.toMatch(
      /\bprocess\.env\b|google_token|google_client_secret|Credentials|googleapis|Transactions_V2|Income_V2/,
    );
  });

  it("confines local Submission observation to the fixed sanitized snapshot", async () => {
    const adapterFile = resolve(
      sourceRoot,
      "adapters/submission-tracker-snapshot/local-submission-tracker-snapshot-adapter.ts",
    );
    const source = await readFile(adapterFile, "utf8");
    const imports = importsOf(source);
    const forbiddenImports = new Set([
      "node:child_process",
      "child_process",
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:dgram",
    ]);

    expect(imports.filter((specifier) => forbiddenImports.has(specifier))).toEqual([]);
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW");
    expect(source).not.toMatch(
      /\b(?:writeFile|appendFile|truncate|unlink|rename|rm|mkdir|readdir|opendir|spawn|exec|execFile|fork)\s*\(/,
    );
    expect(source).not.toMatch(
      /\bprocess\.env\b|google_token|google_client_secret|Credentials|googleapis|Submission History|Paper Tracker/,
    );
  });

  it("confines local Bank Journal observation to the fixed sanitized snapshot", async () => {
    const adapterFile = resolve(
      sourceRoot,
      "adapters/bank-journal-quality-snapshot/local-bank-journal-quality-snapshot-adapter.ts",
    );
    const source = await readFile(adapterFile, "utf8");
    const imports = importsOf(source);
    const forbiddenImports = new Set([
      "node:child_process", "child_process", "node:http", "http", "node:https", "https", "node:net", "net",
    ]);
    expect(imports.filter((specifier) => forbiddenImports.has(specifier))).toEqual([]);
    expect(source).toContain("constants.O_RDONLY | constants.O_NOFOLLOW");
    expect(source).not.toMatch(
      /\b(?:writeFile|appendFile|truncate|unlink|rename|rm|mkdir|readdir|opendir|spawn|exec|execFile|fork)\s*\(/,
    );
    expect(source).not.toMatch(
      /\bprocess\.env\b|google_token|google_client_secret|Credentials|googleapis|Journal Database|Journal Experience Library|Submission History|Paper Tracker/,
    );
  });

  it("mints approved descriptors only in adapter definitions or the fixed production composition root", async () => {
    const allowedMintingSites = new Set([
      "src/adapters/hermes-version-metadata/local-hermes-version-metadata-adapter.ts",
      "src/adapters/hermes-gateway-local/local-gateway-observation-adapter.ts",
      "src/adapters/hermes-scheduler-local/local-scheduler-observation-adapter.ts",
      "src/adapters/accounting-v2-snapshot/local-accounting-v2-snapshot-adapter.ts",
      "src/adapters/submission-tracker-snapshot/local-submission-tracker-snapshot-adapter.ts",
      "src/adapters/bank-journal-quality-snapshot/local-bank-journal-quality-snapshot-adapter.ts",
      "src/infrastructure/observations/production-local-observations.ts",
    ]);
    const violations: string[] = [];
    for (const file of await sourceFiles(sourceRoot)) {
      const relativeFile = relative(projectRoot, file);
      if (allowedMintingSites.has(relativeFile)) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("fromApprovedServerConfiguration(")) {
        violations.push(relativeFile);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps local version metadata internals out of HTTP and frontend modules", async () => {
    const violations: string[] = [];
    for (const root of ["http", "web"]) {
      for (const file of await sourceFiles(resolve(sourceRoot, root))) {
        const imports = importsOf(await readFile(file, "utf8"));
        if (imports.some((specifier) => specifier.includes("hermes-version-metadata"))) {
          violations.push(relative(projectRoot, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("confines raw runner output to the internal parser boundary", async () => {
    const files = (await sourceFiles(sourceRoot)).sort();
    const violations: string[] = [];
    const rawAllowed = new Set([
      "src/adapters/hermes-cli/runner/bounded-process-executor.ts",
      "src/adapters/hermes-cli/parsers/parser-registry.ts",
    ]);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relativeFile = relative(projectRoot, file);
      if (/\brawStdout\b|\brawStderr\b/.test(source) && !rawAllowed.has(relativeFile)) {
        violations.push(`${relativeFile} -> raw output field`);
      }
      if (
        relativeFile.startsWith("src/http/") &&
        /BoundedProcessResult|SuccessfulProcessResult|FailedProcessResult/.test(source)
      ) {
        violations.push(`${relativeFile} -> runner result in HTTP/API boundary`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps parsers pure and unable to invoke runners, filesystems, or databases", async () => {
    const files = (await sourceFiles(resolve(sourceRoot, "adapters/hermes-cli/parsers"))).sort();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      const relativeFile = relative(projectRoot, file);
      for (const specifier of imports) {
        if (
          isNodeFs(specifier) ||
          specifier === "node:child_process" ||
          /(?:sqlite|better-sqlite|database)/i.test(specifier)
        ) {
          violations.push(`${relativeFile} -> ${specifier}`);
        }
      }
      if (/\bexecuteBoundedProcess\b|\bcreateSafeHermesRunner\b|\bspawn\s*\(/.test(source)) {
        violations.push(`${relativeFile} -> process invocation`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the dedicated profile parser pure and its normalized projection minimal", async () => {
    const parserFile = resolve(
      sourceRoot,
      "adapters/hermes-cli/parsers/profile-list-parser.ts",
    );
    const parserSource = await readFile(parserFile, "utf8");
    const parserImports = importsOf(parserSource);
    expect(
      parserImports.filter(
        (specifier) =>
          isNodeFs(specifier) ||
          specifier === "node:child_process" ||
          specifier.includes("/runner/") ||
          specifier.includes("safe-hermes-runner"),
      ),
    ).toEqual([]);
    expect(parserSource).not.toMatch(
      /(?:^|[^.A-Za-z0-9_$])(?:spawn|exec|execFile|fork)\s*\(/,
    );

    const contractsSource = await readFile(
      resolve(sourceRoot, "adapters/hermes-cli/parsers/contracts.ts"),
      "utf8",
    );
    const profileSummary =
      /export interface ProfileSummary \{([\s\S]*?)\n\}/.exec(contractsSource)?.[1] ?? "";
    expect(profileSummary).toContain("readonly name: string;");
    expect(profileSummary).toContain("readonly current: boolean;");
    expect(profileSummary).not.toMatch(
      /\b(?:model|gateway|alias|distribution|rawStdout|rawStderr)\b/i,
    );
  });

  it("limits validated-board provenance minting to the Kanban parser", async () => {
    const files = (await sourceFiles(sourceRoot)).sort();
    const allowed = new Set([
      "src/adapters/hermes-cli/runner/verified-board-slug.ts",
      "src/adapters/hermes-cli/parsers/kanban-parsers.ts",
    ]);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relativeFile = relative(projectRoot, file);
      if (source.includes("validatedKanbanBoardsResultFromParser") && !allowed.has(relativeFile)) {
        violations.push(relativeFile);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps observation composition free of CLI, process, network, and filesystem capabilities", async () => {
    const observationRoot = resolve(sourceRoot, "application/observations");
    const violations: string[] = [];
    for (const file of await sourceFiles(observationRoot)) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      const relativeFile = relative(projectRoot, file);
      if (
        imports.some((specifier) =>
          specifier === "node:child_process" ||
          specifier === "node:http" ||
          specifier === "node:https" ||
          specifier === "node:net" ||
          isNodeFs(specifier) ||
          specifier.includes("hermes-cli/runner") ||
          specifier.includes("hermes-cli/parsers")
        ) ||
        /\bprocess\.env\b|\.listen\s*\(|(?:^|[^.A-Za-z0-9_$])(?:spawn|exec|execFile|fork)\s*\(|hermes\s+profile\s+list/.test(source)
      ) {
        violations.push(relativeFile);
      }
    }
    expect(violations).toEqual([]);
  });

  it("confines the one approved listener to the fixed loopback Mission Control bootstrap", async () => {
    const files = (await sourceFiles(sourceRoot)).sort();
    const approvedListener = "src/bootstrap/mission-control.ts";
    const listenerModules: string[] = [];
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importsOf(source);
      const relativeFile = relative(projectRoot, file);
      if (/\.listen\s*\(/.test(source)) {
        listenerModules.push(relativeFile);
        if (relativeFile !== approvedListener) violations.push(relativeFile);
      }
      if (imports.some((specifier) => ["node:http", "node:https", "node:net"].includes(specifier))) {
        violations.push(`${relativeFile} -> direct network primitive`);
      }
    }
    expect(listenerModules).toEqual([approvedListener]);
    expect(violations).toEqual([]);

    const bootstrap = await readFile(resolve(projectRoot, approvedListener), "utf8");
    expect(bootstrap).toContain('const APP_HOST = "127.0.0.1"');
    expect(bootstrap).toContain("const APP_PORT = serverConfig.port");
    expect(bootstrap).toContain("listen({ host: APP_HOST, port: APP_PORT })");
    expect(bootstrap).not.toMatch(/0\.0\.0\.0|\[::\]/);
  });

  it("confines any global environment access to the runtime-config boundary", async () => {
    const files = (await sourceFiles(sourceRoot)).sort();
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relativeFile = relative(projectRoot, file);
      if (/\bprocess\.env\b/.test(source) && relativeFile !== "src/infrastructure/runtime-config.ts") {
        violations.push(relativeFile);
      }
    }
    expect(violations).toEqual([]);
  });
});
