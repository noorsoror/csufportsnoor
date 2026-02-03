// =========================
// public/app.js
// - Port is NOT editable (display only).
// - DB alias field is ONLY user alias (never contains Room/DJ).
// - If user clears alias and saves => DB alias becomes "" (blank) and stays blank.
// - Console command format:
//     interface members port X/X/X alias "<Room DJ, Alias>"
//   (If Alias blank, it becomes just "<Room DJ>")
// - VLAN command format (Alcatel):
//     vlan <vlan> members port <port> untagged
// - Non-configured ports (no vlan, dj, alias, room) go into collapsed section.
// =========================

// ---------- IP helpers ----------
function getCurrentIp() {
  return localStorage.getItem("switchIp") || "";
}
function clearCurrentIp() {
  localStorage.removeItem("switchIp");
}
if (!getCurrentIp()) window.location.replace("/login.html");

// ---------- API helper ----------
async function api(path, options) {
  const ip = getCurrentIp();
  const url = new URL(path, window.location.origin);
  url.searchParams.set("ip", ip);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------- Utilities ----------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowStamp() {
  return new Date().toLocaleTimeString();
}

function normalizeRoom(room) {
  const r = String(room ?? "").trim();
  const m = r.match(/^R(\d+)$/i);
  return m ? `R${m[1]}` : r;
}

function normalizeDj(dj) {
  const d = String(dj ?? "").trim();
  const m = d.match(/^D(\d{1,4})$/i);
  // D40 -> D040 (matches your examples)
  return m ? `D${m[1].padStart(3, "0")}` : d;
}

function roomDjOnly(room, dj) {
  const r = normalizeRoom(room);
  const d = normalizeDj(dj);
  if (r && d) return `${r} ${d}`;
  return r || d || "";
}

// Enforce: alias must never contain Room (R####) or DJ token (D###/D####).
// If user types them anyway, strip them out.
function sanitizeAliasInput(aliasRaw) {
  let a = String(aliasRaw ?? "");

  // Remove room tokens like R2403
  a = a.replace(/\bR\d+\b/gi, "");

  // Remove DJ tokens like D040 or D1040
  a = a.replace(/\bD\d{3,4}\b/gi, "");

  // Remove leftover punctuation like leading/trailing commas from "(Room DJ), Alias"
  a = a.replace(/^[\s,]+|[\s,]+$/g, "");

  // Collapse whitespace
  a = a.replace(/\s+/g, " ").trim();

  return a;
}

function isNonConfigured(row) {
  const vlan = String(row.vlan ?? "").trim();
  const dj = String(row.datajack ?? "").trim();
  const alias = String(row.alias ?? "").trim();
  const room = String(row.room ?? "").trim();
  return vlan === "" && dj === "" && alias === "" && room === "";
}

// ---------- Console ----------
function logConsole(line) {
  const out = document.getElementById("consoleOutput");
  out.textContent += `[${nowStamp()}] ${line}\n`;
  out.scrollTop = out.scrollHeight;

  document.querySelector(".consoleCard")?.classList.remove("consoleCollapsed");
  const t = document.getElementById("toggleConsoleBtn");
  if (t) t.textContent = "Collapse";
}

// ---------- Table ----------
function rowTemplate(item) {
  return `
    <tr data-id="${item.id}">
      <td><span class="portText">${escapeHtml(item.port)}</span></td>
      <td><input class="cell" data-field="vlan" value="${escapeHtml(item.vlan)}"></td>
      <td><input class="cell" data-field="datajack" value="${escapeHtml(item.datajack)}"></td>
      <td><input class="cell" data-field="alias" value="${escapeHtml(item.alias)}"></td>
      <td><input class="cell" data-field="room" value="${escapeHtml(item.room)}"></td>
      <td class="actions">
        <button class="saveBtn" type="button">Save</button>
      </td>
    </tr>
  `;
}


let currentRows = [];

async function loadTable() {
  const data = await api("/api/ports"); // { ip, rows }
  currentRows = data.rows;

  const badge = document.getElementById("currentIpBadge");
  if (badge) badge.textContent = `IP: ${data.ip}`;

  const configured = currentRows.filter((r) => !isNonConfigured(r));
  const unconfigured = currentRows.filter((r) => isNonConfigured(r));

  document.getElementById("tbodyConfigured").innerHTML = configured.map(rowTemplate).join("");
  document.getElementById("tbodyUnconfigured").innerHTML = unconfigured.map(rowTemplate).join("");

  const details = document.getElementById("unconfiguredDetails");
  if (details) {
    details.style.display = unconfigured.length ? "" : "none";
    details.open = false; // collapsed by default
  }
}

// ---------- Buttons ----------
document.getElementById("refreshBtn")?.addEventListener("click", () => {
  loadTable().catch((e) => alert(e.message));
});

document.getElementById("changeSwitchBtn")?.addEventListener("click", () => {
  clearCurrentIp();
  window.location.href = "/login.html";
});

// Console controls
const consoleCard = document.querySelector(".consoleCard");

document.getElementById("toggleConsoleBtn")?.addEventListener("click", () => {
  const collapsed = consoleCard.classList.toggle("consoleCollapsed");
  document.getElementById("toggleConsoleBtn").textContent = collapsed ? "Expand" : "Collapse";
});

document.getElementById("clearConsoleBtn")?.addEventListener("click", () => {
  document.getElementById("consoleOutput").textContent = "";
});

// ---------- Save handler (works for BOTH configured & unconfigured tables) ----------
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("saveBtn")) return;

  const tr = e.target.closest("tr");
  if (!tr) return;

  const id = Number(tr.dataset.id);

  // Build payload from inputs (port is not included; also hard-delete if somehow present)
  const payload = {};
  tr.querySelectorAll("input.cell").forEach((inp) => {
    payload[inp.dataset.field] = inp.value;
  });
  delete payload.port;

  // Old record
  const oldRec = currentRows.find((x) => x.id === id) || {};
  const oldAlias = String(oldRec.alias ?? "").trim(); // user alias only
  const oldVlan = String(oldRec.vlan ?? "").trim();
  const oldRoom = normalizeRoom(oldRec.room ?? "");
  const oldDj = normalizeDj(oldRec.datajack ?? "");

  // Normalize room/dj
  const newRoom = normalizeRoom(payload.room ?? oldRec.room ?? "");
  const newDj = normalizeDj(payload.datajack ?? oldRec.datajack ?? "");
  payload.room = newRoom;
  payload.datajack = newDj;

  const roomChanged = oldRoom !== newRoom;
  const djChanged = oldDj !== newDj;

  // Alias rules:
  // - If user clears alias (empty), we MUST send alias:"" to overwrite DB
  // - If user types alias, sanitize it so it never contains Room/DJ
  const aliasRaw = String(payload.alias ?? "");
  const aliasCleared = aliasRaw.trim() === "";

  if (aliasCleared) {
    payload.alias = ""; // overwrite DB alias to blank
  } else {
    payload.alias = sanitizeAliasInput(aliasRaw);
  }

  // Update the visible alias input to match what will be saved
  const aliasInputEl = tr.querySelector('input.cell[data-field="alias"]');
  if (aliasInputEl) aliasInputEl.value = payload.alias;

  // Update backend
  let updated;
  try {
    updated = await api(`/api/ports/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    alert(err.message);
    return;
  }

  const port = String(updated.port ?? "").trim();
  const newVlan = String(updated.vlan ?? "").trim();

  // Stored alias is user alias only
  const storedAlias = String(updated.alias ?? "").trim();

  // Build console alias display:
  // "<Room DJ, Alias>" but alias is optional and should never contain Room/DJ
  const rdj = roomDjOnly(newRoom, newDj).trim();

  let displayAlias = rdj;
  if (storedAlias) {
    displayAlias = displayAlias ? `${displayAlias}, ${storedAlias}` : storedAlias;
  }
  displayAlias = displayAlias.trim();

  // Log alias command when:
  // - alias cleared (required)
  // - or room/dj changed
  // - or alias changed
  const storedAliasChanged = storedAlias !== oldAlias;
  if (aliasCleared || roomChanged || djChanged || storedAliasChanged) {
    logConsole(`interface members port ${port} alias "${displayAlias}"`);
  }

  // VLAN command (Alcatel)
  if (oldVlan !== newVlan && newVlan !== "") {
    logConsole(`vlan ${newVlan} members port ${port} untagged`);
  }

  await loadTable();
});

// ---------- Boot ----------
loadTable().catch((e) => {
  alert(e.message);
  clearCurrentIp();
  window.location.replace("/login.html");
});
