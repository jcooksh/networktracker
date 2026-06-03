import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8765";

// one persistent node per (device, destination IP)
const keyOf = (f) => `${f.device}__${f.dst_ip}`;
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString();

export default function App() {
  const [home, setHome] = useState(null);          // {lat,lng,city,country,ip}
  const [nodes, setNodes] = useState({});           // key -> persistent node
  const [feed, setFeed] = useState([]);             // recent flows, newest first
  const [view, setView] = useState("map");          // map | devices | countries

  useEffect(() => {
    let ws, retry;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "home") { setHome(m); return; }
        const k = keyOf(m);
        setNodes((prev) => {
          const ex = prev[k];
          return {
            ...prev,
            [k]: { ...m, key: k, count: (ex?.count || 0) + 1,
                   firstTs: ex?.firstTs || m.ts, lastTs: m.ts },
          };
        });
        setFeed((prev) => [m, ...prev].slice(0, 80));
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { clearTimeout(retry); ws && ws.close(); };
  }, []);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const totalPkts = nodeList.reduce((s, n) => s + n.count, 0);

  return (
    <div className="app">
      <div className="tabs">
        <span className="brand">◉ networktracker</span>
        <Tab label="Map" active={view === "map"} onClick={() => setView("map")} />
        <Tab label="Devices" active={view === "devices"} onClick={() => setView("devices")} />
        <Tab label="Countries" active={view === "countries"} onClick={() => setView("countries")} />
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
          {home ? `home ${home.ip}` : "resolving…"} · {totalPkts} pkts
        </span>
      </div>

      {view === "map" && (
        <div className="content">
          <div className="map-area"><MapView home={home} nodes={nodeList} /></div>
          <Sidebar home={home} nodes={nodeList} />
          <BottomFeed feed={feed} />
        </div>
      )}
      {view === "devices" && <DevicesView nodes={nodeList} />}
      {view === "countries" && <CountriesView nodes={nodeList} />}
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return <div className={`tab ${active ? "active" : ""}`} onClick={onClick}>{label}</div>;
}

function MapView({ home, nodes }) {
  const center = home ? [home.lat, home.lng] : [20, 0];
  return (
    <MapContainer center={center} zoom={3} worldCopyJump style={{ height: "100%" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO" />
      {home && (
        <CircleMarker center={[home.lat, home.lng]} radius={7}
          pathOptions={{ color: "#4ade80", fillColor: "#4ade80", fillOpacity: 1 }}>
          <Tooltip>home · {home.city} {home.country} · {home.ip}</Tooltip>
        </CircleMarker>
      )}
      {home && nodes.map((n) => (
        <Polyline key={"l" + n.key} positions={[[home.lat, home.lng], [n.lat, n.lng]]}
          pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.3 }} />
      ))}
      {nodes.map((n) => (
        <CircleMarker key={n.key} center={[n.lat, n.lng]}
          radius={4 + Math.min(14, Math.log2(n.count + 1) * 3)} className="pulse-node"
          pathOptions={{ color: "#f472b6", fillColor: "#f472b6", fillOpacity: 0.7 }}>
          <Tooltip>
            <b>{n.device}</b> → {n.dst_ip}{n.dst_host ? ` (${n.dst_host})` : ""}<br />
            {n.city} {n.country} · {n.proto}:{n.dport} · {n.count} pkts
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Sidebar({ home, nodes }) {
  const total = nodes.reduce((s, n) => s + n.count, 0);
  const devices = new Set(nodes.map((n) => n.device)).size;
  const countries = new Set(nodes.map((n) => n.country).filter(Boolean)).size;

  const topDest = useMemo(
    () => [...nodes].sort((a, b) => b.count - a.count).slice(0, 8), [nodes]);

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
        <h3>Totals</h3>
        <div className="stat-grid">
          <div className="stat"><div className="v">{total}</div><div className="l">packets</div></div>
          <div className="stat"><div className="v">{nodes.length}</div><div className="l">destinations</div></div>
          <div className="stat"><div className="v">{devices}</div><div className="l">devices</div></div>
          <div className="stat"><div className="v">{countries}</div><div className="l">countries</div></div>
        </div>
      </div>
      <div className="card">
        <h3>Top destinations</h3>
        {topDest.map((n) => (
          <div className="row" key={n.key}>
            <span className="k">{n.dst_ip} <span style={{ color: "var(--muted)" }}>
              {n.dst_host || n.city}</span></span>
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
        <thead><tr>
          <th>Time</th><th>Device</th><th>Src IP</th><th>Dest IP</th>
          <th>Host</th><th>City</th><th>Country</th><th>Proto</th>
        </tr></thead>
        <tbody>
          {feed.map((f, i) => (
            <tr key={i}>
              <td className="dim">{fmtTime(f.ts)}</td>
              <td>{f.device}</td>
              <td className="dim">{f.src_ip}</td>
              <td>{f.dst_ip}</td>
              <td className="dim">{f.dst_host || "—"}</td>
              <td>{f.city}</td>
              <td>{f.country}</td>
              <td className="dim">{f.proto}:{f.dport}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesView({ nodes }) {
  const rows = useMemo(() => {
    const agg = {};
    for (const n of nodes) {
      const a = (agg[n.device] ||= {
        device: n.device, src_ip: n.src_ip, pkts: 0,
        dests: new Set(), countries: new Set(), lastTs: 0 });
      a.pkts += n.count; a.dests.add(n.dst_ip);
      if (n.country) a.countries.add(n.country);
      a.lastTs = Math.max(a.lastTs, n.lastTs);
    }
    return Object.values(agg).sort((a, b) => b.pkts - a.pkts);
  }, [nodes]);

  return (
    <div className="full card">
      <h3>Devices ({rows.length})</h3>
      <table>
        <thead><tr>
          <th>Device</th><th>Local IP</th><th>Packets</th>
          <th>Destinations</th><th>Countries</th><th>Last seen</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.device}>
              <td>{r.device}</td>
              <td className="dim">{r.src_ip}</td>
              <td className="n">{r.pkts}</td>
              <td>{r.dests.size}</td>
              <td>{r.countries.size}</td>
              <td className="dim">{fmtTime(r.lastTs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountriesView({ nodes }) {
  const rows = useMemo(() => {
    const agg = {};
    for (const n of nodes) {
      const c = n.country || "?";
      const a = (agg[c] ||= { country: c, pkts: 0, dests: new Set(), devices: new Set() });
      a.pkts += n.count; a.dests.add(n.dst_ip); a.devices.add(n.device);
    }
    return Object.values(agg).sort((a, b) => b.pkts - a.pkts);
  }, [nodes]);
  const max = rows[0]?.pkts || 1;

  return (
    <div className="full card">
      <h3>Countries ({rows.length})</h3>
      <table>
        <thead><tr>
          <th>Country</th><th>Packets</th><th>Destinations</th><th>Devices</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country}>
              <td>{r.country}</td>
              <td className="n">{r.pkts}</td>
              <td>{r.dests.size}</td>
              <td>{r.devices.size}</td>
              <td style={{ width: "40%" }}>
                <div className="bar" style={{ width: `${(r.pkts / max) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
