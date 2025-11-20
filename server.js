const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");

const ADMIN_PASSWORD = "CHANGE_ME_ADMIN_PASSWORD"; // TODO: change this before deploy

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

// serve frontend from /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ===== data model =====
// usersById: {
//   [id]: { id, name, password, joinedAt, lastSeenAt, deviceId }
// }
// trades:   { id, fromId, toId, give, take, status, createdAt, decidedAt }
const usersById = {};
const trades = [];

function now() {
  return Date.now();
}

function makeId(prefix) {
  return (
    prefix +
    "_" +
    now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function safeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function stateSnapshot() {
  return {
    users: Object.values(usersById).map(safeUser),
    trades
  };
}

function broadcastState() {
  io.emit("state:update", stateSnapshot());
}

// ===== REST API =====

// create / login user – name+password pair
// adds isNew: true/false so client knows if this device just created first user
app.post("/api/join", (req, res) => {
  const rawName = (req.body && req.body.name) || "";
  const rawPassword = (req.body && req.body.password) || "";
  const rawDeviceId = (req.body && req.body.deviceId) || "";
  const name = String(rawName).trim();
  const password = String(rawPassword);
  const deviceId = rawDeviceId ? String(rawDeviceId) : null;

  if (!name) {
    return res.status(400).json({ error: "צריך לכתוב שם" });
  }
  if (!password) {
    return res.status(400).json({ error: "צריך סיסמה" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "הסיסמה חייבת להיות לפחות 6 תווים" });
  }

  const existing = Object.values(usersById).find((u) => u.name === name);

  if (existing) {
    // login case
    if (existing.password !== password) {
      return res
        .status(400)
        .json({ error: "השם הזה כבר קיים עם סיסמה אחרת" });
    }
    existing.lastSeenAt = now();
    const out = safeUser(existing);
    out.isNew = false;
    return res.json(out);
  }

  // new user – enforce "one created user per deviceId" if provided
  if (deviceId) {
    const takenBy = Object.values(usersById).find(
      (u) => u.deviceId === deviceId
    );
    if (takenBy) {
      return res.status(400).json({
        error: "במכשיר הזה כבר נוצר משתמש בשם: " + takenBy.name
      });
    }
  }

  const id = makeId("u");
  const user = {
    id,
    name,
    password,
    joinedAt: now(),
    lastSeenAt: now(),
    deviceId: deviceId || null
  };
  usersById[id] = user;

  broadcastState();
  const out = safeUser(user);
  out.isNew = true;
  res.json(out);
});


// device status by deviceId – used by client to reset wrong first user after admin delete
app.get("/api/device-status", (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) {
    return res.status(400).json({ error: "missing deviceId" });
  }
  const user = Object.values(usersById).find(u => u.deviceId === deviceId);
  res.json({ user: safeUser(user) });
});

// full state for initial boot
app.get("/api/boot", (req, res) => {
  res.json(stateSnapshot());
});

// create trade
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
    status: "OPEN", // OPEN | ACCEPTED | DECLINED | CANCELLED | BROKEN
    createdAt: now(),
    decidedAt: null
  };

  trades.push(trade);
  broadcastState();
  res.json(trade);
});

