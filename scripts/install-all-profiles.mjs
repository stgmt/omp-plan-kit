import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilesDir = path.join(os.homedir(), ".omp", "profiles");
const packageManifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const expectedName = packageManifest.name;
const expectedVersion = packageManifest.version;

async function profileNames() {
  const names = ["default"];
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    names.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    // The default profile is sufficient when named profiles do not exist.
  }
  return [...new Set(names)];
}

function linkArgs(profile) {
  const prefix = profile === "default" ? [] : ["--profile", profile];
  return [...prefix, "plugin", "link", repoRoot, "--scope", "user", "--json"];
}

const results = [];
for (const profile of await profileNames()) {
  const result = spawnSync("omp", linkArgs(profile), { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`OMP plugin link failed for ${profile}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`OMP plugin link returned non-JSON output for ${profile}`);
  }
  if (parsed.name !== expectedName || parsed.version !== expectedVersion || parsed.enabled !== true) {
    throw new Error(`OMP plugin link returned an unexpected result for ${profile}`);
  }
  results.push({ profile, name: parsed.name, version: parsed.version, enabled: parsed.enabled, path: parsed.path });
}

process.stdout.write(`${JSON.stringify({ schema: "omp-plan-kit-cli-install@1", decision: "pass", repoRoot, results }, null, 2)}\n`);
