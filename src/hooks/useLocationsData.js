// src/hooks/useLocationsData.js
import { useEffect, useMemo, useState } from "react";
import * as turf from "@turf/turf";

/* ================= CSV parsing ================= */

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out;
}

function normalizeHeader(h) {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const cols = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function toNum(v) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const norm = (v) => String(v ?? "").trim();

function parseLatLonFromLocation(location) {
  const raw = norm(location);
  if (!raw) return { lat: null, lon: null };
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length < 2) return { lat: null, lon: null };
  return { lat: toNum(parts[0]), lon: toNum(parts[1]) };
}

function parseCountryProvinceFromRegion(region) {
  const raw = norm(region);
  if (!raw) return { country: "", province: "" };
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 1) return { country: "", province: parts[0] };
  const country = parts[parts.length - 1];
  const province = parts.slice(0, -1).join(", ");
  return { country, province };
}

function pickLat(r) {
  const fromLocation = parseLatLonFromLocation(
    r.location || r.coordinates || r.coordinates_lat_long || r.coordinates_lat_long_
  );
  return (
    toNum(r.lat) ??
    toNum(r.latitude) ??
    toNum(r.Latitude) ??
    toNum(r.y) ??
    fromLocation.lat ??
    null
  );
}

function pickLon(r) {
  const fromLocation = parseLatLonFromLocation(
    r.location || r.coordinates || r.coordinates_lat_long || r.coordinates_lat_long_
  );
  return (
    toNum(r.lon) ??
    toNum(r.lng) ??
    toNum(r.longitude) ??
    toNum(r.Longitude) ??
    toNum(r.x) ??
    fromLocation.lon ??
    null
  );
}

function pickCountry(r) {
  // supports both country and country_code columns
  const direct = norm(r.country || r.country_code || r.cntr || r.cntr_code || r.cntr_code_);
  if (direct) return direct;
  const reg = parseCountryProvinceFromRegion(r.p2green_region || r.p2greenregion);
  return reg.country;
}

function pickProvince(r) {
  const direct = norm(r.province || r.nuts_name || r.nuts2 || r.region || r.state);
  if (direct) return direct;
  const reg = parseCountryProvinceFromRegion(r.p2green_region || r.p2greenregion);
  return reg.province;
}

function pickKgNPerYear(r) {
  return toNum(r.kg_n_per_year) ?? toNum(r.kg_nyear) ?? toNum(r.kg_n_year) ?? 0;
}

function pickProduction(r) {
  // keep compatibility with your existing WTP csv fields
  return (
    toNum(r.production) ??
    toNum(r.liters_per_year) ??
    toNum(r.n_kgper_year) ??
    toNum(r.n_kg_per_year) ??
    0
  );
}

/* ================= Country locking + display ================= */

// ✅ locked list: only show these countries in the menu/index
const ALLOWED_COUNTRY_CODES = new Set(["FR", "IT", "HU", "GR"]);
const ALLOWED_COUNTRY_NAMES = new Set(["france", "italy", "hungary", "greece"]);

const CODE_TO_NAME = {
  FR: "France",
  IT: "Italy",
  HU: "Hungary",
  GR: "Greece",
};

const NAME_TO_CODE = {
  france: "FR",
  italy: "IT",
  hungary: "HU",
  greece: "GR",
};

function normalizeCountryToCode(value) {
  const s = norm(value);
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  const code = NAME_TO_CODE[s.toLowerCase()];
  return code || "";
}

function displayCountry(value) {
  const s = norm(value);
  if (!s) return "";
  if (s.length === 2) return CODE_TO_NAME[s.toUpperCase()] || s;
  return s;
}

function isAllowedCountry(value) {
  const s = norm(value);
  if (!s) return false;
  if (s.length === 2) return ALLOWED_COUNTRY_CODES.has(s.toUpperCase());
  return ALLOWED_COUNTRY_NAMES.has(s.toLowerCase());
}

function countryMatches(rowCountry, selectedCountry) {
  const row = norm(rowCountry);
  const sel = norm(selectedCountry);

  if (!sel) return true;

  // compare by code when possible (handles FR vs France)
  const rowCode = normalizeCountryToCode(row) || (row.length === 2 ? row.toUpperCase() : "");
  const selCode = normalizeCountryToCode(sel) || (sel.length === 2 ? sel.toUpperCase() : "");

  if (rowCode && selCode) return rowCode === selCode;

  return row.toLowerCase() === sel.toLowerCase();
}

function provinceMatches(rowProvince, selectedProvince) {
  const a = norm(rowProvince).toLowerCase();
  const b = norm(selectedProvince).toLowerCase();
  if (!b) return true;
  return a === b;
}

