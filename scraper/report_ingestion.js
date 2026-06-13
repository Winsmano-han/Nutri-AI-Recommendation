#!/usr/bin/env node

import fs from "fs";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";
import { saveUserContract, contractStoreInfo } from "./contract_store.js";
import { LLMProviderManager } from "./llm_provider_manager.js";

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MODEL_API_URL = (process.env.MODEL_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const CONTRACT_PATH = path.join(__dirname, "nutrition_contract.json");
const CANADA_CONTRACT_PATH = path.join(__dirname, "nutrition_contract_canada.json");

async function extractTextFromReport(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf8");
  }

  if (ext === ".pdf") {
    const buf = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(filePath));

    let res;
    try {
      res = await fetch(`${MODEL_API_URL}/extract-pdf`, {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      throw new Error(`PDF extraction fetch failed for ${MODEL_API_URL}/extract-pdf: ${err.message}`);
    }
    if (!res.ok) {
      throw new Error(`PDF extraction endpoint failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.text || "";
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

function normalizeCountry(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["ca", "can", "canada"].includes(raw)) return "CA";
  if (["ng", "nga", "nigeria"].includes(raw)) return "NG";
  return "NG";
}

function loadContractForCountry(country) {
  const pathForCountry = country === "CA" ? CANADA_CONTRACT_PATH : CONTRACT_PATH;
  return JSON.parse(fs.readFileSync(pathForCountry, "utf8"));
}

async function parseReportToContract(reportText, userId, country = "NG") {
  const parserContract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const countryContract = loadContractForCountry(country);
  const parsingConfig = parserContract.userReportParsingPrompt;
  const timestamp = new Date().toISOString();

  const userPrompt = parsingConfig.userPrompt
    .replace("{{REPORT_TEXT}}", reportText.slice(0, 6000))
    .replace("{{timestamp}}", timestamp.replace(/[:.]/g, "-"))
    .replace("{{current ISO timestamp}}", timestamp);

  let content;
  try {
    const llm = new LLMProviderManager({
      geminiKey: GEMINI_API_KEY,
      geminiModel: GEMINI_MODEL,
      timeout: parseInt(process.env.LLM_TIMEOUT_MS || "45000", 10),
    });
    const response = await llm.chat([
      { role: "system", content: parsingConfig.systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0, maxTokens: 2500 });
    content = response.content;
  } catch (err) {
    throw new Error(`Gemini report parsing failed: ${err.message || err}`);
  }

  const rawText = content || "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    const normMap = countryContract.backendNormalization?.conditionAliases || {};
    parsed.constraints = parsed.constraints || {};
    parsed.constraints.conditions = (parsed.constraints.conditions || []).map((c) => {
      const key = String(c || "").toLowerCase().trim();
      return normMap[key] || key;
    });

    parsed.reportId = `user_report_${userId}_${Date.now()}`;
    parsed.createdAt = timestamp;
    parsed.userId = userId;
    parsed.country = country;
    return parsed;
  } catch (e) {
    throw new Error(`Contract parsing failed: ${e.message}\nRaw: ${rawText.slice(0, 200)}`);
  }
}

async function ingestReport(filePath, userId, options = {}) {
  const country = normalizeCountry(options.country || process.env.USER_COUNTRY || process.env.COUNTRY);
  console.log(`📄 Ingesting report: ${filePath}`);
  const text = await extractTextFromReport(filePath);
  console.log(`  Extracted ${text.length} chars`);

  const contract = await parseReportToContract(text, userId, country);
  console.log(`  Conditions: ${(contract.constraints?.conditions || []).join(", ") || "none"}`);
  console.log(`  LLM instructions: ${(contract.llmInstructions || []).length}`);
  const saved = await saveUserContract(userId, contract);
  console.log(`✅ Contract saved for user ${userId} via ${saved.backend}`);
  return contract;
}

const [, , filePath, userId, countryArg] = process.argv;
if (filePath && userId) {
  console.log(`Contract store: ${JSON.stringify(contractStoreInfo())}`);
  ingestReport(filePath, userId, { country: countryArg }).catch((err) => {
    console.error(`❌ Ingestion failed: ${err.message}`);
    process.exit(1);
  });
}

export { ingestReport };
