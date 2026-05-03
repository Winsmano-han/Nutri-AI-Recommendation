#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MODEL_API_URL = (process.env.MODEL_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const CONTRACT_PATH = path.join(__dirname, "nutrition_contract.json");

if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌ GROQ_API_KEY is not set.");
  process.exit(1);
}

async function extractTextFromReport(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf8");
  }

  if (ext === ".pdf") {
    const buf = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(filePath));

    const res = await fetch(`${MODEL_API_URL}/extract-pdf`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`PDF extraction endpoint failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.text || "";
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

async function parseReportToContract(reportText, userId) {
  const contractFile = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const parsingConfig = contractFile.userReportParsingPrompt;
  const timestamp = new Date().toISOString();

  const userPrompt = parsingConfig.userPrompt
    .replace("{{REPORT_TEXT}}", reportText.slice(0, 6000))
    .replace("{{timestamp}}", timestamp.replace(/[:.]/g, "-"))
    .replace("{{current ISO timestamp}}", timestamp);

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 2500,
      messages: [
        { role: "system", content: parsingConfig.systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq parsing failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    const normMap = contractFile.backendNormalization?.conditionAliases || {};
    parsed.constraints = parsed.constraints || {};
    parsed.constraints.conditions = (parsed.constraints.conditions || []).map((c) => {
      const key = String(c || "").toLowerCase().trim();
      return normMap[key] || key;
    });

    parsed.reportId = `user_report_${userId}_${Date.now()}`;
    parsed.createdAt = timestamp;
    parsed.userId = userId;
    return parsed;
  } catch (e) {
    throw new Error(`Contract parsing failed: ${e.message}\nRaw: ${rawText.slice(0, 200)}`);
  }
}

function saveActiveContract(contract, userId) {
  const outputPath = path.join(__dirname, "user_contract_active.json");
  fs.writeFileSync(outputPath, JSON.stringify(contract, null, 2), "utf8");
  console.log(`✅ Contract saved for user ${userId}: ${outputPath}`);
}

async function ingestReport(filePath, userId) {
  console.log(`📄 Ingesting report: ${filePath}`);
  const text = await extractTextFromReport(filePath);
  console.log(`  Extracted ${text.length} chars`);

  const contract = await parseReportToContract(text, userId);
  console.log(`  Conditions: ${(contract.constraints?.conditions || []).join(", ") || "none"}`);
  console.log(`  LLM instructions: ${(contract.llmInstructions || []).length}`);
  saveActiveContract(contract, userId);
  return contract;
}

const [, , filePath, userId] = process.argv;
if (filePath && userId) {
  ingestReport(filePath, userId).catch((err) => {
    console.error(`❌ Ingestion failed: ${err.message}`);
    process.exit(1);
  });
}

export { ingestReport };
