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
  const id = Number(tr.dataset.id);

  const payload = {};
  tr.querySelectorAll("input.cell").forEach((inp) => {
    payload[inp.dataset.field] = inp.value;
  });

  const oldRec = currentRows.find((x) => x.id === id) || {};
  const oldAlias = String(oldRec.alias ?? "");
  const oldVlan = String(oldRec.vlan ?? "").trim();

  const updated = await api(`/api/ports/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  const port = String(updated.port ?? "").trim();
  const newAlias = String(updated.alias ?? "");
  const newVlan = String(updated.vlan ?? "").trim();

  // Alias command
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
  // if DB missing, kick back to login
  alert(e.message);
  clearCurrentIp();
  window.location.replace("/login.html");
});
