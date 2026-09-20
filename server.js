/*
 * Egg Assault multiplayer + map-submission server
 * ---------------------------------
 * A small, free-tier-friendly WebSocket server for Egg Assault's
 * multiplayer mode. It is intentionally simple:
 *   - Players join a "room" by typing the same room code in-game.
 *   - The first player to join a room decides which map everyone
 *     in that room plays on, so everyone's local geometry matches.
 *   - Each client does its own hit detection (raycasting against the
 *     other players it can see) and reports "I think I hit player X
 *     with weapon Y" to the server.
 *   - The server is the one source of truth for HP and kills: it
 *     looks up the weapon's damage and applies it, then broadcasts
 *     the result to everyone in the room. This keeps a client from
 *     just claiming "I did 9999 damage".
 *   - Players move around on their own machines and just tell the
 *     server (a handful of times per second) where they are; the
 *     server relays that to everyone else in the room. There is no
 *     server-side physics simulation of movement — this keeps things
 *     simple and cheap to run, which is fine for a small casual game.
 *
 * This is NOT a fully cheat-proof authoritative server (a modified
 * client could still lie about its own position, for example) but it
 * stops the most obvious cheating (arbitrary damage) and is a good
 * fit for a free hobby project among friends.
 *
 * ---------------------------------
 * Map submissions (new)
 * ---------------------------------
 * The Map Studio page (map-studio.html on the game's site) lets
 * players design a custom arena and submit it here. Submissions sit
 * in memory as "pending" until the site owner opens /admin, types the
 * admin passphrase, and approves or rejects each one. Approved maps
 * are exposed at GET /api/approved, which the game itself fetches on
 * load so approved community maps show up as real, selectable maps.
 *
 * Storage is in-memory only (a plain array) — there's no database.
 * That keeps this free and simple, but it does mean a server restart
 * (a new deploy, or Render's free tier spinning the service down
 * after inactivity and back up on the next request) clears out
 * whatever hasn't been approved yet. Approve submissions you want to
 * keep reasonably promptly. If this ever becomes a real problem, the
 * fix is to add a small persistent database — not needed to get
 * started.
 */

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Change this to whatever you like — it's the passphrase the /admin
// page asks for before it'll show you pending map submissions.
const ADMIN_KEY = process.env.ADMIN_KEY || 'eggboss2026';

// Mirrors the "dmg" field from WEAPON_DEFS in egg_assault_pro.html.
// Keep this in sync if you change weapon damage in the client.
const WEAPON_DMG = {
  pistol: 26,
  smg: 14,
  ar: 26,
  shotgun: 9,
  sniper: 110
};

const RESPAWN_DELAY_MS = 3000;
const SPAWN_MIN_DIST = 6;
const SPAWN_MAX_DIST = 26;

/** @type {Map<string, {mapId:string, players:Map<string, any>}>} */
const rooms = new Map();
let nextId = 1;

function randSpawn() {
  const a = Math.random() * Math.PI * 2;
  const d = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
  return [Math.cos(a) * d, 1.65, Math.sin(a) * d];
}

