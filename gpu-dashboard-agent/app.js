// gpu-dashboard-agent — static dashboard, reads from a GitHub Gist.
// No backend. Gist ID + optional PAT held in localStorage + URL hash.

const LS_GIST = "gdba.gist_id";
const LS_TOKEN = "gdba.github_token";
const LS_INTERVAL = "gdba.interval";
const LS_STALE = "gdba.stale_threshold";
const GIST_FILE = "metrics.json";

const el = (id) => document.getElementById(id);
const gistInput = el("gist-id");
const tokenInput = el("github-token");
const intervalInput = el("interval");
const staleInput = el("stale-threshold");
const connectBtn = el("connect-btn");
const disconnectBtn = el("disconnect-btn");
const statusEl = el("status");
const emptyEl = el("empty");
const cardsEl = el("cards");
const hiddenNoteEl = el("hidden-note");

let timer = null;
let lastFetchAt = 0;

// ── init ──────────────────────────────────────────────────────────────────────

(function init() {
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const urlGist = params.get("gist") || hashParams.get("gist");

  const savedGist = localStorage.getItem(LS_GIST) || "";
  const savedToken = localStorage.getItem(LS_TOKEN) || "";
  const savedInterval = localStorage.getItem(LS_INTERVAL) || "30";
  const savedStale = localStorage.getItem(LS_STALE) || "600";

  gistInput.value = urlGist || savedGist;
  tokenInput.value = savedToken;
  intervalInput.value = savedInterval;
  staleInput.value = savedStale;

  connectBtn.addEventListener("click", connect);
  disconnectBtn.addEventListener("click", disconnect);
  intervalInput.addEventListener("change", () => {
    localStorage.setItem(LS_INTERVAL, intervalInput.value);
    if (timer) restart();
  });
  staleInput.addEventListener("change", () => {
    localStorage.setItem(LS_STALE, staleInput.value);
    fetchAndRender();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimer();
    else if (gistInput.value && !timer) startTimer();
  });

  if (gistInput.value) connect();
})();

// ── connect / disconnect ──────────────────────────────────────────────────────

function connect() {
  const gist = normalizeGistId(gistInput.value);
  if (!gist) {
    setStatus("Enter a Gist ID.", "err");
    return;
  }
  gistInput.value = gist;
  localStorage.setItem(LS_GIST, gist);
  localStorage.setItem(LS_TOKEN, tokenInput.value.trim());
  connectBtn.hidden = true;
  disconnectBtn.hidden = false;
  emptyEl.hidden = true;
  fetchAndRender();
  startTimer();
}

function disconnect() {
  stopTimer();
  connectBtn.hidden = false;
  disconnectBtn.hidden = true;
  cardsEl.innerHTML = "";
  emptyEl.hidden = false;
  setStatus("disconnected");
}

