// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Fake database (bunu MongoDB/SQLite yapabilirsin)
let users = {};       // { username: { password, coins, gifts } }
let rooms = {};       // { roomId: { host, viewers, pk: {...}, messages: [] } }
let leaderBoard = []; // Sıralama

function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

io.on("connection", (socket) => {
  console.log("🔌 Bağlandı:", socket.id);

  // Giriş & Kayıt
  socket.on("register", ({ username, password }, cb) => {
    if (users[username]) return cb({ success: false, msg: "Kullanıcı var" });
    users[username] = { password, coins: 100, gifts: 0 };
    cb({ success: true, msg: "Kayıt başarılı" });
  });

  socket.on("login", ({ username, password }, cb) => {
    if (!users[username] || users[username].password !== password)
      return cb({ success: false, msg: "Hatalı giriş" });
    socket.username = username;
    cb({ success: true, msg: "Giriş başarılı", user: users[username] });
  });

  // Yayın açma
  socket.on("open-stream", (data, cb) => {
    const roomId = generateId();
    rooms[roomId] = { host: socket.username, viewers: [], pk: null, messages: [] };
    socket.join(roomId);
    cb({ success: true, roomId });
    io.emit("streams-update", rooms);
  });

  // Yayına katılma
  socket.on("join-stream", ({ roomId }, cb) => {
    if (!rooms[roomId]) return cb({ success: false, msg: "Oda yok" });
    rooms[roomId].viewers.push(socket.username);
    socket.join(roomId);
    cb({ success: true, msg: "Katıldın" });
    io.to(roomId).emit("user-joined", socket.username);
  });

  // Mesajlaşma
  socket.on("send-message", ({ roomId, text }) => {
    if (!rooms[roomId]) return;
    const msg = { user: socket.username, text };
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit("new-message", msg);
  });

  // Hediye gönderme
  socket.on("send-gift", ({ roomId, gift }, cb) => {
    if (!rooms[roomId]) return cb({ success: false });
    if (users[socket.username].coins < gift.value)
      return cb({ success: false, msg: "Yetersiz bakiye" });

    users[socket.username].coins -= gift.value;
    users[rooms[roomId].host].gifts += gift.value;

    cb({ success: true });
    io.to(roomId).emit("gift-received", {
      from: socket.username,
      gift
    });
  });

  // PK sistemi (yayıncı vs yayıncı kapışması)
  socket.on("start-pk", ({ room1, room2 }, cb) => {
    if (!rooms[room1] || !rooms[room2]) return cb({ success: false });
    rooms[room1].pk = { rival: room2, score: 0 };
    rooms[room2].pk = { rival: room1, score: 0 };
    io.to(room1).emit("pk-started", { rival: room2 });
    io.to(room2).emit("pk-started", { rival: room1 });
    cb({ success: true });
  });

  // Kamera değiştir / yayını kapat / duraklat
  socket.on("toggle-camera", ({ roomId }) => {
    io.to(roomId).emit("camera-toggled", socket.username);
  });
  socket.on("pause-stream", ({ roomId }) => {
    io.to(roomId).emit("stream-paused", socket.username);
  });
  socket.on("close-stream", ({ roomId }) => {
    delete rooms[roomId];
    io.emit("streams-update", rooms);
  });

  // Oyunlar (örnek: taş-kağıt-makas)
  socket.on("play-game", ({ roomId, move }) => {
    io.to(roomId).emit("game-move", { user: socket.username, move });
  });

  // Lider Tablosu
  socket.on("get-leaderboard", (cb) => {
    leaderBoard = Object.entries(users)
      .map(([username, data]) => ({ username, gifts: data.gifts }))
      .sort((a, b) => b.gifts - a.gifts);
    cb(leaderBoard);
  });

  socket.on("disconnect", () => {
    console.log("❌ Ayrıldı:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("✅ Sunucu 3000 portunda çalışıyor");
});
