#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import { ingestReport } from "./report_ingestion.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || rest.length === 0) continue;
    if (!(key.trim() in process.env)) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  }
}

loadDotEnv();

const HOST = process.env.API_HOST || "127.0.0.1";
const PORT = parseInt(process.env.API_PORT || "8090", 10);
const MODEL_API_URL = (process.env.MODEL_API_URL || "http://127.0.0.1:8011").replace(/\/$/, "");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function options(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function proxyToModelServer(req, res, targetPath) {
  const target = new URL(`${MODEL_API_URL}${targetPath}`);
  const client = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: target.host };

  const proxyReq = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, {
        ...proxyRes.headers,
        ...CORS_HEADERS,
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    json(res, 502, {
      error: "Model server proxy failed",
      detail: err.message,
      modelApiUrl: MODEL_API_URL,
    });
  });

  req.pipe(proxyReq);
}

function listRecommendationOutputs() {
  return fs.readdirSync(__dirname)
    .filter((f) => /^recommendations_.*\.json$/.test(f))
    .map((f) => ({ name: f, full: path.join(__dirname, f), mtime: fs.statSync(path.join(__dirname, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

let pipelineBusy = false;

async function runPipeline(payload) {
  if (pipelineBusy) throw new Error("Pipeline is busy. Retry shortly.");
  pipelineBusy = true;
  try {
    const before = listRecommendationOutputs()[0]?.name;
    const env = {
      ...process.env,
      USER_LAT: String(payload.lat),
      USER_LNG: String(payload.lng),
      SEARCH_RADIUS: String(payload.radius ?? process.env.SEARCH_RADIUS ?? "2000"),
      USER_PROFILE: JSON.stringify(payload.userProfile || { conditions: [], restrictions: [] }),
    };
    if (payload.country != null) env.USER_COUNTRY = String(payload.country);
    if (payload.maxRestaurants != null) env.MAX_RESTAURANTS = String(payload.maxRestaurants);

    await execFileAsync(process.execPath, ["nutrifence_pipeline.js"], {
      cwd: __dirname,
      env,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const outputs = listRecommendationOutputs();
    const latest = outputs[0];
    if (!latest || latest.name === before) {
      throw new Error("Pipeline ran but no new recommendations file was detected");
    }
    return JSON.parse(fs.readFileSync(latest.full, "utf8"));
  } finally {
    pipelineBusy = false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return options(res);
    }

    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { status: "ok", service: "nutrifence-api", port: PORT });
    }

    if (req.method === "GET" && req.url === "/model/health") {
      return proxyToModelServer(req, res, "/health");
    }

    if (
      req.url === "/recommend" ||
      req.url === "/recommend/batch" ||
      req.url === "/recommend/food" ||
      req.url === "/extract-pdf"
    ) {
      return proxyToModelServer(req, res, req.url);
    }

    if (req.method === "POST" && req.url === "/api/recommendations") {
      const body = await readJsonBody(req);
      const { lat, lng } = body;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return json(res, 422, { error: "lat and lng are required numbers" });
      }

      const result = await runPipeline({
        lat,
        lng,
        radius: body.radius,
        country: body.country,
        userProfile: body.userProfile || { conditions: [], restrictions: [] },
        maxRestaurants: body.maxRestaurants,
      });
      return json(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/api/ingest-report") {
      const body = await readJsonBody(req);
      const userId = String(body.userId || "").trim();
      if (!userId) return json(res, 422, { error: "userId is required" });

      let filePath = null;
      let tempPath = null;

      if (typeof body.reportText === "string" && body.reportText.trim()) {
        tempPath = path.join(os.tmpdir(), `nutrifence_report_${userId}_${Date.now()}.txt`);
        fs.writeFileSync(tempPath, body.reportText, "utf8");
        filePath = tempPath;
      } else if (typeof body.reportPath === "string" && body.reportPath.trim()) {
        filePath = body.reportPath.trim();
      } else {
        return json(res, 422, { error: "Provide reportText or reportPath" });
      }

      try {
        const contract = await ingestReport(filePath, userId);
        return json(res, 200, {
          success: true,
          userId,
          conditions: contract?.constraints?.conditions || [],
          reportId: contract?.reportId || null,
        });
      } finally {
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    return json(res, 500, { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Nutrifence API server running at http://${HOST}:${PORT}`);
});
