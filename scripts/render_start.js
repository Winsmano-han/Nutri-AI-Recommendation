#!/usr/bin/env node

import { spawn } from "child_process";

const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const modelHost = process.env.MODEL_HOST || "127.0.0.1";
const modelPort = process.env.MODEL_PORT || "8011";
const publicPort = process.env.PORT || process.env.API_PORT || "8090";

process.env.MODEL_API_URL = process.env.MODEL_API_URL || `http://${modelHost}:${modelPort}`;
process.env.API_HOST = process.env.API_HOST || "0.0.0.0";
process.env.API_PORT = publicPort;

const children = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
    ...options,
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} exited with code=${code} signal=${signal}`);
    shutdown(code || 1);
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`Starting model server on http://${modelHost}:${modelPort}`);
start("model_server", pythonBin, [
  "-m",
  "uvicorn",
  "model_server:app",
  "--host",
  modelHost,
  "--port",
  modelPort,
], { cwd: "scraper" });

async function waitForModelServer() {
  const healthUrl = `http://${modelHost}:${modelPort}/health`;
  const startedAt = Date.now();
  const timeoutMs = parseInt(process.env.MODEL_START_TIMEOUT_MS || "90000", 10);

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        const data = await res.json();
        console.log(`Model server healthy: models_loaded=${JSON.stringify(data.models_loaded || [])}`);
        return;
      }
    } catch {
      // Keep waiting while uvicorn imports the app and loads joblib artifacts.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Model server did not become healthy within ${timeoutMs}ms`);
}

await waitForModelServer().catch((err) => {
  console.error(err.message);
  shutdown(1);
});

console.log(`Starting API server on 0.0.0.0:${publicPort}`);
start("api_server", process.execPath, ["scraper/api_server.js"]);
