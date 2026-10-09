import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skippedDirectories = new Set([".git", "dist", "node_modules"]);
const forbiddenExtensions = new Set([
  ".bak", ".backup", ".db", ".dump", ".key", ".log", ".p12", ".pem", ".pfx", ".sqlite", ".sqlite3",
]);
const forbiddenNames = new Set([".env", "id_rsa", "id_ed25519", "credentials.json"]);
const knownPrivateMarkers = [
  "/home/hermes",
  "1177486604",
  "1SlaXV9kOoZfAvDpmMcnK8NgkYg93Dn83-zHs94e5SVg",
  "127.0.0.1:8320",
  "google_client_secret.json",
  "google_token.json",
];
const secretPatterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{32,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\b[0-9]{8,10}:AA[0-9A-Za-z_-]{30,}\b/,
  /(?:https?|ssh):\/\/[^\s/:]+:[^\s/@]+@/,
];
const findings = [];
let checked = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    const rel = relative(root, path);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      findings.push(`${rel}: symlink is not allowed`);
      continue;
    }
    if (stat.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!stat.isFile()) continue;
    checked += 1;
    if (forbiddenNames.has(entry.name) || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) {
      findings.push(`${rel}: forbidden runtime/credential filename`);
    }
    if (forbiddenExtensions.has(extname(entry.name).toLowerCase())) {
      findings.push(`${rel}: forbidden sensitive extension`);
    }
    if (stat.size > 1_048_576) findings.push(`${rel}: file exceeds 1 MiB review limit`);
    const data = await readFile(path);
    if (data.includes(0)) {
      findings.push(`${rel}: binary file is not allowlisted`);
      continue;
    }
    const text = data.toString("utf8");
    if (rel !== "tools/audit-publication.mjs") {
      for (const marker of knownPrivateMarkers) {
        if (text.includes(marker)) findings.push(`${rel}: contains blocked private deployment marker`);
      }
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) findings.push(`${rel}: matches credential/private-key signature`);
    }
  }
}

await walk(root);
if (findings.length > 0) {
  console.error("Publication audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Publication audit passed (${checked} candidate files; dependencies/build/Git metadata excluded).`);
}
