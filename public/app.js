// =========================
// Switch Editor - public/app.js
// Two-page flow:
//   - /login.html sets localStorage.switchIp
//   - / (index.html) loads editor; redirects to /login.html if no IP
// Features:
//   - Save writes updates to backend
//   - Console (collapsible) logs:
//       * alias change: interface port <port> alias "<alias>"
//       * vlan change (Alcatel): vlan <vlan> members port <port> untagged
//   - If ROOM changes and alias contains an R#### token, alias auto-updates to match new room
//   - If DJ changes and alias contains a D###(or D####) token, alias auto-updates to match new DJ
// =========================

// ---------- IP helpers ----------
function getCurrentIp() {
  return localStorage.getItem("switchIp") || "";
}

function clearCurrentIp() {
  localStorage.removeItem("switchIp");
}

// If no IP, force user to login page
const currentIp = getCurrentIp();
if (!currentIp) {
  window.location.replace("/login.html");
}

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
  // Accept R#### (digits), keep exact digits, force leading "R"
  const m = r.match(/^R(\d+)$/i);
  return m ? `R${m[1]}` : r;
}

function normalizeDj(dj) {
  const d = String(dj ?? "").trim();
  // Accept D### or D####, force leading "D" and preserve digits, pad not enforced
  const m = d.match(/^D(\d{1,4})$/i);
  return m ? `D${m[1].padStart(3, "0")}` : d; // pad to 3 (D040), if you want 4, change to 4
}

/**
 * Update alias tokens based on new room / dj.
 * Only updates tokens that already exist in alias:
 * - If alias has R#### and room provided -> replace that R#### with room
 * - If alias has D###/D#### and dj provided -> replace that D token with dj
 */
function autoAliasFromRoomAndDj(oldAlias, newRoom, newDj) {
  let alias = String(oldAlias ?? "");

  const room = normalizeRoom(newRoom);
  const dj = normalizeDj(newDj);

  // Replace room token if present in alias and newRoom matches R#### style
  if (/R\d+/i.test(alias) && /^R\d+$/i.test(room)) {
    alias = alias.replace(/R\d+/i, room);
  }

  // Replace DJ token if present in alias and newDj matches D###/D#### style
  // Allow D### or D#### in alias
  if (/D\d{3,4}/i.test(alias) && /^D\d{3,4}$/i.test(dj)) {
    alias = alias.replace(/D\d{3,4}/i, dj);
  }

  // Collapse multiple spaces
  alias = alias.replace(/\s+/g, " ").trim();

  return alias;
}

// ---------- Console logging (collapsible) ----------
function logConsole(line) {
  const out = document.getElementById("consoleOutput");
  out.textContent += `[${nowStamp()}] ${line}\n`;
  out.scrollTop = out.scrollHeight;

  // auto-expand
  document.querySelector(".consoleCard")?.classList.remove("consoleCollapsed");
  const t = document.getElementById("toggleConsoleBtn");
  if (t) t.textContent = "Collapse";
}

// ---------- Table ----------
function rowTemplate(item) {
  return `
    <tr data-id="${item.id}">
      <td>${item.id}</td>
      <td><input class="cell" data-field="port" value="${escapeHtml(item.port)}"></td>
      <td><input class="cell" data-field="vlan" value="${escapeHtml(item.vlan)}"></td>
      <td><input class="cell" data-field="datajack" value="${escapeHtml(item.datajack)}"></td>
      <td><input class="cell" data-field="alias" value="${escapeHtml(item.alias)}"></td>
      <td><input class="cell" data-field="room" value="${escapeHtml(item.room)}"></td>
      <td class="actions"><button class="saveBtn" type="button">Save</button></td>
    </tr>
  `;
}

let currentRows = [];

async function loadTable() {
  const data = await api("/api/ports"); // { ip, rows }
  currentRows = data.rows;

  const badge = document.getElementById("currentIpBadge");
  if (badge) badge.textContent = `IP: ${data.ip}`;

  document.getElementById("tbody").innerHTML = currentRows.map(rowTemplate).join("");
}

// ---------- Buttons ----------
document.getElementById("refreshBtn").addEventListener("click", () => {
  loadTable().catch((e) => alert(e.message));
});

document.getElementById("changeSwitchBtn").addEventListener("click", () => {
  clearCurrentIp();
  window.location.href = "/login.html";
});

// Console controls
const consoleCard = document.querySelector(".consoleCard");

document.getElementById("toggleConsoleBtn").addEventListener("click", () => {
  const collapsed = consoleCard.classList.toggle("consoleCollapsed");
  document.getElementById("toggleConsoleBtn").textContent = collapsed ? "Expand" : "Collapse";
});

document.getElementById("clearConsoleBtn").addEventListener("click", () => {
  document.getElementById("consoleOutput").textContent = "";
});

// Save handler
document.getElementById("tbody").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("saveBtn")) return;

  const tr = e.target.closest("tr");
  if (!tr) return;

  const id = Number(tr.dataset.id);

  // build payload from the row inputs
  const payload = {};
  tr.querySelectorAll("input.cell").forEach((inp) => {
    payload[inp.dataset.field] = inp.value;
  });

  // old record for diffing + auto update
  const oldRec = currentRows.find((x) => x.id === id) || {};
  const oldAlias = String(oldRec.alias ?? "");
  const oldVlan = String(oldRec.vlan ?? "").trim();

  const oldRoom = normalizeRoom(oldRec.room ?? "");
  const oldDj = normalizeDj(oldRec.datajack ?? "");

  const newRoom = normalizeRoom(payload.room ?? "");
  const newDj = normalizeDj(payload.datajack ?? "");

  // Keep payload normalized too
  payload.room = newRoom;
  payload.datajack = newDj;

  // --- AUTO-UPDATE ALIAS IF ROOM/DJ CHANGED AND ALIAS CONTAINS TOKENS ---
  const roomChanged = oldRoom !== newRoom;
  const djChanged = oldDj !== newDj;

  if (roomChanged || djChanged) {
    const newAliasAuto = autoAliasFromRoomAndDj(oldAlias, newRoom, newDj);

    if (newAliasAuto !== oldAlias) {
      payload.alias = newAliasAuto;

      // update visible alias input immediately so user sees it
      const aliasInput = tr.querySelector('input.cell[data-field="alias"]');
      if (aliasInput) aliasInput.value = newAliasAuto;
    }
  }

  // update backend
  const updated = await api(`/api/ports/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  const port = String(updated.port ?? "").trim();
  const newAlias = String(updated.alias ?? "");
  const newVlan = String(updated.vlan ?? "").trim();

  // Alias command (logs room/dj-driven alias changes too)
  if (oldAlias !== newAlias) {
    logConsole(`interface port ${port} alias "${newAlias}"`);
  }

  // VLAN command (Alcatel)
  if (oldVlan !== newVlan && newVlan !== "") {
    logConsole(`vlan ${newVlan} members port ${port} untagged`);
  }

  await loadTable();
});

// Boot
loadTable().catch((e) => {
  alert(e.message);
  clearCurrentIp();
  window.location.replace("/login.html");
});
