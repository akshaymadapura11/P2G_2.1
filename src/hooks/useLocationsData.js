// src/hooks/useLocationsData.js
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

/**
 * Countries allowed in the UI
 * (lock all except France, Italy, Hungary, Greece)
 */
const ALLOWED_COUNTRIES = new Set(["France", "Italy", "Hungary", "Greece"]);

/**
 * Map codes to country names
 */
const COUNTRY_MAP = {
  FR: "France",
  IT: "Italy",
  HU: "Hungary",
  EL: "Greece", // EU code sometimes used in datasets
  GR: "Greece",
  Greece: "Greece",
  France: "France",
  Italy: "Italy",
  Hungary: "Hungary",
};

export function normalizeCountry(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const upper = s.toUpperCase();
  return COUNTRY_MAP[upper] || COUNTRY_MAP[s] || s;
}

/**
 * Normalize province names (especially Greece) to canonical English NUTS-2 names
 */
export function normalizeProvinceName(p) {
  if (p == null) return "";
  let s = String(p).trim();
  if (!s) return "";

  // Handle "CODE - Name"
  const dashIdx = s.indexOf(" - ");
  if (dashIdx !== -1) s = s.slice(dashIdx + 3).trim();

  // Fix mixed Latin/GGreek leading A (observed in WTP CSV: "Aττική")
  s = s.replace(/^A(?=[\u0370-\u03FF])/u, "Α");

  const norm = (x) =>
    String(x)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[,_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const key = norm(s);

  const MAP = {
    // Attica
    "αττικη": "Attica",

    // Eastern Macedonia & Thrace
    "ανατολικη μακεδονια θρακη": "Eastern Macedonia and Thrace",
    "ανατολικη μακεδονια και θρακη": "Eastern Macedonia and Thrace",

    // Central Macedonia
    "κεντρικη μακεδονια": "Central Macedonia",

    // Western Macedonia
    "δυτικη μακεδονια": "Western Macedonia",

    // Thessaly
    "θεσσαλια": "Thessaly",

    // Epirus
    "ηπειρος": "Epirus",

    // Ionian Islands
    "ιονια νησια": "Ionian Islands",

    // Western Greece
    "δυτικη ελλαδα": "Western Greece",

    // Central Greece
    "στερεα ελλαδα": "Central Greece",

    // Peloponnese
    "πελοποννησος": "Peloponnese",

    // North Aegean
    "βορειο αιγαιο": "North Aegean",

    // South Aegean
    "νοτιο αιγαιο": "South Aegean",

    // Crete
    "κρητη": "Crete",
  };

  return MAP[key] || s;
}

function toNum(x) {
  if (x == null) return null;

  if (typeof x === "string") {
    const t = x.trim();
    if (t === "") return null;
    // handle European decimals like "37,95"
    x = t.replace(",", ".");
  }

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pick(row, keys) {
  for (const k of keys) {
    if (row?.[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

/**
 * Parses coordinates from:
 *  - lat/lon columns (preferred)
 *  - "location" column formatted as "lat, lon" (fallback)
 * Handles swapped "lon, lat" and rejects accidental (0,0).
 */
function parseLatLon(row) {
  const latRaw = pick(row, ["lat", "latitude", "Latitude", "__lat"]);
  const lonRaw = pick(row, ["lon", "lng", "longitude", "Longitude", "__lon"]);

  let lat = toNum(latRaw);
  let lon = toNum(lonRaw);

  if ((lat == null || lon == null) && row?.location != null) {
    const parts = String(row.location)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      const a = toNum(parts[0]);
      const b = toNum(parts[1]);

      if (a != null && b != null) {
        // usual: "lat, lon"
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          lat = a;
          lon = b;
        } else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
          // swapped: "lon, lat"
          lat = b;
          lon = a;
        }
      }
    }
  }

  if (lat == null || lon == null) return { lat: null, lon: null };
  if (lat === 0 && lon === 0) return { lat: null, lon: null };

  return { lat, lon };
}

async function fetchCsv(url, abortSignal) {
  const res = await fetch(url, { signal: abortSignal });
  if (!res.ok) throw new Error(`Failed to load CSV: ${url} (${res.status})`);
  const text = await res.text();

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rows = (parsed.data || []).filter((r) => r && Object.keys(r).length);
  return rows;
}

function normalizeRowCountryProvince(row) {
  const countryRaw =
    pick(row, ["country", "Country"]) ??
    pick(row, ["country_code", "Country_code", "Country Code", "countryCode"]) ??
    "";

  const provinceRaw = pick(row, ["province", "Province", "nuts2", "NUTS2"]) ?? "";

  const country = normalizeCountry(countryRaw);
  const province = normalizeProvinceName(provinceRaw);

  return { ...row, country, province };
}

function matchesCountryProvince(row, { country, province }) {
  const rowCountry = normalizeCountry(row?.country ?? row?.country_code ?? "");
  const rowProvince = normalizeProvinceName(row?.province ?? "");

  const wantCountry = normalizeCountry(country || "");
  const wantProvince = normalizeProvinceName(province || "");

  if (wantCountry && rowCountry !== wantCountry) return false;
  if (wantProvince && rowProvince !== wantProvince) return false;
  return true;
}

/**
 * Builds the country -> provinces index for the Menu.
 * Merges WTP + extra datasets so provinces don't "disappear" for a country.
 */
export function useCountryProvinceIndex(wtpCsvUrl, extraDatasets = []) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    countries: [],
    provincesByCountry: {},
  });

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const allRows = [];

        // WTP base
        if (wtpCsvUrl) {
          const wtpRows = await fetchCsv(wtpCsvUrl, controller.signal);
          allRows.push(...wtpRows);
        }

        // Extras
        for (const d of extraDatasets || []) {
          if (!d?.url) continue;
          try {
            const r = await fetchCsv(d.url, controller.signal);
            allRows.push(...r);
          } catch {
            // ignore extras failing; menu should still work
          }
        }

        const provincesByCountry = {};
        for (const raw of allRows) {
          const row = normalizeRowCountryProvince(raw);
          const c = row.country;
          const p = row.province;

          if (!c || !ALLOWED_COUNTRIES.has(c)) continue;
          if (!p) continue;

          if (!provincesByCountry[c]) provincesByCountry[c] = new Set();
          provincesByCountry[c].add(p);
        }

        const countries = Object.keys(provincesByCountry).sort((a, b) => a.localeCompare(b));
        const out = {};
        for (const c of countries) {
          out[c] = Array.from(provincesByCountry[c]).sort((a, b) => a.localeCompare(b));
        }

        setState({ loading: false, error: "", countries, provincesByCountry: out });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          error: e?.message || "Failed to build index",
          countries: [],
          provincesByCountry: {},
        });
      }
    })();

    return () => controller.abort();
  }, [wtpCsvUrl, JSON.stringify((extraDatasets || []).map((d) => ({ key: d.key, url: d.url })))]);

  return state;
}

