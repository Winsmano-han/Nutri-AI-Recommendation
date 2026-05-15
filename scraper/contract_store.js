import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
const SUPABASE_TABLE = process.env.SUPABASE_CONTRACT_TABLE || "user_contracts";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const localDir = process.env.CONTRACT_STORE_DIR || path.join(baseDir, "user_contracts");

function safeUserId(userId) {
  return String(userId || "default")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 120) || "default";
}

function hasSupabase() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase contract store error ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function loadUserContract(userId) {
  const id = safeUserId(userId);
  if (!userId) return null;

  if (hasSupabase()) {
    const rows = await supabaseRequest(
      `/rest/v1/${SUPABASE_TABLE}?user_id=eq.${encodeURIComponent(id)}&select=contract&limit=1`
    );
    return rows?.[0]?.contract || null;
  }

  const file = path.join(localDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export async function saveUserContract(userId, contract) {
  const id = safeUserId(userId);
  const payload = {
    ...contract,
    userId: id,
  };

  if (hasSupabase()) {
    await supabaseRequest(`/rest/v1/${SUPABASE_TABLE}?on_conflict=user_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: id,
        contract: payload,
        updated_at: new Date().toISOString(),
      }),
    });
    return { backend: "supabase", userId: id };
  }

  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, `${id}.json`), JSON.stringify(payload, null, 2), "utf8");
  return { backend: "local_file", userId: id };
}

export function contractStoreInfo() {
  return {
    backend: hasSupabase() ? "supabase" : "local_file",
    table: hasSupabase() ? SUPABASE_TABLE : null,
    localDir: hasSupabase() ? null : localDir,
  };
}
