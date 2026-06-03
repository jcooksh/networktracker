import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8765";

// finest-grain persistent node: (device, dst ip, proto, port)
const keyOf = (f) => `${f.device}|${f.dst_ip}|${f.proto}|${f.dport}`;
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString();
const fmtDur = (s) => {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const topN = (counter, n) =>
  Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, n);

export default function App() {
  const [home, setHome] = useState(null);
  const [nodes, setNodes] = useState({});
  const [feed, setFeed] = useState([]);
  const [view, setView] = useState("map");
  const [mapDevice, setMapDevice] = useState("all");   // map filter
  const [drill, setDrill] = useState(null);            // device detail

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
        setFeed((prev) => [m, ...prev].slice(0, 100));
      };
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { clearTimeout(retry); ws && ws.close(); };
  }, []);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const deviceNames = useMemo(
    () => [...new Set(nodeList.map((n) => n.device))].sort(), [nodeList]);
  const totalPkts = nodeList.reduce((s, n) => s + n.count, 0);

  return (
    <div className="app">
      <div className="tabs">
        <span className="brand">◉ networktracker</span>
        <Tab label="Map" active={view === "map"} onClick={() => setView("map")} />
        <Tab label="Devices" active={view === "devices"}
             onClick={() => { setView("devices"); setDrill(null); }} />
        <Tab label="Countries" active={view === "countries"} onClick={() => setView("countries")} />
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
          {home ? `home ${home.ip}` : "resolving…"} · {deviceNames.length} dev · {totalPkts} pkts
        </span>
      </div>

      {view === "map" && (
        <div className="content">
          <div className="map-area">
            <DeviceFilter value={mapDevice} options={deviceNames} onChange={setMapDevice} />
            <MapView home={home}
              nodes={mapDevice === "all" ? nodeList : nodeList.filter((n) => n.device === mapDevice)} />
          </div>
          <Sidebar home={home}
            nodes={mapDevice === "all" ? nodeList : nodeList.filter((n) => n.device === mapDevice)} />
          <BottomFeed feed={mapDevice === "all" ? feed : feed.filter((f) => f.device === mapDevice)} />
        </div>
      )}

      {view === "devices" && !drill && (
        <DevicesView nodes={nodeList} onOpen={setDrill} />
      )}
      {view === "devices" && drill && (
        <DeviceDetail home={home} device={drill}
          nodes={nodeList.filter((n) => n.device === drill)}
          feed={feed.filter((f) => f.device === drill)}
          onBack={() => setDrill(null)} />
      )}

      {view === "countries" && <CountriesView nodes={nodeList} />}
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return <div className={`tab ${active ? "active" : ""}`} onClick={onClick}>{label}</div>;
}