// update trade status (accept / decline / cancel / break)
app.patch("/api/trades/:id", (req, res) => {
  const tradeId = req.params.id;
  const { action, requesterId } = req.body || {};

  const trade = trades.find((t) => t.id === tradeId);
  if (!trade) {
    return res.status(404).json({ error: "trade not found" });
  }

  if (!["accept", "decline", "cancel", "break", "done"].includes(action)) {
    return res.status(400).json({ error: "invalid action" });
  }

  // שבירת דיל – רק מי ששלח את ההצעה (fromId) יכול, ורק אם הדיל מאושר
  if (action === "break") {
    if (trade.status !== "ACCEPTED") {
      return res
        .status(400)
        .json({ error: "only accepted trades can be broken" });
    }
    if (!requesterId || requesterId !== trade.fromId) {
      return res.status(403).json({
        error: "only the sender of the deal can break it"
      });
    }
    trade.status = "BROKEN";
    trade.decidedAt = now();
    broadcastState();
    return res.json(trade);
  }

  if (action === "done") {
    if (trade.status !== "ACCEPTED") {
      return res
        .status(400)
        .json({ error: "only accepted trades can be marked as done" });
    }
    if (!requesterId || requesterId !== trade.fromId) {
      return res.status(403).json({
        error: "only the sender of the deal can mark it as done"
      });
    }
    trade.status = "DONE";
    trade.decidedAt = now();
    broadcastState();
    return res.json(trade);
  }

  // שאר הפעולות (accept / decline / cancel) אפשר לשמור כמו קודם
  if (trade.status !== "OPEN") {
    return res.status(400).json({ error: "trade already decided" });
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

// generate PDF contract for a trade
app.get("/api/trades/:id/pdf", (req, res) => {
  const tradeId = req.params.id;
  const trade = trades.find((t) => t.id === tradeId);
  if (!trade) {
    return res.status(404).json({ error: "trade not found" });
  }

  // חוזה נוצר רק לאחר שהדיל מאושר
  if (trade.status !== "ACCEPTED") {
    return res
      .status(400)
      .json({ error: "PDF זמין רק לדילים מאושרים (ACCEPTED)" });
  }

  const fromUser = usersById[trade.fromId];
  const toUser = usersById[trade.toId];

  const fromName = fromUser ? fromUser.name : trade.fromId;
  const toName = toUser ? toUser.name : trade.toId;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="deal_${trade.id}.pdf"`
  );

  const doc = new PDFDocument({ margin: 50 });
  try {
    const fontPath = path.join(__dirname, "fonts", "DejaVuSans.ttf");
    doc.registerFont("Hebrew", fontPath);
    doc.font("Hebrew");
  } catch (e) {
    console.error("Font load error", e);
  }
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const marginLeft = doc.page.margins.left;
  const marginRight = doc.page.margins.right;
  const bodyWidth = pageWidth - marginLeft - marginRight;

  // Header bar
  doc.save();
  doc.rect(0, 0, pageWidth, 60).fill("#0d47a1");
  doc.fillColor("#ffffff");
  doc.fontSize(20).text("חוזה דיל - ITS A DEAL", marginLeft, 18, {
    align: "center",
    width: bodyWidth
  });
  doc.restore();

  doc.moveDown(3);

  // Info box background
  const infoTop = doc.y;
  const boxPadding = 8;
  const boxWidth = bodyWidth;
  // Draw a light background box
  doc.save();
  doc.rect(marginLeft, infoTop - boxPadding, boxWidth, 80).fill("#f5f5f5");
  doc.restore();

  doc.fillColor("#000000").fontSize(12);
  doc.text("תאריך יצירת הדיל: " + new Date(trade.createdAt).toLocaleString("he-IL"), marginLeft + 6, infoTop, {
    align: "right",
    width: boxWidth - 12
  });
  doc.moveDown(0.5);
  doc.text("צד א' (המציע): " + fromName, {
    align: "right",
    width: boxWidth - 12
  });
  doc.moveDown(0.3);
  doc.text("צד ב' (המאשר): " + toName, {
    align: "right",
    width: boxWidth - 12
  });

  doc.moveDown(2);

  // Deal details section
  doc.fontSize(13).text("פרטי ההתחייבות", {
    align: "right",
    underline: true,
    width: bodyWidth
  });
  doc.moveDown(1);

  doc.fontSize(12);
  doc.text("• מה צד א' מתחייב לתת:", {
    align: "right",
    width: bodyWidth
  });
  doc.moveDown(0.3);
  doc.text(trade.give, {
    align: "right",
    width: bodyWidth
  });
  doc.moveDown(1);

  doc.text("• מה צד ב' מתחייב לתת:", {
    align: "right",
    width: bodyWidth
  });
  doc.moveDown(0.3);
  doc.text(trade.take, {
    align: "right",
    width: bodyWidth
  });
  doc.moveDown(2);

  doc.text("סטטוס נוכחי של הדיל: " + trade.status, {
    align: "right",
    width: bodyWidth
  });

  doc.end();
});

// ===== SIMPLE ADMIN API (password-based) =====

// check admin password
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false, error: "wrong password" });
});

// get full state (users + trades) for admin
app.get("/api/admin/state", (req, res) => {
  const pass = req.query.password;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json(stateSnapshot());
});

// delete user (and all their trades)
app.delete("/api/admin/users/:id", (req, res) => {
  const pass = req.query.password;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "forbidden" });
  }
  const id = req.params.id;
  if (!usersById[id]) {
    return res.status(404).json({ error: "user not found" });
  }
  delete usersById[id];

  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].fromId === id || trades[i].toId === id) {
      trades.splice(i, 1);
    }
  }

  broadcastState();
  res.json({ ok: true });
});

// delete trade
app.delete("/api/admin/trades/:id", (req, res) => {
  const pass = req.query.password;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "forbidden" });
  }
  const id = req.params.id;
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "trade not found" });
  }
  trades.splice(idx, 1);
  broadcastState();
  res.json({ ok: true });
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
  console.log("ITS A DEAL v11 listening on http://localhost:" + PORT);
});