function startTimer() {
  stopTimer();
  const sec = Math.max(10, parseInt(intervalInput.value || "30", 10));
  timer = setInterval(fetchAndRender, sec * 1000);
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function restart() { startTimer(); fetchAndRender(); }

// ── fetch ─────────────────────────────────────────────────────────────────────

function normalizeGistId(raw) {
  let s = (raw || "").trim().replace(/\/+$/, "");
  if (s.includes("/")) s = s.split("/").pop();
  return s.split("#")[0].split("?")[0];
}

async function fetchAndRender() {
  const gist = normalizeGistId(gistInput.value);
  if (!gist) return;
  const token = tokenInput.value.trim();

  const headers = { "Accept": "application/vnd.github+json" };
  if (token) headers["Authorization"] = `token ${token}`;

  try {
    const resp = await fetch(`https://api.github.com/gists/${gist}`, { headers });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const gistData = await resp.json();
    const file = gistData.files[GIST_FILE] || Object.values(gistData.files)[0];
    if (!file) throw new Error(`Gist has no ${GIST_FILE} file`);
    let raw = file.content;
    if (file.truncated && file.raw_url) {
      raw = await (await fetch(file.raw_url)).text();
    }
    const data = JSON.parse(raw);
    render(data);
    const rl = resp.headers.get("x-ratelimit-remaining");
    lastFetchAt = Date.now();
    setStatus(
      `last fetch ${new Date().toLocaleTimeString()}` +
      (rl !== null ? ` · rate-limit remaining: ${rl}` : ""),
      "ok"
    );
  } catch (e) {
    setStatus(`fetch failed: ${e.message}`, "err");
  }
}

// ── render ────────────────────────────────────────────────────────────────────

function render(data) {
  const workstations = data.workstations || {};
  const names = Object.keys(workstations).sort();
  const threshold = Math.max(0, parseInt(staleInput.value || "0", 10));

  cardsEl.innerHTML = "";
  const hidden = [];
  for (const name of names) {
    const w = workstations[name];
    const ageSec = w.updated_at ? (Date.now() - new Date(w.updated_at).getTime()) / 1000 : Infinity;
    if (threshold > 0 && ageSec > threshold) {
      hidden.push({ name, ageSec });
      continue;
    }
    cardsEl.appendChild(renderCard(name, w));
  }

  if (hidden.length) {
    hiddenNoteEl.hidden = false;
    hiddenNoteEl.innerHTML =
      `<b>${hidden.length}</b> workstation${hidden.length === 1 ? "" : "s"} hidden ` +
      `(no update in the last ${threshold}s):` +
      `<ul>${hidden.map(h => `<li>${escapeHtml(h.name)} — ${formatAge(h.ageSec)} ago</li>`).join("")}</ul>`;
  } else {
    hiddenNoteEl.hidden = true;
    hiddenNoteEl.innerHTML = "";
  }

  if (names.length === 0) {
    setStatus("Gist loaded but no workstations reported yet.", "");
  }
}

function formatAge(sec) {
  if (!isFinite(sec)) return "never";
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

function renderCard(name, w) {
  const card = document.createElement("section");
  card.className = "card";

  const fresh = freshness(w.updated_at);
  card.innerHTML = `
    <div class="card-head">
      <div class="host">${escapeHtml(name)}</div>
      <div class="freshness">
        <span class="dot ${fresh.cls}"></span>
        <span>${fresh.label}</span>
      </div>
    </div>
    <div class="meta">
      <div><span class="label">CPU</span><span class="val">${num(w.cpu_percent)}%</span>
        <div class="bar"><div class="fill ${barClass(w.cpu_percent)}" style="width:${clamp(w.cpu_percent)}%"></div></div>
      </div>
      <div><span class="label">MEM</span><span class="val">${mb(w.mem_used_mb)} / ${mb(w.mem_total_mb)}</span>
        <div class="bar"><div class="fill ${barClass(memPct(w))}" style="width:${memPct(w)}%"></div></div>
      </div>
      <div><span class="label">UPTIME</span><span class="val">${uptime(w.uptime_seconds)}</span>
        <div class="muted" style="font-size:10.5px">${num(w.load_1m)} load · ${w.nproc || 0} cpus</div>
      </div>
    </div>
    <div class="gpus">${(w.gpus || []).map(renderGpu).join("")}</div>
    ${renderProcs(w.processes || [])}
  `;
  return card;
}

function renderGpu(g) {
  const util = clamp(g.utilization);
  const memPct = g.memory_total ? Math.round((g.memory_used / g.memory_total) * 100) : 0;
  return `
    <div class="gpu-row">
      <div>
        <div class="gpu-index">#${g.index}</div>
        <div class="gpu-name">${escapeHtml(shortGpuName(g.name))}</div>
      </div>
      <div class="gpu-bars">
        <div class="gpu-bar-row">
          <span class="k">util</span>
          <div class="bar"><div class="fill ${barClass(util)}" style="width:${util}%"></div></div>
          <span class="v">${Math.round(util)}%</span>
        </div>
        <div class="gpu-bar-row">
          <span class="k">vram</span>
          <div class="bar"><div class="fill ${barClass(memPct)}" style="width:${memPct}%"></div></div>
          <span class="v">${mb(g.memory_used)}/${mb(g.memory_total)}</span>
        </div>
      </div>
      <div class="gpu-thermo">
        <div>${Math.round(g.temperature || 0)}°C</div>
        <div class="v">${Math.round(g.power_draw || 0)} W</div>
      </div>
    </div>
  `;
}

function renderProcs(procs) {
  if (!procs.length) return "";
  const rows = procs.map(p => `
    <tr>
      <td>${escapeHtml(p.user || "")}</td>
      <td>${escapeHtml(p.pid || "")}</td>
      <td>${mb(p.memory_mib || 0)}</td>
      <td>${escapeHtml(p.runtime || "")}</td>
      <td class="cmd" title="${escapeHtml(p.command || "")}">${escapeHtml(p.command || "")}</td>
    </tr>
  `).join("");
  return `
    <details class="procs">
      <summary>processes (${procs.length})</summary>
      <table class="proc-table">
        <thead><tr><th>user</th><th>pid</th><th>vram</th><th>runtime</th><th>command</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function freshness(ts) {
  if (!ts) return { cls: "err", label: "no data" };
  const age = (Date.now() - new Date(ts).getTime()) / 1000;
  if (age < 90) return { cls: "ok", label: `${Math.round(age)}s ago` };
  if (age < 300) return { cls: "warn", label: `${Math.round(age)}s ago` };
  const mins = Math.round(age / 60);
  return { cls: "err", label: `${mins}m ago` };
}

function uptime(s) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function mb(v) {
  const n = Number(v) || 0;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}G`;
  return `${Math.round(n)}M`;
}

function num(v) {
  const n = Number(v) || 0;
  return Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n).toString();
}

function memPct(w) {
  return w.mem_total_mb ? Math.round((w.mem_used_mb / w.mem_total_mb) * 100) : 0;
}

function clamp(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

function barClass(v) {
  const n = Number(v) || 0;
  if (n >= 90) return "err";
  if (n >= 70) return "warn";
  return "";
}

function shortGpuName(n) {
  return (n || "").replace(/NVIDIA\s+/i, "").replace(/GeForce\s+/i, "");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(msg, cls = "") {
  statusEl.textContent = msg;
  statusEl.className = `status ${cls}`;
}
