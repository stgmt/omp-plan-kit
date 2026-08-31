import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const profilesDir = path.join(os.homedir(), ".omp", "profiles");

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

function prefix(profile) {
  return profile === "default" ? [] : ["--profile", profile];
}

function runOmp(profile, action) {
  return spawnSync("omp", [...prefix(profile), "plugin", ...action, "--json"], { encoding: "utf8", windowsHide: true });
}

function hasPlugin(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed.npm) && parsed.npm.some((plugin) => plugin?.name === "omp-plan-kit");
  } catch {
    return false;
  }
}

const results = [];
for (const profile of await profileNames()) {
  const listed = runOmp(profile, ["list"]);
  if (listed.status !== 0) throw new Error(`OMP plugin list failed for ${profile}: ${(listed.stderr || listed.stdout || "unknown error").trim()}`);
  if (!hasPlugin(listed.stdout)) {
    results.push({ profile, status: "absent" });
    continue;
  }
  const removed = runOmp(profile, ["uninstall", "omp-plan-kit", "--scope", "user"]);
  if (removed.status !== 0) throw new Error(`OMP plugin uninstall failed for ${profile}: ${(removed.stderr || removed.stdout || "unknown error").trim()}`);
  results.push({ profile, status: "uninstalled", output: removed.stdout.trim() });
}

process.stdout.write(`${JSON.stringify({ schema: "omp-plan-kit-cli-uninstall@2", decision: "pass", results }, null, 2)}\n`);
