// src/pages/Menu.jsx
import { Link } from "react-router-dom";
import { LOCATION_GROUPS } from "../utils/data";
import "../App.css";

export default function Menu() {
  return (
    <div className="details-pane" style={{ maxWidth: 640, margin: "40px auto" }}>
      <h2>Select a Location Set</h2>
      <div className="card">
        <ul className="toggle-list">
          {LOCATION_GROUPS.map((g) => (
            <li key={g.id} style={{ justifyContent: "space-between" }}>
              <span>{g.label}</span>
              <Link className="btn" to={`/map/${g.id}`}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p style={{ color: "#666" }}>
        CSV paths are configured in <code>src/utils/data.js</code>. Files should live in
        <code>/public</code>.
      </p>
    </div>
  );
}
