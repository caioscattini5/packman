// server.js (ESM)
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 5000;

app.use(express.static("public"));

// --- Game constants ---
const TICK_RATE = 20; // server ticks per second
const TILE_SIZE = 28;
// Maze sizes should be odd for generator; change if you want
const MAP_W = 31;
const MAP_H = 21;
const MAX_PLAYERS = 8;

const COLORS = ["#ffd54f","#4fc3f7","#ef9a9a","#a5d6a7","#ce93d8","#ffcc80","#90caf9","#b0bec5"];

let players = {}; // socketId -> player
let world = [];   // map grid: 1=wall, 2=pellet, 0=floor
let pelletsLeft = 0;
let gameActive = true;

// Maze generator (recursive backtracker)
function generateMaze(w, h) {
  // initialize with walls (1)
  const m = Array.from({ length: h }, () => Array(w).fill(1));

  // Helper: carve passages on odd coordinates
  const inBounds = (x, y) => x > 0 && x < w - 1 && y > 0 && y < h - 1;

  // start at (1,1)
  const stack = [{ x: 1, y: 1 }];
  m[1][1] = 0;

  const dirs = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 }
  ];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    // shuffle neighbors
    const neighbors = dirs
      .map(d => ({ x: cur.x + d.x, y: cur.y + d.y, d }))
      .filter(n => inBounds(n.x, n.y) && m[n.y][n.x] === 1)
      .sort(() => Math.random() - 0.5);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const nb = neighbors[0];
    // remove wall between cur and nb
    const midX = cur.x + (nb.d.x / 2);
    const midY = cur.y + (nb.d.y / 2);
    m[midY][midX] = 0;
    m[nb.y][nb.x] = 0;
    stack.push({ x: nb.x, y: nb.y });
  }

  // convert passages (0) into pellets (2) except start area if needed
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (m[y][x] === 0) m[y][x] = 2; // pellet
      // keep walls as 1
    }
  }

  // Add border walls to be safe (in case sizes odd)
  for (let x = 0; x < w; x++) {
    m[0][x] = 1;
    m[h - 1][x] = 1;
  }
  for (let y = 0; y < h; y++) {
    m[y][0] = 1;
    m[y][w - 1] = 1;
  }

  // Clear a small spawn area around (1,1)
  if (w > 3 && h > 3) {
    m[1][1] = 0;
    if (m[1][2] === 1) m[1][2] = 0;
    if (m[2][1] === 1) m[2][1] = 0;
  }

  return m;
}

// Utility clones
const cloneGrid = (g) => g.map(row => row.slice());

const countPellets = (g) => {
  let c = 0;
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) if (g[y][x] === 2) c++;
  return c;
};

const randomSpawn = (g) => {
  const h = g.length, w = g[0].length;
  while (true) {
    const x = 1 + Math.floor(Math.random() * (w - 2));
    const y = 1 + Math.floor(Math.random() * (h - 2));
    if (g[y][x] !== 1) return { x, y };
  }
};

const canMove = (x, y) => {
  return world[y] && world[y][x] !== 1;
};

function resetWorld() {
  // regenerate labyrinth
  const raw = generateMaze(MAP_W, MAP_H);
  // keep as world (pellets marked as 2)
  world = raw;
  pelletsLeft = countPellets(world);
  gameActive = true;

  // respawn players and reset scores
  Object.values(players).forEach((p, idx) => {
    const s = randomSpawn(world);
    p.x = s.x; p.y = s.y; p.dir = "right";
    p.nextDir = p.dir; // CHANGED: ensure nextDir exists and is synced with current dir
    p.score = 0; p.alive = true;
    // reassign color if needed
    p.color = COLORS[idx % COLORS.length];
  });
}

// On empty map start
resetWorld();

