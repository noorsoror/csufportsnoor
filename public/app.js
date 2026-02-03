// =========================
// public/app.js (updated)
// - preserves alias if input left blank
// - logs alias in format:
//     interface members port X/Y/Z alias "(Room DJ), Alias"
//   (omits parts that are missing)
// - still auto-replaces R#### / D### tokens in alias when present
// =========================

// ---------- IP helpers ----------
function getCurrentIp() {
  return localStorage.getItem("switchIp") || "";
}
function clearCurrentIp() {
  localStorage.removeItem("switchIp");
}
// redirect to login if no IP
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
  const m = r.match(/^R(\d+)$/i);
  return m ? `R${m[1]}` : r;
}
function normalizeDj(dj) {
  const d = String(dj ?? "").trim();
  const m = d.match(/^D(\d{1,4})$/i);
  return m ? `D${m[1].padStart(3, "0")}` : d; // pads to 3 digits (D040)
}

/**
 * Replace R#### and D### tokens inside alias if they exist.
 * If alias contains R\d+, replace the first occurrence with newRoom (if newRoom is R\d+).
 * If alias contains D\d{3,4}, replace first occurrence with newDj (if newDj is D###).
 */
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
  alias = alias.replace(/\s+/g, " ").trim();
  return alias;
}

// ---------- Console logging ----------
function logConsole(line) {
  const out = document.getElementById("consoleOutput");
  out.textContent += `[${nowStamp()}] ${line}\n`;
  out.scrollTop = out.scrollHeight;
  document.querySelector(".consoleCard")?.classList.remove("consoleCollapsed");
  const t = document.getElementById("toggleConsoleBtn");
  if (t) t.textContent = "Collapse";
}

// ---------- Table template ----------
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
  const data = await api("/api/ports"); // returns { ip, rows }
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
const consoleCard = document.querySelector(".consoleCard");
document.getElementById("toggleConsoleBtn").addEventListener("click", () => {
  const collapsed = consoleCard.classList.toggle("consoleCollapsed");
  document.getElementById("toggleConsoleBtn").textContent = collapsed ? "Expand" : "Collapse";
});
document.getElementById("clearConsoleBtn").addEventListener("click", () => {
  document.getElementById("consoleOutput").textContent = "";
});

// ---------- Save handler ----------
document.getElementById("tbody").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("saveBtn")) return;
  const tr = e.target.closest("tr");
  if (!tr) return;
  const id = Number(tr.dataset.id);

  // Build payload from inputs
  const payload = {};
  tr.querySelectorAll("input.cell").forEach((inp) => {
    payload[inp.dataset.field] = inp.value;
  });

  // Normalize new room/dj early
  const newRoomRaw = payload.room ?? "";
  const newDjRaw = payload.datajack ?? "";

  const newRoom = normalizeRoom(newRoomRaw);
  const newDj = normalizeDj(newDjRaw);

  // Keep normalized values in payload (so saved file uses standard format)
  payload.room = newRoom;
  payload.datajack = newDj;

  // If user left alias input BLANK, do NOT send alias in payload (preserve existing)
  // This avoids accidentally clearing alias when the input is empty.
  if ("alias" in payload) {
    const trimmed = String(payload.alias ?? "").trim();
    if (trimmed === "") {
      delete payload.alias; // preserve stored alias
    } else {
      payload.alias = String(payload.alias).trim();
    }
  }

  // Old record for diffs
  const oldRec = currentRows.find((x) => x.id === id) || {};
  const oldAlias = String(oldRec.alias ?? "");
  const oldVlan = String(oldRec.vlan ?? "").trim();
  const oldRoom = normalizeRoom(oldRec.room ?? "");
  const oldDj = normalizeDj(oldRec.datajack ?? "");

  const roomChanged = oldRoom !== newRoom;
  const djChanged = oldDj !== newDj;

  // Auto-replace tokens in alias if alias already has tokens
  // Use stored alias (oldAlias) as base only if payload.alias wasn't explicitly provided
  let baseAliasForAuto = oldAlias;
  if ("alias" in payload) {
    baseAliasForAuto = payload.alias; // user typed something, respect it
  }

  const newAliasAuto = autoAliasFromRoomAndDj(baseAliasForAuto, newRoom, newDj);

  // If auto-replacement changed alias, set payload.alias (thus updating stored alias)
  if (newAliasAuto !== baseAliasForAuto) {
    payload.alias = newAliasAuto;
    // update visible input immediately so user sees it
    const aliasInput = tr.querySelector('input.cell[data-field="alias"]');
    if (aliasInput) aliasInput.value = newAliasAuto;
  }

  // If user didn't type an alias and auto didn't change alias, we will preserve stored alias by not including alias key.
  // (We already deleted alias above if the user left it blank.)

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

  // After save, build the console display alias in the requested format:
  // "(Room DJ), Alias"  where Alias is the stored alias (if any)
  const storedAlias = String(updated.alias ?? "").trim();
  const roomPart = newRoom || "";
  const djPart = newDj || "";
  let roomDjPart = "";
  if (roomPart && djPart) roomDjPart = `${roomPart} ${djPart}`;
  else if (roomPart) roomDjPart = roomPart;
  else if (djPart) roomDjPart = djPart;

  let displayAlias = roomDjPart;
  if (storedAlias) {
    displayAlias = displayAlias ? `${displayAlias}, ${storedAlias}` : storedAlias;
  }
  displayAlias = displayAlias.trim();

  const port = String(updated.port ?? "").trim();
  const newVlan = String(updated.vlan ?? "").trim();

  // Determine whether to log alias command:
  // log if room or dj changed OR stored alias changed compared to oldAlias
  const storedAliasChanged = storedAlias !== oldAlias;
  if (roomChanged || djChanged || storedAliasChanged) {
    // Use exact phrase requested: "interface members port ..."
    if (displayAlias) {
      logConsole(`interface members port ${port} alias "${displayAlias}"`);
    } else {
      // If no display alias (unlikely), still log a simple alias change
      logConsole(`interface members port ${port} alias "${storedAlias}"`);
    }
  }

  // VLAN command (Alcatel) using previous behavior
  if (oldVlan !== newVlan && newVlan !== "") {
    logConsole(`vlan ${newVlan} members port ${port} untagged`);
  }

  // Refresh table
  await loadTable();
});

// ---------- Boot ----------
loadTable().catch((e) => {
  alert(e.message);
  clearCurrentIp();
  window.location.replace("/login.html");
});
