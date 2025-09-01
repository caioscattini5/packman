// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 5000;

app.use(express.static("public")); // serve index.html, client.js etc.

// --------- GAME STATE ----------
let players = [];
const tileSize = 24;

// Simple test map: 0 = empty, 1 = bean, 2 = wall
let map = [
  [2,2,2,2,2,2,2,2,2,2,2,2],
  [2,1,1,1,1,1,1,1,1,1,1,2],
  [2,1,2,2,1,2,2,2,1,2,1,2],
  [2,1,1,1,1,1,1,2,1,1,1,2],
  [2,2,2,1,2,2,1,2,2,2,1,2],
  [2,1,1,1,1,1,1,1,1,1,1,2],
  [2,2,2,2,2,2,2,2,2,2,2,2],
];
const mapH = map.length;
const mapW = map[0].length;

// --------- HELPERS ----------
function countBeans() {
  return map.flat().filter(v => v === 1).length;
}

// Movement logic
function movePlayer(p) {
  const dirs = { up:[0,-1], down:[0,1], left:[-1,0], right:[-1,0], right:[1,0] };
  // corrected dirs
  dirs.left = [-1,0];
  dirs.right = [1,0];

  // If at integer coordinates, allow direction change
  if (Number.isInteger(p.x) && Number.isInteger(p.y)) {
    const [ndx, ndy] = dirs[p.nextDir] || [0,0];
    if (map[p.y+ndy]?.[p.x+ndx] !== 2) {
      p.dir = p.nextDir;
    }
  }

  // Try to move forward
  const [dx, dy] = dirs[p.dir] || [0,0];
  if (map[p.y+dy]?.[p.x+dx] !== 2) {
    p.x += dx;
    p.y += dy;

    // Bean eaten
    if (map[p.y][p.x] === 1) {
      map[p.y][p.x] = 0;
      p.score += 10;

      // Check if all beans gone
      if (countBeans() === 0) {
        const winner = players.reduce((a,b) => a.score > b.score ? a : b, players[0]);
        io.emit("message", { text: `Game Over! Winner is ${winner.name} (${winner.score} pts)` });
      }
    }
  }
}

// --------- SOCKET.IO ----------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Add new player
  players.push({
    id: socket.id,
    x: 1,
    y: 1,
    dir: "right",
    nextDir: "right",
    score: 0,
    name: "Anon"
  });

  // Send init data
  socket.emit("init", {
    you: players.find(p => p.id === socket.id),
    map,
    mapW,
    mapH,
    tileSize,
    maxPlayers: 4
  });

  socket.on("setName", (name) => {
    const p = players.find(pl => pl.id === socket.id);
    if (p) p.name = name;
  });

  socket.on("input", (dir) => {
    const p = players.find(pl => pl.id === socket.id);
    if (p) p.nextDir = dir;
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    console.log("User disconnected:", socket.id);
  });
});

// --------- GAME LOOP ----------
setInterval(() => {
  players.forEach(p => movePlayer(p));
  io.emit("players", players);
  io.emit("map", map);
}, 250); // game tick speed (ms)

// --------- START SERVER ----------
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
