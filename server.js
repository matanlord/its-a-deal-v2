const ADMIN_PASSWORD = "812003"; 
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

// משרת את קבצי הפרונט מהתיקייה public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ===== ADMIN LOGIN (simple password check) =====
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false, error: "wrong password" });
});

// החזרת מצב מלא רק לאדמין
app.get("/api/admin/state", (req, res) => {
  const pass = req.query.password;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json(stateSnapshot());
});


// ===== מודל נתונים חדש =====
// usersById: { [id]: { id, name, joinedAt, lastSeenAt } }
// trades:   { id, fromId, toId, give, take, status, createdAt, decidedAt }
const usersById = {};
const trades = [];

function now() {
  return Date.now();
}

function makeId(prefix) {
  return prefix + "_" + now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stateSnapshot() {
  return {
    users: Object.values(usersById),
    trades
  };
}

function broadcastState() {
  io.emit("state:update", stateSnapshot());
}

// ===== REST API =====

// יצירת / הצטרפות משתמש
app.post("/api/join", (req, res) => {
  const rawName = (req.body && req.body.name) || "";
  const name = String(rawName).trim();

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  // אם השם כבר קיים — אסור
  const exists = Object.values(usersById).find(u => u.name === name);
  if (exists) {
    return res.status(400).json({ error: "שם זה כבר בשימוש" });
  }

  const id = makeId("u");
  const user = {
    id,
    name,
    joinedAt: now(),
    lastSeenAt: now()
  };

  usersById[id] = user;
  broadcastState();
  res.json(user);
});

// מצב מלא ללקוח חדש
app.get("/api/boot", (req, res) => {
  res.json(stateSnapshot());
});

// יצירת טרייד חדש
app.post("/api/trades", (req, res) => {
  const { fromId, toId, give, take } = req.body || {};

  if (!fromId || !toId || !give || !take) {
    return res.status(400).json({ error: "missing fields" });
  }
  if (!usersById[fromId] || !usersById[toId]) {
    return res.status(400).json({ error: "unknown users" });
  }
  if (fromId === toId) {
    return res.status(400).json({ error: "cannot trade with yourself" });
  }

  const trade = {
    id: makeId("t"),
    fromId,
    toId,
    give: String(give).trim(),
    take: String(take).trim(),
    status: "OPEN", // OPEN | ACCEPTED | DECLINED | CANCELLED
    createdAt: now(),
    decidedAt: null
  };

  trades.push(trade);
  broadcastState();
  res.json(trade);
});

// שינוי סטטוס של טרייד
app.patch("/api/trades/:id", (req, res) => {
  const tradeId = req.params.id;
  const { action } = req.body || {};

  const trade = trades.find(t => t.id === tradeId);
  if (!trade) {
    return res.status(404).json({ error: "trade not found" });
  }
  if (trade.status !== "OPEN") {
    return res.status(400).json({ error: "trade already decided" });
  }

  if (!["accept", "decline", "cancel"].includes(action)) {
    return res.status(400).json({ error: "invalid action" });
  }

  if (action === "accept") {
    trade.status = "ACCEPTED";
  } else if (action === "decline") {
    trade.status = "DECLINED";
  } else if (action === "cancel") {
    trade.status = "CANCELLED";
  }

  trade.decidedAt = now();

  broadcastState();
  res.json(trade);
});

// ===== Socket.IO =====
io.on("connection", (socket) => {
  console.log("client connected", socket.id);
  socket.emit("state:update", stateSnapshot());

  socket.on("pong:client-alive", (userId) => {
    if (userId && usersById[userId]) {
      usersById[userId].lastSeenAt = now();
    }
  });

  socket.on("disconnect", () => {
    console.log("client disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("ITS A DEAL v2 listening on http://localhost:" + PORT);
});
