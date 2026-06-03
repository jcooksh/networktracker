import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8765";

// stable node key per (device, destination)
const keyOf = (f) => `${f.device}__${f.lat.toFixed(2)}_${f.lng.toFixed(2)}`;

export default function App() {
  const [home, setHome] = useState(null);          // {lat,lng,city,country,ip}
  const [nodes, setNodes] = useState({});           // key -> persistent node {count,...}
  const [feed, setFeed] = useState([]);             // recent flows, newest first
  const [device, setDevice] = useState("all");

  useEffect(() => {
    let ws, retry;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "home") { setHome(m); return; }
        // flow
        const k = keyOf(m);
        setNodes((prev) => {
          const ex = prev[k];
          return {
            ...prev,
            [k]: {
              ...m, key: k,
              count: (ex?.count || 0) + 1,
              firstTs: ex?.firstTs || m.ts,
              lastTs: m.ts,
            },
          };
        });
        setFeed((prev) => [m, ...prev].slice(0, 50));
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { clearTimeout(retry); ws && ws.close(); };
  }, []);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  // device tabs with per-device packet totals
  const devices = useMemo(() => {
    const agg = {};
    for (const n of nodeList) agg[n.device] = (agg[n.device] || 0) + n.count;
    return Object.entries(agg).sort((a, b) => b[1] - a[1]);
  }, [nodeList]);

  const shown = device === "all" ? nodeList : nodeList.filter((n) => n.device === device);
  const shownFeed = device === "all" ? feed : feed.filter((f) => f.device === device);

  return (
    <div className="app">
      <div className="tabs">
        <span className="brand">◉ networktracker</span>
        <Tab label="All devices" active={device === "all"}
             count={nodeList.reduce((s, n) => s + n.count, 0)}
             onClick={() => setDevice("all")} />
        {devices.map(([d, c]) => (
          <Tab key={d} label={d} count={c} active={device === d}
               onClick={() => setDevice(d)} />
        ))}
      </div>

      <div className="content">
        <div className="map-area">
          <MapView home={home} nodes={shown} />
        </div>
        <Sidebar home={home} nodes={shown} device={device} />
        <BottomFeed feed={shownFeed} />
      </div>
    </div>
  );
}

function Tab({ label, count, active, onClick }) {
  return (
    <div className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      {label}<span className="count">{count}</span>
    </div>
  );
}

function MapView({ home, nodes }) {
  const center = home ? [home.lat, home.lng] : [20, 0];
  return (
    <MapContainer center={center} zoom={3} worldCopyJump style={{ height: "100%" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO"
      />
      {home && (
        <CircleMarker center={[home.lat, home.lng]} radius={7}
          pathOptions={{ color: "#4ade80", fillColor: "#4ade80", fillOpacity: 1 }}>
          <Tooltip>home · {home.city} {home.country} · {home.ip}</Tooltip>
        </CircleMarker>
      )}
      {home && nodes.map((n) => (
        <Polyline key={"l" + n.key}
          positions={[[home.lat, home.lng], [n.lat, n.lng]]}
          pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.35 }} />
      ))}
      {nodes.map((n) => (
        <CircleMarker key={n.key} center={[n.lat, n.lng]}
          radius={4 + Math.min(14, Math.log2(n.count + 1) * 3)}
          className="pulse-node"
          pathOptions={{ color: "#f472b6", fillColor: "#f472b6", fillOpacity: 0.7 }}>
          <Tooltip>
            {n.device} → {n.city || n.dst_ip} ({n.country})<br />
            {n.proto}:{n.dport} · {n.count} pkts
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Sidebar({ home, nodes, device }) {
  const total = nodes.reduce((s, n) => s + n.count, 0);
  const dests = nodes.length;
  const countries = new Set(nodes.map((n) => n.country).filter(Boolean)).size;

  const byCountry = useMemo(() => {
    const agg = {};
    for (const n of nodes) agg[n.country || "?"] = (agg[n.country || "?"] || 0) + n.count;
    return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [nodes]);

  const topDest = useMemo(
    () => [...nodes].sort((a, b) => b.count - a.count).slice(0, 6),
    [nodes]
  );
  const max = byCountry[0]?.[1] || 1;

  return (
    <div className="sidebar">
      <div className="card">
        <h3>This network</h3>
        {home ? (
          <div className="home-line">
            <span className="dot" style={{ background: "var(--green)" }} />
            {home.city || "Unknown"} {home.country} · <span className="ip">{home.ip || "—"}</span>
          </div>
        ) : <div className="home-line">resolving…</div>}
      </div>

      <div className="card">
        <h3>{device === "all" ? "Totals" : device}</h3>
        <div className="stat-grid">
          <div className="stat"><div className="v">{total}</div><div className="l">packets</div></div>
          <div className="stat"><div className="v">{dests}</div><div className="l">destinations</div></div>
          <div className="stat"><div className="v">{countries}</div><div className="l">countries</div></div>
          <div className="stat"><div className="v">{home ? "live" : "—"}</div><div className="l">status</div></div>
        </div>
      </div>

      <div className="card">
        <h3>Top countries</h3>
        {byCountry.map(([c, n]) => (
          <div key={c}>
            <div className="row"><span className="k">{c}</span><span className="n">{n}</span></div>
            <div className="bar" style={{ width: `${(n / max) * 100}%` }} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Top destinations</h3>
        {topDest.map((n) => (
          <div className="row" key={n.key}>
            <span className="k">{n.city || n.dst_ip}</span>
            <span className="n">{n.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomFeed({ feed }) {
  return (
    <div className="bottom card">
      <h3>Live feed</h3>
      <table>
        <thead>
          <tr><th>Time</th><th>Device</th><th>Destination</th><th>Country</th><th>Proto</th></tr>
        </thead>
        <tbody>
          {feed.map((f, i) => (
            <tr key={i}>
              <td className="dim">{new Date(f.ts * 1000).toLocaleTimeString()}</td>
              <td>{f.device}</td>
              <td>{f.city || f.dst_ip}</td>
              <td>{f.country}</td>
              <td className="dim">{f.proto}:{f.dport}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
