import nigeria from "./nigeria.js";
import canada from "./canada.js";

const packs = {
  NG: nigeria,
  CA: canada,
};

export function normalizeCountry(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["ca", "can", "canada"].includes(raw)) return "CA";
  if (["ng", "nga", "nigeria"].includes(raw)) return "NG";
  return null;
}

export function inferCountryFromCoordinates(lat, lng) {
  if (lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52) return "CA";
  if (lat >= 4 && lat <= 14.5 && lng >= 2 && lng <= 15) return "NG";
  return "NG";
}

export function loadCountryPack(countryCode) {
  return packs[countryCode] || packs.NG;
}
