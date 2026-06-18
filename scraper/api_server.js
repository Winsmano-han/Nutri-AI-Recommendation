#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { ingestReport } from "./report_ingestion.js";
import { contractStoreInfo } from "./contract_store.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dns.setDefaultResultOrder("ipv4first");

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
const CACHE_TTL_MS = parseInt(process.env.RECOMMENDATION_CACHE_TTL_MS || "3600000", 10);
const MAX_PIPELINE_QUEUE = parseInt(process.env.MAX_PIPELINE_QUEUE || "20", 10);
const DEFAULT_MAX_RESTAURANTS = parseInt(process.env.DEFAULT_MAX_RESTAURANTS || "3", 10);
const HARD_MAX_RESTAURANTS = parseInt(process.env.HARD_MAX_RESTAURANTS || "60", 10);
const GEO_CACHE_DECIMALS = parseInt(process.env.GEO_CACHE_DECIMALS || "2", 10);
const PIPELINE_TIMEOUT_MS = parseInt(process.env.PIPELINE_TIMEOUT_MS || "170000", 10);

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

const responseCache = new Map();
const pipelineQueue = [];
let pipelineActive = false;

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeList(item))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGender(value) {
  const gender = String(value || "").trim().toLowerCase();
  if (["male", "m"].includes(gender)) return "male";
  if (["female", "f"].includes(gender)) return "female";
  return null;
}

function normalizeAge(value) {
  const age = parseInt(value, 10);
  return Number.isFinite(age) && age > 0 ? age : null;
}

function normalizeUserProfile(profile = {}) {
  const normalized = {
    ...profile,
    conditions: normalizeList(profile.conditions),
    restrictions: normalizeList(profile.restrictions),
    allergies: normalizeList(profile.allergies ?? profile.allergens ?? profile.allergensAvoid),
    age: normalizeAge(profile.age),
    activityLevel: profile.activityLevel || null,
    gender: normalizeGender(profile.gender),
  };

  return normalized;
}