function DeviceFilter({ value, options, onChange }) {
  return (
    <div className="map-filter">
      <label>Device </label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All devices</option>
        {options.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

/* group finest nodes by destination IP for map rendering */
function byDest(nodes) {
  const g = {};
  for (const n of nodes) {
    const e = (g[n.dst_ip] ||= { ...n, count: 0 });
    e.count += n.count;
  }
  return Object.values(g);
}

function MapView({ home, nodes }) {
  const dests = byDest(nodes);
  const center = home ? [home.lat, home.lng] : [20, 0];
  return (
    <MapContainer center={center} zoom={3} worldCopyJump style={{ height: "100%" }}>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO" />
      {home && (
        <CircleMarker center={[home.lat, home.lng]} radius={7}
          pathOptions={{ color: "#4ade80", fillColor: "#4ade80", fillOpacity: 1 }}>
          <Tooltip>home · {home.city} {home.country} · {home.ip}</Tooltip>
        </CircleMarker>
      )}
      {home && dests.map((n) => (
        <Polyline key={"l" + n.dst_ip} positions={[[home.lat, home.lng], [n.lat, n.lng]]}
          pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.3 }} />
      ))}
      {dests.map((n) => (
        <CircleMarker key={n.dst_ip} center={[n.lat, n.lng]}
          radius={4 + Math.min(14, Math.log2(n.count + 1) * 3)} className="pulse-node"
          pathOptions={{ color: "#f472b6", fillColor: "#f472b6", fillOpacity: 0.7 }}>
          <Tooltip>
            <b>{n.dst_ip}</b>{n.dst_host ? ` (${n.dst_host})` : ""}<br />
            {n.city} {n.country} · {n.count} pkts
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Sidebar({ home, nodes }) {
  const total = nodes.reduce((s, n) => s + n.count, 0);
  const devices = new Set(nodes.map((n) => n.device)).size;
  const dests = new Set(nodes.map((n) => n.dst_ip)).size;
  const countries = new Set(nodes.map((n) => n.country).filter(Boolean)).size;
  const topDest = useMemo(() => {
    const g = {};
    for (const n of nodes) g[n.dst_ip] = { ip: n.dst_ip, host: n.dst_host, city: n.city,
      count: (g[n.dst_ip]?.count || 0) + n.count };
    return Object.values(g).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [nodes]);

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
          <div className="stat"><div className="v">{dests}</div><div className="l">destinations</div></div>
          <div className="stat"><div className="v">{devices}</div><div className="l">devices</div></div>
          <div className="stat"><div className="v">{countries}</div><div className="l">countries</div></div>
        </div>
      </div>
      <div className="card">
        <h3>Top destinations</h3>
        {topDest.map((d) => (
          <div className="row" key={d.ip}>
            <span className="k">{d.ip} <span style={{ color: "var(--muted)" }}>{d.host || d.city}</span></span>
            <span className="n">{d.count}</span>
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
              <td className="dim">{fmtTime(f.ts)}</td><td>{f.device}</td>
              <td className="dim">{f.src_ip}</td><td>{f.dst_ip}</td>
              <td className="dim">{f.dst_host || "—"}</td><td>{f.city}</td>
              <td>{f.country}</td><td className="dim">{f.proto}:{f.dport}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesView({ nodes, onOpen }) {
  const rows = useMemo(() => {
    const agg = {};
    for (const n of nodes) {
      const a = (agg[n.device] ||= { device: n.device, src_ip: n.src_ip, pkts: 0,
        dests: new Set(), countries: new Set(), firstTs: n.ts, lastTs: 0 });
      a.pkts += n.count; a.dests.add(n.dst_ip);
      if (n.country) a.countries.add(n.country);
      a.firstTs = Math.min(a.firstTs, n.firstTs); a.lastTs = Math.max(a.lastTs, n.lastTs);
    }
    return Object.values(agg).sort((a, b) => b.pkts - a.pkts);
  }, [nodes]);

  return (
    <div className="full card">
      <h3>Devices ({rows.length}) — click a row for detail</h3>
      <table>
        <thead><tr>
          <th>Device</th><th>Local IP</th><th>Packets</th><th>Destinations</th>
          <th>Countries</th><th>Active for</th><th>Last seen</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.device} className="clickable" onClick={() => onOpen(r.device)}>
              <td><b>{r.device}</b></td>
              <td className="dim">{r.src_ip}</td>
              <td className="n">{r.pkts}</td>
              <td>{r.dests.size}</td>
              <td>{r.countries.size}</td>
              <td className="dim">{fmtDur(r.lastTs - r.firstTs)}</td>
              <td className="dim">{fmtTime(r.lastTs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeviceDetail({ home, device, nodes, feed, onBack }) {
  const stats = useMemo(() => {
    const pkts = nodes.reduce((s, n) => s + n.count, 0);
    const proto = {}, port = {}, country = {}, destC = {};
    let first = Infinity, last = 0, src = "";
    for (const n of nodes) {
      proto[n.proto] = (proto[n.proto] || 0) + n.count;
      port[n.dport || "?"] = (port[n.dport || "?"] || 0) + n.count;
      country[n.country || "?"] = (country[n.country || "?"] || 0) + n.count;
      destC[n.dst_ip] = (destC[n.dst_ip] || 0) + n.count;
      first = Math.min(first, n.firstTs); last = Math.max(last, n.lastTs);
      src = n.src_ip;
    }
    const dur = Math.max(1, last - first);
    return {
      pkts, src, dur, first, last,
      dests: Object.keys(destC).length,
      countries: Object.keys(country).filter((c) => c !== "?").length,
      ports: Object.keys(port).filter((p) => p !== "?").length,
      rate: (pkts / dur) * 60,
      topProto: topN(proto, 6), topPort: topN(port, 8),
      topCountry: topN(country, 8), topDest: topN(destC, 12),
    };
  }, [nodes]);

  const destInfo = useMemo(() => {
    const m = {};
    for (const n of nodes) m[n.dst_ip] = { host: n.dst_host, city: n.city, country: n.country };
    return m;
  }, [nodes]);

  return (
    <div className="full">
      <div className="detail-head">
        <button className="back" onClick={onBack}>← Devices</button>
        <h2>{device}</h2>
        <span className="dim">{stats.src}</span>
      </div>

      <div className="kpi-row">
        <Kpi v={stats.pkts} l="packets" />
        <Kpi v={stats.dests} l="destinations" />
        <Kpi v={stats.countries} l="countries" />
        <Kpi v={stats.ports} l="ports" />
        <Kpi v={stats.rate.toFixed(1)} l="pkts/min" />
        <Kpi v={fmtDur(stats.dur)} l="active for" />
      </div>
      <div className="dim" style={{ margin: "0 8px 8px", fontSize: 12 }}>
        first seen {fmtTime(stats.first)} · last seen {fmtTime(stats.last)}
      </div>

      <div className="detail-grid">
        <Bars title="Protocols" data={stats.topProto} />
        <Bars title="Top ports" data={stats.topPort} fmtK={(k) => `:${k}`} />
        <Bars title="Top countries" data={stats.topCountry} />
        <div className="card">
          <h3>Map</h3>
          <div style={{ height: 260, borderRadius: 6, overflow: "hidden" }}>
            <MapView home={home} nodes={nodes} />
          </div>
        </div>
        <div className="card span2">
          <h3>Top destinations</h3>
          <table>
            <thead><tr><th>Dest IP</th><th>Host</th><th>City</th><th>Country</th><th>Packets</th></tr></thead>
            <tbody>
              {stats.topDest.map(([ip, c]) => (
                <tr key={ip}>
                  <td>{ip}</td>
                  <td className="dim">{destInfo[ip]?.host || "—"}</td>
                  <td>{destInfo[ip]?.city}</td>
                  <td>{destInfo[ip]?.country}</td>
                  <td className="n">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card span2">
          <h3>Recent activity</h3>
          <table>
            <thead><tr><th>Time</th><th>Dest IP</th><th>Host</th><th>City</th><th>Proto</th></tr></thead>
            <tbody>
              {feed.slice(0, 25).map((f, i) => (
                <tr key={i}>
                  <td className="dim">{fmtTime(f.ts)}</td><td>{f.dst_ip}</td>
                  <td className="dim">{f.dst_host || "—"}</td><td>{f.city}</td>
                  <td className="dim">{f.proto}:{f.dport}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ v, l }) {
  return <div className="kpi"><div className="v">{v}</div><div className="l">{l}</div></div>;
}

function Bars({ title, data, fmtK = (k) => k }) {
  const max = data[0]?.[1] || 1;
  return (
    <div className="card">
      <h3>{title}</h3>
      {data.map(([k, n]) => (
        <div key={k}>
          <div className="row"><span className="k">{fmtK(k)}</span><span className="n">{n}</span></div>
          <div className="bar" style={{ width: `${(n / max) * 100}%` }} />
        </div>
      ))}
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
        <thead><tr><th>Country</th><th>Packets</th><th>Destinations</th><th>Devices</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country}>
              <td>{r.country}</td><td className="n">{r.pkts}</td>
              <td>{r.dests.size}</td><td>{r.devices.size}</td>
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
