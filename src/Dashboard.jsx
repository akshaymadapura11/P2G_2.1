// src/Dashboard.jsx
import "./App.css";

const LANDUSE_LABELS = {
  farmland: "Farmland",
  plantation: "Plantation",
  orchard: "Orchard",
  vineyard: "Vineyard",
  greenhouse_horticulture: "Greenhouse horticulture",
  green_public_spaces: "Green public spaces",
};

const LANDUSE_COLORS = {
  farmland: "#FFD700",
  plantation: "#8B4513",
  orchard: "#7FFF00",
  vineyard: "#8B008B",
  greenhouse_horticulture: "#00CED1",
};

const REQUIRED_KG_PER_HA = 160;

const SUPPLY_COLORS = {
  wtp: "#1967d2",
  airports: "#1a73e8",
  prisons: "#f9ab00",
  stadiums: "#34a853",
  universities: "#a142f4",
  chefExpress: "#d93025",
};

function swatchStyle(hex) {
  return {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: hex,
    border: "1px solid rgba(0,0,0,0.25)",
    display: "inline-block",
  };
}

function SupplyCard({ title, supplyKg, demandKg }) {
  const pct = demandKg > 0 ? (supplyKg / demandKg) * 100 : 0;
  return (
    <div className="panel small">
      <h4>{title}</h4>
      <div className="miniStat">
        <div className="miniPct">{pct.toFixed(1)}%</div>
        <div className="miniRow">
          <span>Nitrogen fertilizer supply</span>
          <span>{Math.round(supplyKg).toLocaleString()} kg</span>
        </div>
        <div className="miniRow">
          <span>Nitrogen fertilizer demand</span>
          <span>{Math.round(demandKg).toLocaleString()} kg</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  extraDatasets = [],
  extraToggles = {},
  onToggleExtra = () => {},

  markerRadius = 6,
  onMarkerRadiusChange = () => {},

  radiusKm = 2,
  onRadiusKmChange = () => {},

  landuseTypes = [],
  toggles = {},
  onToggle = () => {},

  features = [],

  wtpSupplyKg = 0,
  publicSupplyKg = 0,
  totalSupplyKg = 0,

  showWtp = true,
  onToggleWtp = () => {},
}) {
  const totalAreaM2 = (features || []).reduce((s, f) => s + (f?.properties?.area || 0), 0);
  const totalAreaKm2 = totalAreaM2 / 1e6;

  const demandKg = (features || []).reduce((sum, f) => {
    const areaHa = (f?.properties?.area || 0) / 10000;
    return sum + areaHa * REQUIRED_KG_PER_HA;
  }, 0);

  return (
    <>
      <div className="rightPanels">
        <div className="panel">
          <h3>Define fertilizer supply!</h3>
          <p className="panelSub">Choose wastewater treatment plants and/or public building datasets.</p>

          <label className="panelRow">
            <input type="checkbox" checked={showWtp} onChange={onToggleWtp} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={swatchStyle(SUPPLY_COLORS.wtp)} />
              Waste water treatment plants
            </span>
          </label>

          {(extraDatasets || []).map((d) => {
            const color = SUPPLY_COLORS[d.key] || "#888";
            return (
              <label key={d.key} className="panelRow">
                <input
                  type="checkbox"
                  checked={!!extraToggles?.[d.key]}
                  onChange={() => onToggleExtra(d.key)}
                />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={swatchStyle(color)} />
                  {d.label}
                </span>
              </label>
            );
          })}

          <div className="divider" />

          <div className="panelSub" style={{ marginBottom: 6 }}>
            Define area of fertilizer demand!
          </div>

          <label className="panelRow" style={{ alignItems: "center" }}>
            <span style={{ width: 140 }}>Radius in km</span>
            <input
              className="panelInput"
              type="number"
              min="0"
              step="0.5"
              value={radiusKm}
              onChange={(e) => onRadiusKmChange(Number(e.target.value))}
            />
          </label>

          <div className="divider" />

          <div className="panelSub" style={{ marginBottom: 6 }}>
            Circle marker radius (datasets)
          </div>

          <label className="panelRow" style={{ alignItems: "center" }}>
            <span style={{ width: 140 }}>Radius (px)</span>
            <input
              className="panelInput"
              type="number"
              min="1"
              step="1"
              value={markerRadius}
              onChange={(e) => onMarkerRadiusChange(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="panel">
          <h3>Agricultural land</h3>
          <p className="panelSub">Select one or more crop types to visualize and analyze agricultural areas.</p>

          <div className="panelGrid">
            {landuseTypes.map((t) => (
              <label key={t} className="panelRow">
                <input type="checkbox" checked={!!toggles[t]} onChange={() => onToggle(t)} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="legendSwatch"
                    style={{
                      backgroundColor: LANDUSE_COLORS[t] || "#ccc",
                      border: "1px solid rgba(0,0,0,0.25)",
                    }}
                  />
                  {LANDUSE_LABELS[t] ?? t.replaceAll("_", " ")}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button className="panel about" type="button">
          ABOUT P2GREEN
        </button>
      </div>

      <div className="bottomMeta">
        <div className="bottomText">
          Total farming area: <strong>{totalAreaKm2.toFixed(2)} km²</strong>
        </div>
      </div>

      <div className="bottomPanels">
        <SupplyCard title="Waste water treatment plants supply vs demand per year" supplyKg={wtpSupplyKg} demandKg={demandKg} />
        <SupplyCard title="Public buildings supply vs demand per year" supplyKg={publicSupplyKg} demandKg={demandKg} />
        <SupplyCard title="Total supply vs demand per year" supplyKg={totalSupplyKg} demandKg={demandKg} />
      </div>
    </>
  );
}