function getOrCreateRoom(code, mapId) {
  let room = rooms.get(code);
  if (!room) {
    room = { mapId: mapId || 'yolkyard', players: new Map() };
    rooms.set(code, room);
  }
  return room;
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function safeSend(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/* ================= map submissions ================= */

const MAX_SUBMISSIONS = 300; // total ever kept in memory (pending+decided), oldest decided ones get dropped first
const MAX_OBJECTS = 260;
const OBJECT_TYPES = new Set(['wall', 'crate', 'pillar', 'platform', 'ramp']);
const submissions = []; // newest last

function clampNum(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function cleanStr(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.slice(0, maxLen).replace(/[\u0000-\u001f]/g, '');
}
function cleanColor(c, fallback) {
  if (typeof c !== 'string') return fallback;
  c = c.slice(0, 40);
  if (/^#?[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\([\d.,%\s]+\)$/.test(c)) return c;
  return fallback;
}

function sanitizeSubmission(body) {
  if (!body || typeof body !== 'object') return null;
  const objsIn = Array.isArray(body.objects) ? body.objects.slice(0, MAX_OBJECTS) : [];
  const objects = [];
  for (const o of objsIn) {
    if (!o || !OBJECT_TYPES.has(o.type)) continue;
    objects.push({
      type: o.type,
      x: clampNum(o.x, -55, 55, 0),
      z: clampNum(o.z, -55, 55, 0),
      w: clampNum(o.w, 0.3, 40, 2),
      d: clampNum(o.d, 0.3, 40, 2),
      h: clampNum(o.h, 0.3, 20, 2),
      rot: clampNum(o.rot, 0, 359, 0)
    });
  }
  if (!objects.length) return null;

  const c = body.colors && typeof body.colors === 'object' ? body.colors : {};
  const sky = Array.isArray(c.sky) && c.sky.length === 3
    ? [cleanColor(c.sky[0], '#4fb2f2'), cleanColor(c.sky[1], '#9ad8fb'), cleanColor(c.sky[2], '#eef9ff')]
    : ['#4fb2f2', '#9ad8fb', '#eef9ff'];
  const ambient = Array.isArray(c.ambient) && c.ambient.length === 2
    ? [cleanColor(c.ambient[0], '#ffffff'), cleanColor(c.ambient[1], '#93a8bd')]
    : ['#ffffff', '#93a8bd'];

  return {
    id: 'sub_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    name: cleanStr(body.name, 24).trim() || 'Untitled Map',
    tag: cleanStr(body.tag, 60).trim() || 'A custom arena',
    submitter: cleanStr(body.submitter, 24).trim() || 'Anonymous',
    theme: cleanStr(body.theme, 24) || 'custom',
    colors: {
      sky,
      fog: cleanColor(c.fog, '#bfe3fb'),
      bg: cleanColor(c.bg, '#8fd3fb'),
      floor: cleanColor(c.floor, '#b7c0c9'),
      floorLine: cleanColor(c.floorLine, 'rgba(30,35,45,.28)'),
      wall: cleanColor(c.wall, '#f0d59a'),
      wallStripe: cleanColor(c.wallStripe, '#e5543f'),
      wallDark: cleanColor(c.wallDark, '#cdab6c'),
      crate: cleanColor(c.crate, '#d69248'),
      pillar: cleanColor(c.pillar, '#f4f7fa'),
      ambient,
      sun: cleanColor(c.sun, '#fff3d6')
    },
    objects,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };
}

function publicApproved(sub) {
  return {
    id: sub.id,
    name: sub.name,
    tag: sub.tag,
    submitter: sub.submitter,
    colors: sub.colors,
    objects: sub.objects
  };
}

function pruneSubmissions() {
  if (submissions.length <= MAX_SUBMISSIONS) return;
  // drop the oldest non-pending entries first, then oldest pending if still over
  const over = submissions.length - MAX_SUBMISSIONS;
  let removed = 0;
  for (let i = 0; i < submissions.length && removed < over; ) {
    if (submissions[i].status !== 'pending') { submissions.splice(i, 1); removed++; }
    else i++;
  }
  while (submissions.length > MAX_SUBMISSIONS) submissions.shift();
}

function readBody(req, maxBytes, cb) {
  let size = 0;
  const chunks = [];
  let done = false;
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > maxBytes) {
      done = true;
      cb(new Error('too large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      cb(null, raw ? JSON.parse(raw) : {});
    } catch (e) {
      cb(e);
    }
  });
  req.on('error', (e) => { if (!done) { done = true; cb(e); } });
}

function sendJSON(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(data);
}

function checkKey(req, url) {
  return url.searchParams.get('key') === ADMIN_KEY ||
    req.headers['x-admin-key'] === ADMIN_KEY;
}

const ADMIN_PAGE = require('./admin-page.js');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key'
    });
    res.end();
    return;
  }

  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Egg Assault multiplayer server is running.\n');
    return;
  }

  if (path === '/admin' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(ADMIN_PAGE);
    return;
  }

  if (path === '/api/approved' && req.method === 'GET') {
    const approved = submissions.filter((s) => s.status === 'approved').map(publicApproved);
    sendJSON(res, 200, approved);
    return;
  }

  if (path === '/submit-map' && req.method === 'POST') {
    readBody(req, 250 * 1024, (err, body) => {
      if (err) { sendJSON(res, 400, { ok: false, error: 'Bad request.' }); return; }
      const sub = sanitizeSubmission(body);
      if (!sub) { sendJSON(res, 400, { ok: false, error: 'Map needs at least one valid piece.' }); return; }
      submissions.push(sub);
      pruneSubmissions();
      sendJSON(res, 200, { ok: true, id: sub.id });
    });
    return;
  }

  if (path === '/api/pending' && req.method === 'GET') {
    if (!checkKey(req, url)) { sendJSON(res, 401, { ok: false, error: 'Wrong or missing key.' }); return; }
    const pending = submissions.filter((s) => s.status !== 'approved-hidden');
    sendJSON(res, 200, pending);
    return;
  }

  const decideMatch = path.match(/^\/api\/(approve|reject)\/([a-zA-Z0-9_]+)$/);
  if (decideMatch && req.method === 'POST') {
    if (!checkKey(req, url)) { sendJSON(res, 401, { ok: false, error: 'Wrong or missing key.' }); return; }
    const action = decideMatch[1];
    const id = decideMatch[2];
    const sub = submissions.find((s) => s.id === id);
    if (!sub) { sendJSON(res, 404, { ok: false, error: 'Not found (it may have been cleared by a restart).' }); return; }
    sub.status = action === 'approve' ? 'approved' : 'rejected';
    sendJSON(res, 200, { ok: true, status: sub.status });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const id = 'p' + nextId++;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      roomCode = String(msg.room || 'main').slice(0, 24) || 'main';
      const room = getOrCreateRoom(roomCode, msg.mapId);
      const spawn = randSpawn();
      const player = {
        id,
        ws,
        name: String(msg.name || 'Player').slice(0, 16) || 'Player',
        weaponId: typeof msg.weaponId === 'string' ? msg.weaponId : 'ar',
        pos: spawn,
        yaw: 0,
        pitch: 0,
        moving: false,
        hp: 100,
        kills: 0,
        alive: true
      };
      room.players.set(id, player);

      safeSend(ws, {
        t: 'joined',
        id,
        mapId: room.mapId,
        players: [...room.players.values()]
          .filter((p) => p.id !== id)
          .map((p) => ({
            id: p.id,
            name: p.name,
            weaponId: p.weaponId,
            pos: p.pos,
            yaw: p.yaw,
            hp: p.hp,
            kills: p.kills,
            alive: p.alive
          }))
      });

      broadcast(
        room,
        {
          t: 'playerJoined',
          id,
          name: player.name,
          weaponId: player.weaponId,
          pos: player.pos,
          yaw: player.yaw,
          hp: player.hp,
          kills: player.kills,
          alive: player.alive
        },
        id
      );
      return;
    }

    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(id);
    if (!player) return;

    if (msg.t === 'state') {
      if (!player.alive) return;
      if (Array.isArray(msg.pos) && msg.pos.length === 3) player.pos = msg.pos;
      player.yaw = typeof msg.yaw === 'number' ? msg.yaw : player.yaw;
      player.pitch = typeof msg.pitch === 'number' ? msg.pitch : player.pitch;
      player.moving = !!msg.moving;
      if (typeof msg.weaponId === 'string') player.weaponId = msg.weaponId;
      broadcast(
        room,
        {
          t: 'state',
          id,
          pos: player.pos,
          yaw: player.yaw,
          pitch: player.pitch,
          moving: player.moving,
          weaponId: player.weaponId
        },
        id
      );
      return;
    }

    if (msg.t === 'shot') {
      if (!player.alive) return;
      const target = room.players.get(msg.targetId);
      if (!target || !target.alive) return;
      const dmg = WEAPON_DMG[msg.weaponId] || 20;
      target.hp = Math.max(0, target.hp - dmg);
      broadcast(room, { t: 'hit', targetId: target.id, shooterId: id, weaponId: msg.weaponId, hp: target.hp }, null);

      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        player.kills++;
        broadcast(room, { t: 'killed', targetId: target.id, shooterId: id, kills: player.kills }, null);

        setTimeout(() => {
          const stillThere = room.players.get(target.id);
          if (!stillThere) return;
          stillThere.alive = true;
          stillThere.hp = 100;
          stillThere.pos = randSpawn();
          broadcast(room, { t: 'respawned', id: stillThere.id, pos: stillThere.pos, hp: 100 }, null);
        }, RESPAWN_DELAY_MS);
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.players.delete(id);
    if (room.players.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcast(room, { t: 'playerLeft', id }, null);
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('Egg Assault multiplayer server listening on port ' + PORT);
});
