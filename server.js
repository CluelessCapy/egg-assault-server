/*
 * Egg Assault multiplayer server
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
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

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

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Egg Assault multiplayer server is running.\n');
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

