// public/client.js (full replacement)
console.log("Client JS loaded");

const socket = io();

// UI elements
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const infoEl = document.getElementById('info');
const nickInput = document.getElementById('nick');
const saveNickBtn = document.getElementById('saveNick');
const scoreboardEl = document.getElementById('scoreboard');
const touchControls = document.getElementById('touch-controls');
const overlay = document.getElementById('overlay');

const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

let you = null;
let map = [];
let tileSize = 28;
let mapW = 0, mapH = 0;
let players = [];
let runningDraw = false;
let lastResize = 0;

// helper: show/hide overlay
function showOverlay(html) {
  overlay.innerHTML = `<div style="background:#d0e6ff;padding:18px;border-radius:10px;text-align:center;">${html}</div>`;
  overlay.classList.remove('hidden');
}
function hideOverlay() {
  overlay.classList.add('hidden');
}

// resize canvas based on map and viewport
function resizeToMap() {
  canvas.width = mapW * tileSize;
  canvas.height = mapH * tileSize;

  // scale CSS to fit viewport while preserving aspect
  const paddingV = 120; // leave space for UI
  const maxW = window.innerWidth - 24;
  const maxH = window.innerHeight - paddingV;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1.8); // allow up to 1.8x on large screens
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

// draw pacman with mouth depending on dir
function drawPacman(x, y, r, color, dir) {
  // mouth angles: right 30° open, left pi±, up/top etc
  const mouth = Math.PI / 4;
  let start = mouth, end = -mouth;
  if (dir === 'right') { start = mouth; end = -mouth; }
  else if (dir === 'left') { start = Math.PI - mouth; end = Math.PI + mouth; }
  else if (dir === 'up') { start = -Math.PI/2 + mouth; end = -Math.PI/2 - mouth; }
  else if (dir === 'down') { start = Math.PI/2 + mouth; end = Math.PI/2 - mouth; }
  else { start = mouth; end = -mouth; }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, start, end, false);
  ctx.closePath();
  ctx.fill();
}

function draw() {
  if (!map || !map.length) {
    requestAnimationFrame(draw);
    return;
  }

  // background
  ctx.fillStyle = '#061018';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // draw tiles
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const t = map[y][x];
      const px = x * tileSize;
      const py = y * tileSize;
      if (t === 1) {
        ctx.fillStyle = '#1e3a5f';
        ctx.fillRect(px, py, tileSize, tileSize);
      } else {
        ctx.fillStyle = '#091a29';
        ctx.fillRect(px, py, tileSize, tileSize);
        if (t === 2) {
          // bean
          ctx.fillStyle = '#f5f0a1';
          const r = Math.max(2, Math.floor(tileSize * 0.12));
          ctx.beginPath();
          ctx.arc(px + tileSize / 2, py + tileSize / 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // players
  for (const p of players) {
    const cx = p.x * tileSize + tileSize / 2;
    const cy = p.y * tileSize + tileSize / 2;
    const radius = tileSize * 0.42;

    drawPacman(cx, cy, radius, p.color || '#fff', p.dir || 'right');

    // eye (small)
    ctx.fillStyle = '#061018';
    const eyeX = cx + (p.dir === 'left' ? -radius*0.25 : radius*0.25);
    const eyeY = cy - radius*0.25;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, Math.max(2, Math.floor(tileSize * 0.07)), 0, Math.PI*2);
    ctx.fill();

    // name and score above
    ctx.fillStyle = '#d0e6ff';
    ctx.font = `${Math.max(10, Math.floor(tileSize * 0.45))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${p.name || 'P'} (${p.score || 0})`, cx, cy - tileSize * 0.8);

    // highlight you
    if (you && p.id === you.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x*tileSize + 2, p.y*tileSize + 2, tileSize - 4, tileSize - 4);
      ctx.lineWidth = 1;
    }
  }

  requestAnimationFrame(draw);
}

// update scoreboard HUD
function updateScoreboard() {
  scoreboardEl.innerHTML = '';
  const list = players.slice().sort((a,b) => (b.score||0)-(a.score||0));
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const left = document.createElement('div');
    left.innerHTML = `<span class="player-dot" style="background:${p.color}"></span><strong>${p.name || 'P'}</strong>`;
    const right = document.createElement('div');
    right.textContent = `${p.score || 0}`;
    row.appendChild(left);
    row.appendChild(right);
    scoreboardEl.appendChild(row);
  }
}

// Inputs: keyboard
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') socket.emit('input', 'up');
  if (k === 'arrowdown' || k === 's') socket.emit('input', 'down');
  if (k === 'arrowleft' || k === 'a') socket.emit('input', 'left');
  if (k === 'arrowright' || k === 'd') socket.emit('input', 'right');
});

// touch controls (emit once on press)
function bindTouchButton(el, dir) {
  if (!el) return;
  const send = () => socket.emit('input', dir);
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    send();
  });
  el.addEventListener('click', (ev) => { ev.preventDefault(); send(); });
}
bindTouchButton(btnUp, 'up');
bindTouchButton(btnDown, 'down');
bindTouchButton(btnLeft, 'left');
bindTouchButton(btnRight, 'right');

// nickname button
saveNickBtn.addEventListener('click', () => {
  const v = nickInput.value.trim();
  if (v) {
    socket.emit('setName', v);
    infoEl.textContent = `Nickname set to "${v}"`;
    setTimeout(() => (infoEl.textContent = ''), 2000);
  }
});

// socket events
socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('init', (data) => {
  console.log('init', data);
  you = data.you;
  map = data.map;
  tileSize = data.tileSize || tileSize;
  mapW = data.mapW || map[0]?.length || 20;
  mapH = data.mapH || map.length || 15;
  infoEl.textContent = `Connected. Max players: ${data.maxPlayers}.`;
  resizeToMap();

  // detect touch devices and show controls
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) touchControls.classList.remove('hidden');

  if (!runningDraw) {
    runningDraw = true;
    requestAnimationFrame(draw);
  }
});

socket.on('players', (list) => {
  players = list;
  updateScoreboard();
});

socket.on('map', (m) => {
  map = m;
  resizeToMap();
});

socket.on('message', (m) => {
  if (m?.text) {
    infoEl.textContent = m.text;
    setTimeout(() => (infoEl.textContent = ''), 2500);
  }
});

socket.on('game_over', (data) => {
  // data: { winnerId, winnerName, scores }
  console.log('game_over', data);
  const html = `<div style="font-weight:700; margin-bottom:8px;">Winner: ${data.winnerName}</div>` +
               `<div>Scores:</div>` +
               `<div style="margin-top:8px;">` +
               data.scores.map(s => `<div style="margin:6px 0;"><span style="display:inline-block;width:10px;height:10px;background:${s.color};margin-right:8px;border-radius:50%"></span> ${s.name}: ${s.score}</div>`).join('') +
               `</div>`;
  showOverlay(html);
  setTimeout(hideOverlay, 4500); // hide after round reset triggers on server
});

socket.on('room_full', () => {
  infoEl.textContent = 'Room is full. Try later.';
});

// debug fallback if socket.io not present
if (typeof io !== 'function') {
  console.error('socket.io client library missing. Check /socket.io/socket.io.js');
}

// handle window resize to re-fit canvas on orientation change
window.addEventListener('resize', () => {
  const now = Date.now();
  // throttle
  if (now - lastResize < 100) return;
  lastResize = now;
  if (mapW && mapH) resizeToMap();
});