/**
 * WTP hook (supply from WTPs)
 */
export function useLocationGroup(csvUrl, _unusedRadiusKm = 2, opts = {}) {
  const { country, province } = opts;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    (async () => {
      try {
        const raw = await fetchCsv(csvUrl, controller.signal);
        const normalized = raw.map(normalizeRowCountryProvince);

        const filtered = normalized.filter((r) => matchesCountryProvince(r, { country, province }));

        const cleaned = filtered
          .map((r) => {
            const { lat, lon } = parseLatLon(r);
            if (lat == null || lon == null) return null;
            return {
              ...r,
              __lat: lat,
              __lon: lon,
            };
          })
          .filter(Boolean);

        setRows(cleaned);
        setLoading(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e?.message || "Failed to load WTP CSV");
        setRows([]);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [csvUrl, country, province]);

  const firstPointCenter = useMemo(() => {
    if (!rows.length) return null;
    return [Number(rows[0].__lat), Number(rows[0].__lon)];
  }, [rows]);

  // Production (kg N / year) sum; include WTP column "N kg/per year"
  const totalProduction = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      const v =
        toNum(
          pick(r, [
            "kg_n_per_year",
            "n_kg_per_year",
            "n_kgper_year",
            "production",
            "output",
            "N kg/per year",
            "N kg/per year ",
          ])
        ) || 0;

      sum += v;
    }
    return sum;
  }, [rows]);

  return {
    loading,
    error,
    rows,
    effectiveRows: rows,
    firstPointCenter,
    totalProduction,
  };
}

/**
 * Loads and groups multiple generic point datasets.
 * Each row gets:
 *   __type = dataset.key
 *   __label = dataset.label
 *   country/province normalized
 *
 * IMPORTANT:
 * LandUseMap expects extra points to have lat/lon fields.
 */
export function useManyGenericPoints(datasets = [], opts = {}) {
  const { country, province } = opts;

  const [state, setState] = useState({ loading: true, error: "", byKey: {} });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, error: "", byKey: {} });

    (async () => {
      try {
        const byKey = {};

        for (const d of datasets || []) {
          if (!d?.url || !d?.key) continue;

          const raw = await fetchCsv(d.url, controller.signal);
          const normalized = raw.map(normalizeRowCountryProvince);

          const filtered = normalized
            .filter((r) => matchesCountryProvince(r, { country, province }))
            .map((r) => {
              const { lat, lon } = parseLatLon(r);
              if (lat == null || lon == null) return null;

              // dataset supply value (your public datasets use kg_n_per_year)
              const kg =
                toNum(pick(r, ["kg_n_per_year", "n_kg_per_year", "output", "production"])) || 0;

              return {
                ...r,

                // ✅ LandUseMap uses these
                lat,
                lon,

                // keep for compatibility
                __lat: lat,
                __lon: lon,

                // required for legend/coloring
                __type: d.key,
                __label: d.label || d.key,

                kg_n_per_year: kg,

                // sensible name for popups across datasets
                name:
                  pick(r, ["name", "Name", "facility_name", "Facility", "Airport", "University"]) ||
                  r.name ||
                  r.Name ||
                  "",
              };
            })
            .filter(Boolean);

          byKey[d.key] = filtered;
        }

        setState({ loading: false, error: "", byKey });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: e?.message || "Failed to load datasets", byKey: {} });
      }
    })();

    return () => controller.abort();
  }, [JSON.stringify((datasets || []).map((d) => ({ key: d.key, url: d.url }))), country, province]);

  return state;
}
