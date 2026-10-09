import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [mode, ...args] = process.argv.slice(2);

function stayAlive() {
  setInterval(() => undefined, 1_000);
}

switch (mode) {
  case "success":
    process.stdout.write(args[0] ?? "synthetic-success");
    break;
  case "stderr-success":
    process.stdout.write("synthetic-success");
    process.stderr.write("synthetic-warning");
    break;
  case "nonzero":
    process.stdout.write("partial-stdout-must-not-be-valid");
    process.stderr.write("synthetic-failure-detail");
    process.exitCode = Number(args[0] ?? "7");
    break;
  case "timeout":
    stayAlive();
    break;
  case "ignore-term":
    process.on("SIGTERM", () => undefined);
    stayAlive();
    break;
  case "oversized-stdout":
    process.stdout.write("x".repeat(Number(args[0] ?? "2048")));
    stayAlive();
    break;
  case "oversized-stderr":
    process.stderr.write("e".repeat(Number(args[0] ?? "2048")));
    stayAlive();
    break;
  case "environment":
    process.stdout.write(JSON.stringify(process.env));
    break;
  case "cwd":
    process.stdout.write(process.cwd());
    break;
  case "stdin-closed": {
    let received = false;
    process.stdin.on("data", () => {
      received = true;
    });
    process.stdin.on("end", () => {
      process.stdout.write(received ? "stdin-data" : "stdin-closed");
    });
    process.stdin.resume();
    break;
  }
  case "delayed-success":
    setTimeout(() => {
      process.stdout.write(args[1] ?? "done");
    }, Number(args[0] ?? "100"));
    break;
  case "tree":
  case "tree-parent-exits": {
    const pidFile = args[0];
    if (!pidFile) throw new Error("tree mode requires pid file");
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "ignore-term"], {
      detached: false,
      stdio: "ignore",
    });
    if (child.pid === undefined) throw new Error("child pid unavailable");
    writeFileSync(pidFile, String(child.pid), "utf8");
    if (mode === "tree") process.on("SIGTERM", () => undefined);
    stayAlive();
    break;
  }
  default:
    process.stderr.write("unknown synthetic fixture mode");
    process.exitCode = 64;
}
