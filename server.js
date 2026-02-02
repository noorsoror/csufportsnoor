const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function safeIpToFilename(ip) {
  // allow only digits, dots, colons, hyphen (ipv4/ipv6-ish). Adjust if you want.
  const clean = String(ip || "").trim();
  if (!clean) return null;
  if (!/^[0-9a-fA-F\.\:\-]+$/.test(clean)) return null;
  return clean;
}

function dbPathForIp(ip) {
  const safe = safeIpToFilename(ip);
  if (!safe) return null;
  return path.join(__dirname, "data", "switches", `${safe}.json`);
}

function isHeaderOrJunk(row) {
  const f1 = String(row?.FIELD1 ?? "").trim().toLowerCase();
  const vlan = String(row?.["Switch 1"] ?? "").trim();

  if (f1 === "port") return true;

  const isJustOne =
    String(row?.FIELD1 ?? "").trim() === "1" &&
    !vlan &&
    !String(row?.FIELD3 ?? "").trim() &&
    !String(row?.FIELD4 ?? "").trim() &&
    !String(row?.FIELD5 ?? "").trim();

  const allBlank =
    !String(row?.FIELD1 ?? "").trim() &&
    !vlan &&
    !String(row?.FIELD3 ?? "").trim() &&
    !String(row?.FIELD4 ?? "").trim() &&
    !String(row?.FIELD5 ?? "").trim();

  return isJustOne || allBlank;
}

function normalizeRow(row, index) {
  return {
    id: index, // original array index (so we can write back)
    port: String(row.FIELD1 ?? "").trim(),
    vlan: String(row["Switch 1"] ?? "").trim(),
    datajack: String(row.FIELD3 ?? "").trim(),
    alias: String(row.FIELD4 ?? "").trim(),
    room: String(row.FIELD5 ?? "").trim(),
  };
}

async function readDb(ip) {
  const p = dbPathForIp(ip);
  if (!p) throw new Error("Missing or invalid ip");
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw);
}

async function writeDb(ip, arr) {
  const p = dbPathForIp(ip);
  if (!p) throw new Error("Missing or invalid ip");
  await fs.writeFile(p, JSON.stringify(arr, null, 2), "utf-8");
}

// GET normalized rows for a switch ip
app.get("/api/ports", async (req, res) => {
  try {
    const ip = req.query.ip;
    const raw = await readDb(ip);

    const rows = raw
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => !isHeaderOrJunk(row))
      .map(({ row, idx }) => normalizeRow(row, idx));

    res.json({ ip: String(ip), rows });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// UPDATE a row for a switch ip
app.put("/api/ports/:id", async (req, res) => {
  try {
    const ip = req.query.ip;
    const id = Number(req.params.id);
    const update = req.body ?? {};

    const raw = await readDb(ip);

    if (!Array.isArray(raw) || id < 0 || id >= raw.length) {
      return res.status(404).json({ error: "Row not found" });
    }

    const row = raw[id];
    if (!row || isHeaderOrJunk(row)) {
      return res.status(400).json({ error: "Cannot edit header/junk row" });
    }

    if ("port" in update) row.FIELD1 = String(update.port).trim();
    if ("vlan" in update) row["Switch 1"] = String(update.vlan).trim();
    if ("datajack" in update) row.FIELD3 = String(update.datajack).trim();
    if ("alias" in update) row.FIELD4 = String(update.alias).trim();
    if ("room" in update) row.FIELD5 = String(update.room).trim();

    raw[id] = row;
    await writeDb(ip, raw);

    res.json(normalizeRow(row, id));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