/* ================= CSV cache ================= */

const _cacheByUrl = new Map();
const _promiseByUrl = new Map();

async function loadCSV(url) {
  if (!url) return [];
  if (_cacheByUrl.has(url)) return _cacheByUrl.get(url);
  if (_promiseByUrl.has(url)) return _promiseByUrl.get(url);

  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load CSV (${r.status})`);
      return r.text();
    })
    .then((txt) => {
      const rows = parseCSV(txt);
      _cacheByUrl.set(url, rows);
      return rows;
    })
    .finally(() => {
      _promiseByUrl.delete(url);
    });

  _promiseByUrl.set(url, p);
  return p;
}

/* ================= Country/Province index (menu) ================= */

export function useCountryProvinceIndex(csvUrl) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [countries, setCountries] = useState([]);
  const [byCountry, setByCountry] = useState(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    loadCSV(csvUrl)
      .then((rows) => {
        const map = new Map(); // codeOrName -> Set(provinces)
        const cset = new Set();

        for (const r of rows) {
          const cRaw = pickCountry(r);
          const p = pickProvince(r);
          if (!cRaw || !p) continue;

          // lock to FR/IT/HU/GR only
          if (!isAllowedCountry(cRaw)) continue;

          // keep the country key as display name for UI
          const cDisp = displayCountry(cRaw);
          cset.add(cDisp);

          if (!map.has(cDisp)) map.set(cDisp, new Set());
          map.get(cDisp).add(p);
        }

        const sortedCountries = Array.from(cset).sort((a, b) => a.localeCompare(b));
        const normalized = new Map();

        for (const c of sortedCountries) {
          const arr = Array.from(map.get(c) || []).sort((a, b) => a.localeCompare(b));
          normalized.set(c, arr);
        }

        if (!cancelled) {
          setCountries(sortedCountries);
          setByCountry(normalized);
        }
      })
      .catch((e) => !cancelled && setError(e?.message || String(e)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [csvUrl]);

  return { loading, error, countries, byCountry };
}

/* ================= WTP hook ================= */

export function useLocationGroup(csvUrl, defaultRadiusKm, { country, province, globalRadiusKm } = {}) {
  const radiusKm = Number.isFinite(globalRadiusKm) ? globalRadiusKm : defaultRadiusKm;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    loadCSV(csvUrl)
      .then((all) => {
        const filtered = (all || [])
          .filter((r) => countryMatches(pickCountry(r), country))
          .filter((r) => provinceMatches(pickProvince(r), province))
          .map((r) => {
            const lat = pickLat(r);
            const lon = pickLon(r);
            return {
              ...r,
              lat,
              lon,
              Latitude: lat,
              Longitude: lon,
              country: pickCountry(r),
              province: pickProvince(r),
              __lat: lat,
              __lon: lon,
              __production: pickProduction(r),
            };
          })
          .filter((r) => r.__lat != null && r.__lon != null);

        if (!cancelled) setRows(filtered);
      })
      .catch((e) => !cancelled && setError(e?.message || String(e)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [csvUrl, country, province]);

  const firstPointCenter = useMemo(() => {
    if (!rows.length) return null;
    return [rows[0].__lat, rows[0].__lon];
  }, [rows]);

  const totalProduction = useMemo(() => {
    return rows.reduce((s, r) => s + (Number(r.__production) || 0), 0);
  }, [rows]);

  return {
    effectiveRows: rows,
    firstPointCenter,
    loading,
    error,
    totalProduction,
    maxSearchRadiusKm: radiusKm,
  };
}

/* ================= multi-dataset points hook ================= */

export function useManyGenericPoints(datasets = [], { country, province } = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [byKey, setByKey] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const run = async () => {
      try {
        const entries = await Promise.all(
          (datasets || []).map(async (d) => {
            const all = await loadCSV(d.url);

            const rows = (all || [])
              .filter((r) => countryMatches(pickCountry(r), country))
              .filter((r) => provinceMatches(pickProvince(r), province))
              .map((r) => {
                const lat = pickLat(r);
                const lon = pickLon(r);

                // prefer name_en if present
                const name = norm(r.name_en || r.name || r.title) || "Location";

                return {
                  ...r,
                  lat,
                  lon,
                  country: pickCountry(r),
                  province: pickProvince(r),
                  name,
                  kg_n_per_year: pickKgNPerYear(r),
                  __type: d.key,
                  __label: d.label,
                };
              })
              .filter((r) => r.lat != null && r.lon != null);

            return [d.key, rows];
          })
        );

        if (!cancelled) setByKey(Object.fromEntries(entries));
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(datasets), country, province]);

  return { byKey, loading, error };
}
