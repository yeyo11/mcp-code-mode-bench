import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, found by walking up to this package's package.json (works from src and dist). */
function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "mcp-code-mode-bench") return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("mcp-code-mode-bench root not found");
    dir = parent;
  }
}

export const ROOT = findRoot();
export const FIXTURES_PATH = path.join(ROOT, "server", "fixtures", "drive.json");
export const EXPECTED_PATH = path.join(ROOT, "tasks", "expected.json");
export const RAW_DIR = path.join(ROOT, "results", "raw");
export const RESULTS_MD = path.join(ROOT, "results", "results.md");
/** The built server entry point that both harnesses spawn. */
export const SERVER_ENTRY = path.join(ROOT, "dist", "server", "src", "index.js");
