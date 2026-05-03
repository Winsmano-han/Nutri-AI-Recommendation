#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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

const WAIT_BETWEEN_RUNS_MS = 90_000;
const PROFILES = [
  { label: "baseline", profile: { conditions: [], restrictions: [] } },
  { label: "diabetes", profile: { conditions: ["diabetes"], restrictions: ["low sugar"] } },
  { label: "hypertension", profile: { conditions: ["hypertension"], restrictions: ["low sodium"] } },
  { label: "both", profile: { conditions: ["diabetes", "hypertension"], restrictions: ["low sodium", "low sugar"] } },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestRecommendationsFile() {
  const files = fs.readdirSync(__dirname)
    .filter((f) => /^recommendations_.*\.json$/.test(f))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(__dirname, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name || null;
}

function runPipeline(profile) {
  const env = {
    ...process.env,
    MODEL_API_URL: process.env.MODEL_API_URL || "http://127.0.0.1:8011",
    USER_LAT: process.env.USER_LAT || "7.3622",
    USER_LNG: process.env.USER_LNG || "3.8503",
    SEARCH_RADIUS: process.env.SEARCH_RADIUS || "1500",
    MAX_RESTAURANTS: process.env.MAX_RESTAURANTS || "3",
    USER_PROFILE: JSON.stringify(profile),
  };

  execSync("node nutrifence_pipeline.js", {
    cwd: __dirname,
    stdio: "inherit",
    env,
  });
}

function loadJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, fileName), "utf8"));
}

function compareRuns(filesByLabel) {
  const runs = Object.fromEntries(
    Object.entries(filesByLabel).map(([label, file]) => [label, loadJson(file)])
  );

  const labels = Object.keys(runs);
  const first = runs[labels[0]];
  const venueSets = labels.map((l) => new Set((runs[l].venues || []).map((v) => v.id)));
  const commonIds = [...venueSets[0]].filter((id) => venueSets.every((s) => s.has(id)));

  const out = [];
  out.push("Condition A/B Comparison");
  out.push("========================");
  out.push(`Shared venues across all runs: ${commonIds.length}`);
  out.push("");

  for (const venueId of commonIds) {
    const venueName = (first.venues || []).find((v) => v.id === venueId)?.name || venueId;
    out.push(`VENUE: ${venueName}`);
    for (const label of labels) {
      const rec = runs[label].recommendations?.[venueId] || {};
      const safe = (rec.safeOrders || []).map((x) => x.dish).join(" | ");
      const avoid = (rec.avoid || []).map((x) => x.item).join(" | ");
      out.push(`  [${label}] safe: ${safe || "-"}`);
      out.push(`  [${label}] avoid: ${avoid || "-"}`);
    }
    out.push("");
  }

  const comparisonPath = path.join(__dirname, "ab_comparison.txt");
  fs.writeFileSync(comparisonPath, out.join("\n"), "utf8");
  return comparisonPath;
}

async function main() {
  const outputs = {};

  for (let i = 0; i < PROFILES.length; i++) {
    const { label, profile } = PROFILES[i];
    console.log(`\n=== RUN ${i + 1}/${PROFILES.length}: ${label.toUpperCase()} ===`);
    console.log(`MODEL_API_URL=${process.env.MODEL_API_URL || "http://127.0.0.1:8011"}`);
    runPipeline(profile);

    const latest = latestRecommendationsFile();
    if (!latest) throw new Error("No recommendations output file found after run.");

    const target = `ab_${label}.json`;
    fs.copyFileSync(path.join(__dirname, latest), path.join(__dirname, target));
    outputs[label] = target;
    console.log(`Saved ${target}`);

    if (i < PROFILES.length - 1) {
      console.log(`Waiting ${WAIT_BETWEEN_RUNS_MS / 1000}s before next run...`);
      await sleep(WAIT_BETWEEN_RUNS_MS);
    }
  }

  const cmp = compareRuns(outputs);
  console.log(`\nDone. Comparison written to ${cmp}`);
}

main().catch((err) => {
  console.error(`\n❌ A/B run failed: ${err.message}`);
  process.exit(1);
});
