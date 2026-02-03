// =========================
// public/app.js
// - If alias is CLEARED and saved => stored alias becomes "<ROOM> <DJ>" (or "" if both blank)
// - Console alias format: interface members port X/X/X alias "<Room DJ, Alias>"
// - VLAN Alcatel: vlan <vlan> members port <port> untagged
// - Non-configured ports moved to collapsed section
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
  return m ? `D${m[1].padStart(3, "0")}` : d; // D40 -> D040
}

function roomDjOnly(room, dj) {
  const r = normalizeRoom(room);
  const d = normalizeDj(dj);
  if (r && d) return `${r} ${d}`;
  return r || d || "";
}

function autoAliasFromRoomAndDj(oldAlias, newRoom, newDj) {
  let alias = String(oldAlias ?? "");
  const room = normalizeRoom(newRoom);
  const dj = normalizeDj(newDj);

  if (/R\d+/i.test(alias) && /^R\d+$/i.test(room)) {
    alias = alias.replace(/R\d+/i, room);
  }
  if (/D\d{3,4}/i.test(alias) && /^D\d{3,4}$/i.test(dj)) {
    alias = alias.replace(/D\d{3,4}/i, dj);
  }
  return alias.replace(/\s+/g, " ").trim();
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

  const configured = currentRows.filter((r) => !isNonConfigured(r));
  const unconfigured = currentRows.filter((r) => isNonConfigured(r));

  document.getElementById("tbodyConfigured").innerHTML = configured.map(rowTemplate).join("");
  document.getElementById("tbodyUnconfigured").innerHTML = unconfigured.map(rowTemplate).join("");

  // If there are zero unconfigured, hide the details
  const details = document.getElementById("unconfiguredDetails");
  if (details) {
    details.style.display = unconfigured.length ? "" : "none";
    // keep collapsed by default
    details.open = false;
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

// ---------- Save handler (works for BOTH tables) ----------
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("saveBtn")) return;

  const tr = e.target.closest("tr");
  if (!tr) return;

  const id = Number(tr.dataset.id);

  // Build payload
  const payload = {};
  tr.querySelectorAll("input.cell").forEach((inp) => {
    payload[inp.dataset.field] = inp.value;
  });

  // Normalize room/dj
  const newRoom = normalizeRoom(payload.room ?? "");
  const newDj = normalizeDj(payload.datajack ?? "");
  payload.room = newRoom;
  payload.datajack = newDj;

  // Old record
  const oldRec = currentRows.find((x) => x.id === id) || {};
  const oldAlias = String(oldRec.alias ?? "");
  const oldVlan = String(oldRec.vlan ?? "").trim();
  const oldRoom = normalizeRoom(oldRec.room ?? "");
  const oldDj = normalizeDj(oldRec.datajack ?? "");

  const roomChanged = oldRoom !== newRoom;
  const djChanged = oldDj !== newDj;

  // Detect explicit alias clear
  const aliasInputRaw = "alias" in payload ? String(payload.alias ?? "") : "";
  const aliasCleared = aliasInputRaw.trim() === "";

  // If alias cleared: FORCE alias to "<ROOM> <DJ>" (or "" if both blank)
  // This prevents “old alias coming back”
  if (aliasCleared) {
    const forced = roomDjOnly(newRoom, newDj); // may be ""
    payload.alias = forced;

    // update visible input
    const aliasInput = tr.querySelector('input.cell[data-field="alias"]');
    if (aliasInput) aliasInput.value = forced;
  } else {
    // user typed something (non-empty)
    payload.alias = aliasInputRaw.trim();
  }

  // If room/dj changed AND user did NOT clear alias, update tokens in alias when present
  // (when they clear alias, we want ONLY Room+DJ, no token logic)
  if (!aliasCleared && (roomChanged || djChanged)) {
    const base = payload.alias || oldAlias;
    const auto = autoAliasFromRoomAndDj(base, newRoom, newDj);
    if (auto !== base) {
      payload.alias = auto;
      const aliasInput = tr.querySelector('input.cell[data-field="alias"]');
      if (aliasInput) aliasInput.value = auto;
    }
  }

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
  const storedAlias = String(updated.alias ?? "").trim();

  // Build console alias string: "<Room DJ, Alias>" (no duplicates)
  const rdj = roomDjOnly(newRoom, newDj).trim();
  let displayAlias = rdj;

  if (storedAlias && storedAlias !== rdj) {
    displayAlias = displayAlias ? `${displayAlias}, ${storedAlias}` : storedAlias;
  }

  // Alias console log: log when:
  // - alias was cleared (always)
  // - or room/dj changed
  // - or alias changed
  const storedAliasChanged = storedAlias !== oldAlias.trim();
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
