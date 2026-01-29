// src/components/PublicBuildingsLayer.jsx
import { CircleMarker, Popup } from "react-leaflet";

export default function PublicBuildingsLayer({ points = [] }) {
  return (
    <>
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lon]}
          radius={6}
          pathOptions={{ color: "red", fillColor: "red", fillOpacity: 0.9 }}
        >
          <Popup>
            <strong>{p.name}</strong>
            <div>
              {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
