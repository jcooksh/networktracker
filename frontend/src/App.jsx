import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8765";
const HOME = { lat: 37.7749, lng: -122.4194 };   // match backend config.home
const TTL_MS = 6000;                              // how long a flow stays on screen

export default function App() {
  const [flows, setFlows] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    let ws;
    let retry;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        const f = JSON.parse(e.data);
        const id = ++idRef.current;
        setFlows((cur) => [...cur, { ...f, id }]);
        setTimeout(
          () => setFlows((cur) => cur.filter((x) => x.id !== id)),
          TTL_MS
        );
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { clearTimeout(retry); ws && ws.close(); };
  }, []);

  return (
    <MapContainer center={[20, 0]} zoom={2} worldCopyJump
      style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO"
      />

      {/* home marker */}
      <CircleMarker center={[HOME.lat, HOME.lng]} radius={6}
        pathOptions={{ color: "#4ade80", fillColor: "#4ade80", fillOpacity: 1 }}>
        <Tooltip>home</Tooltip>
      </CircleMarker>

      {flows.map((f) => (
        <FlowGfx key={f.id} flow={f} />
      ))}
    </MapContainer>
  );
}

function FlowGfx({ flow }) {
  return (
    <>
      <Polyline
        positions={[[HOME.lat, HOME.lng], [flow.lat, flow.lng]]}
        pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.5 }}
      />
      <CircleMarker
        center={[flow.lat, flow.lng]}
        radius={5}
        pathOptions={{ color: "#f472b6", fillColor: "#f472b6", fillOpacity: 0.8 }}
        className="pulse"
      >
        <Tooltip>
          {flow.device} → {flow.city || flow.dst_ip} ({flow.country}) · {flow.proto}:{flow.dport}
        </Tooltip>
      </CircleMarker>
    </>
  );
}