function recommendationCacheKey(payload) {
  const stable = {
    country: payload.country || "auto",
    lat: Number(payload.lat).toFixed(GEO_CACHE_DECIMALS),
    lng: Number(payload.lng).toFixed(GEO_CACHE_DECIMALS),
    radius: Number(payload.radius ?? process.env.SEARCH_RADIUS ?? "2000"),
    maxRestaurants: normaliseMaxRestaurants(payload.maxRestaurants),
    enableGeminiSearch: Boolean(payload.enableGeminiSearch),
    skipLlmClassify: payload.skipLlmClassify !== false,
    userId: payload.userId || null,
    userProfile: normalizeUserProfile(payload.userProfile || { conditions: [], restrictions: [] }),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function boolEnv(value, fallback = "0") {
  if (value === true || value === "true" || value === "1" || value === 1) return "1";
  if (value === false || value === "false" || value === "0" || value === 0) return "0";
  return fallback;
}

function normaliseMaxRestaurants(value) {
  const requested = parseInt(value ?? process.env.MAX_RESTAURANTS ?? DEFAULT_MAX_RESTAURANTS, 10);
  const safe = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MAX_RESTAURANTS;
  return Math.min(safe, HARD_MAX_RESTAURANTS);
}

function getCachedRecommendation(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return {
    ...hit.value,
    _meta: {
      ...(hit.value._meta || {}),
      cache: { hit: true, key, ttlMs: CACHE_TTL_MS },
    },
  };
}

function setCachedRecommendation(key, value) {
  responseCache.set(key, { createdAt: Date.now(), value });
}

function pipelineError(err) {
  const stderr = String(err.stderr || "").trim();
  const stdout = String(err.stdout || "").trim();
  const combined = [stderr, stdout, err.message].filter(Boolean).join("\n");
  const tail = combined.slice(-3000);

  if (err.killed || err.signal === "SIGTERM" || /timed out/i.test(err.message || "")) {
    const timeoutErr = new Error(`Recommendation pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms. Last output:\n${tail}`);
    timeoutErr.statusCode = 504;
    return timeoutErr;
  }

  if (/Groq request timed out|Groq explain error|Groq fetch failed|Groq rate limit 429/i.test(combined)) {
    const groqErr = new Error(`Groq recommendation explanation failed. Details:\n${tail}`);
    groqErr.statusCode = /timed out|rate limit 429/i.test(combined) ? 504 : 502;
    return groqErr;
  }

  const genericErr = new Error(`Recommendation pipeline failed. Details:\n${tail}`);
  genericErr.statusCode = 500;
  return genericErr;
}

async function runPipeline(payload) {
  const before = listRecommendationOutputs()[0]?.name;
  const env = {
    ...process.env,
    USER_LAT: String(payload.lat),
    USER_LNG: String(payload.lng),
    SEARCH_RADIUS: String(payload.radius ?? process.env.SEARCH_RADIUS ?? "2000"),
    MODEL_API_URL,
    USER_PROFILE: JSON.stringify(normalizeUserProfile(payload.userProfile || { conditions: [], restrictions: [] })),
  };
  if (payload.country != null) env.USER_COUNTRY = String(payload.country);
  if (payload.userId != null) env.USER_ID = String(payload.userId);
  env.MAX_RESTAURANTS = String(normaliseMaxRestaurants(payload.maxRestaurants));
  env.SKIP_GROQ_CLASSIFY = String(payload.skipGroqClassify ?? process.env.SKIP_GROQ_CLASSIFY ?? "1");
  env.SKIP_LLM_CLASSIFY = boolEnv(payload.skipLlmClassify, process.env.SKIP_LLM_CLASSIFY ?? "1");
  env.ENABLE_GEMINI_SEARCH = boolEnv(payload.enableGeminiSearch, process.env.ENABLE_GEMINI_SEARCH ?? "0");
  env.GROQ_TIMEOUT_MS = String(process.env.GROQ_TIMEOUT_MS || "15000");
  env.GROQ_MAX_RETRIES = String(process.env.GROQ_MAX_RETRIES || "1");
  env.GROQ_MAX_RETRY_WAIT_MS = String(process.env.GROQ_MAX_RETRY_WAIT_MS || "15000");

  try {
    await execFileAsync(process.execPath, ["nutrifence_pipeline.js"], {
      cwd: __dirname,
      env,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: PIPELINE_TIMEOUT_MS,
    });
  } catch (err) {
    throw pipelineError(err);
  }

  const outputs = listRecommendationOutputs();
  const latest = outputs[0];
  if (!latest || latest.name === before) {
    throw new Error("Pipeline ran but no new recommendations file was detected");
  }
  return JSON.parse(fs.readFileSync(latest.full, "utf8"));
}

function pipelineQueueStatus() {
  return {
    active: pipelineActive,
    waiting: pipelineQueue.length,
    maxWaiting: MAX_PIPELINE_QUEUE,
  };
}

function enqueuePipeline(payload) {
  if (pipelineQueue.length >= MAX_PIPELINE_QUEUE) {
    const err = new Error("Pipeline queue is full. Retry shortly.");
    err.statusCode = 503;
    throw err;
  }

  return new Promise((resolve, reject) => {
    pipelineQueue.push({
      payload,
      enqueuedAt: Date.now(),
      resolve,
      reject,
    });
    processPipelineQueue();
  });
}

async function processPipelineQueue() {
  if (pipelineActive) return;
  const job = pipelineQueue.shift();
  if (!job) return;

  pipelineActive = true;
  try {
    const result = await runPipeline(job.payload);
    result._meta = {
      ...(result._meta || {}),
      queue: {
        waitedMs: Date.now() - job.enqueuedAt,
        remaining: pipelineQueue.length,
      },
    };
    job.resolve(result);
  } catch (err) {
    job.reject(err);
  } finally {
    pipelineActive = false;
    setImmediate(processPipelineQueue);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return options(res);
    }

    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        status: "ok",
        service: "nutrifence-api",
        port: PORT,
        runtime: { node: process.version },
        externalConfig: {
          googleMapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          modelApiUrl: MODEL_API_URL,
          supabaseConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)),
        },
        contractStore: contractStoreInfo(),
        pipelineQueue: pipelineQueueStatus(),
        performance: {
          defaultMaxRestaurants: DEFAULT_MAX_RESTAURANTS,
          hardMaxRestaurants: HARD_MAX_RESTAURANTS,
          geoCacheDecimals: GEO_CACHE_DECIMALS,
          cacheTtlMs: CACHE_TTL_MS,
          skipGroqClassifyDefault: process.env.SKIP_GROQ_CLASSIFY ?? "1",
          skipLlmClassifyDefault: process.env.SKIP_LLM_CLASSIFY ?? "1",
          geminiSearchDefault: process.env.ENABLE_GEMINI_SEARCH ?? "0",
          pipelineTimeoutMs: PIPELINE_TIMEOUT_MS,
          groqTimeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS || "15000", 10),
          groqMaxRetries: parseInt(process.env.GROQ_MAX_RETRIES || "1", 10),
          groqMaxRetryWaitMs: parseInt(process.env.GROQ_MAX_RETRY_WAIT_MS || "15000", 10),
        },
      });
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
      const payload = {
        lat,
        lng,
        radius: body.radius,
        country: body.country,
        userId: body.userId,
        userProfile: normalizeUserProfile(body.userProfile || { conditions: [], restrictions: [] }),
        maxRestaurants: normaliseMaxRestaurants(body.maxRestaurants),
        skipGroqClassify: body.skipGroqClassify,
        skipLlmClassify: body.skipLlmClassify,
        enableGeminiSearch: body.enableGeminiSearch,
      };
      const cacheKey = recommendationCacheKey(payload);
      const cached = getCachedRecommendation(cacheKey);
      if (cached) return json(res, 200, cached);

      const result = await enqueuePipeline(payload);
      result._meta = {
        ...(result._meta || {}),
        cache: { hit: false, key: cacheKey, ttlMs: CACHE_TTL_MS },
      };
      setCachedRecommendation(cacheKey, result);
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
        const contract = await ingestReport(filePath, userId, { country: body.country });
        responseCache.clear();
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
    return json(res, err.statusCode || 500, { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Nutrifence API server running at http://${HOST}:${PORT}`);
});
