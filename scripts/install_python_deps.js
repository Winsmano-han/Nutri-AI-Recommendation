#!/usr/bin/env node

import { spawnSync } from "child_process";

const candidates = process.env.PYTHON_BIN
  ? [process.env.PYTHON_BIN]
  : (process.platform === "win32" ? ["python", "py"] : ["python3", "python"]);

let lastError = null;

for (const pythonBin of candidates) {
  const version = spawnSync(pythonBin, ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    lastError = version.error || new Error(`${pythonBin} --version exited ${version.status}`);
    continue;
  }

  console.log(`Installing Python dependencies with ${pythonBin}`);
  const install = spawnSync(pythonBin, ["-m", "pip", "install", "-r", "requirements.txt"], {
    stdio: "inherit",
  });

  if (install.status === 0) process.exit(0);
  process.exit(install.status || 1);
}

console.warn(`Python not found; skipping Python dependency install. Last error: ${lastError?.message || "none"}`);
console.warn("Install requirements.txt manually before running model_server.py.");