io.on("connection", (socket) => {
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit("room_full");
    socket.disconnect(true);
    return;
  }

  const color = COLORS[Object.keys(players).length % COLORS.length];
  const spawn = randomSpawn(world);
  players[socket.id] = {
    id: socket.id,
    name: `P${Object.keys(players).length + 1}`,
    x: spawn.x,
    y: spawn.y,
    dir: "right",
    nextDir: "right", // CHANGED: add nextDir so server can queue turns
    color,
    score: 0,
    alive: true
  };

  socket.emit("init", {
    you: players[socket.id],
    map: world,
    tileSize: TILE_SIZE,
    mapW: MAP_W,
    mapH: MAP_H,
    maxPlayers: MAX_PLAYERS
  });

  io.emit("players", Object.values(players));

  // CHANGED: store requested direction as nextDir (queue) instead of directly setting dir
  socket.on("input", (dir) => {
    if (!gameActive) return;
    if (!players[socket.id]) return;
    // Only allow valid dirs
    if (["up","down","left","right"].includes(dir)) {
      players[socket.id].nextDir = dir;
    }
  });

  socket.on("setName", (name) => {
    if (!players[socket.id]) return;
    players[socket.id].name = String(name).slice(0, 16);
    io.emit("players", Object.values(players));
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("players", Object.values(players));
  });
});

// Game loop (improved turning tolerance)
setInterval(() => {
  if (!gameActive) return;

  let mapChanged = false; // track whether we ate any pellets this tick

  for (const p of Object.values(players)) {
    if (!p.alive) continue;

    const DIRS = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };

    const requested = p.nextDir || null;
    const reqD = requested ? DIRS[requested] : null;
    const curD = DIRS[p.dir];

    // --- TURN LOGIC (improved) ---
    // 1) If perfectly aligned to tile center, try to apply requested immediately.
    if (Number.isInteger(p.x) && Number.isInteger(p.y)) {
      if (requested && reqD && canMove(p.x + reqD.x, p.y + reqD.y)) {
        p.dir = requested;
        p.nextDir = null;
        p.turnSoon = null;
      }
    } else {
      // 2) Not perfectly aligned: allow an early-turn marker if after the next forward move
      //    the requested turn would be possible. This increases the effective turn window.
      if (requested && reqD && curD) {
        const aheadX = p.x + curD.x;
        const aheadY = p.y + curD.y;
        // require that we can step forward and, from that next tile, the requested turn target is free
        if (canMove(aheadX, aheadY) && canMove(aheadX + reqD.x, aheadY + reqD.y)) {
          p.turnSoon = requested; // will be applied once we reach the next tile center
        }
      }
    }

    // --- MOVE ---
    const d = DIRS[p.dir] || DIRS.left;
    const nx = p.x + d.x;
    const ny = p.y + d.y;

    if (canMove(nx, ny)) {
      p.x = nx; p.y = ny;

      // If we had an early-turn queued for application, check and apply now (we are aligned after moving one tile)
      if (p.turnSoon && Number.isInteger(p.x) && Number.isInteger(p.y)) {
        const turn = p.turnSoon;
        const turnD = DIRS[turn];
        if (turn && turnD && canMove(p.x + turnD.x, p.y + turnD.y)) {
          p.dir = turn;
          p.nextDir = null;
        }
        p.turnSoon = null;
      }

      // if pellet present, eat it and mark change
      if (world[ny][nx] === 2) {
        world[ny][nx] = 0;
        p.score += 10;
        pelletsLeft--;
        mapChanged = true;
      }
    } else {
      // blocked: don't move. keep nextDir/turnSoon for future ticks
    }
  }

  // If any pellet was eaten, broadcast updated map immediately so clients remove beans visually
  if (mapChanged) {
    io.emit('map', world);
  }

  // Check end condition
  if (pelletsLeft <= 0 && gameActive) {
    gameActive = false;
    let winner = null;
    for (const p of Object.values(players)) {
      if (!winner || (p.score || 0) > (winner.score || 0)) winner = p;
    }
    const scores = Object.values(players).map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color }));
    io.emit('game_over', {
      winnerId: winner?.id || null,
      winnerName: winner?.name || "—",
      scores
    });

    setTimeout(() => {
      resetWorld();
      io.emit('map', world);
      io.emit('players', Object.values(players));
      io.emit('message', { type: "round", text: "New round started!" });
    }, 5000);
  }

  // Broadcast player states (scores and positions) every tick
  io.emit('players', Object.values(players));
}, 1000 / TICK_RATE);


server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`LAN tip: find your IP (e.g., 192.168.x.x) and share http://<LAN-IP>:${PORT}`);
});
