import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scanRoots = ["src", "tests", "tools", "docs", "schemas", "fixtures"];
const rootFiles = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "ACKNOWLEDGEMENTS.md",
  "THIRD_PARTY_NOTICES.md",
  ".env.example",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "tsconfig.server.json",
  "tsconfig.web.json",
  "tsconfig.tests.json",
  "vite.config.ts",
  "vitest.config.ts",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx"]);
const violations = [];
let checkedFiles = 0;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const files = rootFiles.map((file) => resolve(projectRoot, file));
for (const directory of scanRoots) {
  files.push(...(await collectFiles(resolve(projectRoot, directory))));
}

for (const file of [...new Set(files)].sort()) {
  const relativePath = relative(projectRoot, file);
  const content = await readFile(file, "utf8");
  checkedFiles += 1;

  if (content.includes("\r")) {
    violations.push(`${relativePath}: contains CRLF or bare carriage return`);
  }
  if (content.length > 0 && !content.endsWith("\n")) {
    violations.push(`${relativePath}: missing final newline`);
  }

  for (const [index, line] of content.split("\n").entries()) {
    if (/\s+$/.test(line)) {
      violations.push(`${relativePath}:${index + 1}: trailing whitespace`);
    }
    if (line.includes("\t")) {
      violations.push(`${relativePath}:${index + 1}: tab character`);
    }
  }

  if (extname(file) === ".json") {
    try {
      JSON.parse(content);
    } catch (error) {
      violations.push(`${relativePath}: invalid JSON (${String(error)})`);
    }
  }

  if (relativePath.startsWith("src/") && /\bconsole\.(?:debug|info|log|warn|error)\s*\(/.test(content)) {
    violations.push(`${relativePath}: direct console usage is not allowed in source modules`);
  }
}

const rootEntries = await readdir(projectRoot);
for (const name of rootEntries) {
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
    violations.push(`${name}: runtime environment file is forbidden`);
  }
}

if (violations.length > 0) {
  console.error("Repository lint failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Repository lint passed (${checkedFiles} text files checked).`);
}
