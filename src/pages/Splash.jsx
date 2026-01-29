// src/pages/Splash.jsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WTP_ALL_CSV } from "../utils/data";
import { useCountryProvinceIndex } from "../hooks/useLocationsData";
import "../App.css";

export default function Splash() {
  const nav = useNavigate();
  const { loading, error, countries, byCountry } = useCountryProvinceIndex(WTP_ALL_CSV);

  const [country, setCountry] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [provFilter, setProvFilter] = useState("");

  const filteredCountries = useMemo(() => {
    const q = countryFilter.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.toLowerCase().includes(q));
  }, [countries, countryFilter]);

  const provinces = useMemo(() => {
    if (!country) return [];
    const list = byCountry.get(country) || [];
    const q = provFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.toLowerCase().includes(q));
  }, [byCountry, country, provFilter]);

  return (
    <div className="splash">
      <div className="splashCard" style={{ width: 920, maxWidth: "92vw" }}>
        <h1>Welcome to P2Green platform!</h1>
        <p className="subtitle">Select a country, then a province (NUTS-2).</p>

        {loading && <div className="splashHint">Loading…</div>}
        {error && <div className="splashHint">Error: {error}</div>}

        {!loading && !error && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 18,
              marginTop: 12,
              alignItems: "start",
            }}
          >
            {/* Countries */}
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <strong>Countries</strong>
                <input
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                  placeholder="Search country…"
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)" }}
                />
              </div>

              <div
                style={{
                  marginTop: 10,
                  maxHeight: 360,
                  overflow: "auto",
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 10,
                  padding: 8,
                }}
              >
                {filteredCountries.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCountry(c);
                      setProvFilter("");
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "none",
                      marginBottom: 6,
                      cursor: "pointer",
                      background: c === country ? "rgba(25,103,210,0.12)" : "transparent",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Provinces */}
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <strong>Provinces (NUTS-2)</strong>
                <input
                  value={provFilter}
                  onChange={(e) => setProvFilter(e.target.value)}
                  placeholder={country ? "Search province…" : "Select a country first…"}
                  disabled={!country}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.15)",
                    opacity: country ? 1 : 0.6,
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: 10,
                  maxHeight: 360,
                  overflow: "auto",
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 10,
                  padding: 8,
                  opacity: country ? 1 : 0.55,
                }}
              >
                {!country && <div style={{ padding: 10, color: "#666" }}>Choose a country to view provinces.</div>}

                {country &&
                  provinces.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        nav(`/map/${encodeURIComponent(country)}/${encodeURIComponent(p)}`)
                      }
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "none",
                        marginBottom: 6,
                        cursor: "pointer",
                        background: "transparent",
                      }}
                    >
                      {p}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <img className="p2Logo" src="/logo.png" alt="P2Green logo" />
    </div>
  );
}
