// CYBERTERM multiplayer relay server (rooms 1-4, host authoritative)
// Usage:
//   cd mp-relay
//   npm install
//   npm start

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('CYBERTERM MP relay is running.\n');
});

const wss = new WebSocket.Server({ server });

/** @type {Map<string, { room: string, hostId: string|null, sockets: Map<string, WebSocket>, players: Map<string, any>, lockState: any, lobby: any }>} */
const rooms = new Map();

function now() { return Date.now(); }

function genId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function safeName(n) {
  return String(n || '').trim().slice(0, 20) || 'Player';
}

function getRoom(roomCode) {
  const room = String(roomCode || '').trim().toUpperCase();
  if (!room) return null;
  if (!rooms.has(room)) {
    rooms.set(room, {
      room,
      hostId: null,
      sockets: new Map(),
      players: new Map(),
      lobby: {
        started: false,
      },
      lockState: {
        lockedIds: [],
        lockOrder: [],
        prompts: {}, // id -> { text, ts, order }
      },
    });
  }
  return rooms.get(room);
}

function roomPlayersPayload(r) {
  return Array.from(r.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    snapshot: p.snapshot || null,
    promptDraft: p.promptDraft || '',
    promptLocked: !!p.promptLocked,
    promptText: p.promptText || '',
    lockOrder: typeof p.lockOrder === 'number' ? p.lockOrder : null,
    ready: !!p.ready,
  }));
}

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(r, obj) {
  for (const ws of r.sockets.values()) send(ws, obj);
}

function recomputeLockState(r) {
  const locked = [];
  const lockOrder = [];
  const prompts = {};
  const players = Array.from(r.players.values());
  players
    .filter(p => p.promptLocked)
    .sort((a, b) => (a.lockOrder ?? 999) - (b.lockOrder ?? 999))
    .forEach(p => {
      locked.push(p.id);
      lockOrder.push(p.id);
      prompts[p.id] = { text: p.promptText || '', ts: p.lockTs || 0, order: p.lockOrder ?? 0 };
    });
  r.lockState = { lockedIds: locked, lockOrder, prompts };
}

function roomUpdate(r) {
  recomputeLockState(r);
  broadcast(r, { type: 'room_update', players: roomPlayersPayload(r), lockState: r.lockState, lobby: r.lobby });
}

function cleanupRoomIfEmpty(r) {
  if (r.sockets.size === 0) rooms.delete(r.room);
}

wss.on('connection', (ws) => {
  const id = genId();
  ws.__id = id;
  ws.__room = null;
  ws.__role = null;

  ws.on('message', (buf) => {
    let msg = null;
    try { msg = JSON.parse(buf.toString('utf8')); } catch (_) {}
    if (!msg || !msg.type) return;

    if (msg.type === 'hello') {
      const role = msg.role === 'host' ? 'host' : 'client';
      const roomCode = String(msg.room || '').trim().toUpperCase();
      const name = safeName(msg.name);
      const r = getRoom(roomCode);
      if (!r) return send(ws, { type: 'system', text: 'invalid room' });

      // room capacity
      if (r.sockets.size >= 4) {
        send(ws, { type: 'system', text: 'room is full (4/4)' });
        ws.close();
        return;
      }

      ws.__room = r.room;
      ws.__role = role;
      r.sockets.set(id, ws);

      // host assignment
      if (role === 'host') r.hostId = id;
      if (!r.hostId) r.hostId = id; // first connection becomes implicit host

      r.players.set(id, {
        id,
        name,
        role: id === r.hostId ? 'host' : 'client',
        snapshot: null,
        promptDraft: '',
        promptLocked: false,
        promptText: '',
        lockOrder: null,
        lockTs: null,
        ready: false,
      });

      send(ws, { type: 'welcome', playerId: id, room: r.room, hostId: r.hostId });
      roomUpdate(r);

      // request sync from host for joiners
      if (id !== r.hostId) {
        const hostWs = r.sockets.get(r.hostId);
        if (hostWs) send(hostWs, { type: 'request_sync', targetId: id });
      }
      return;
    }

    const r = ws.__room ? rooms.get(ws.__room) : null;
    if (!r) return;
    const player = r.players.get(id);
    if (!player) return;

    if (msg.type === 'leave') {
      ws.close();
      return;
    }

    if (msg.type === 'ready') {
      if (r.lobby.started) return;
      player.ready = !!msg.ready;
      roomUpdate(r);
      return;
    }

    if (msg.type === 'start_game') {
      if (id !== r.hostId) return;
      if (r.lobby.started) return;
      // Require all players ready (including host)
      const allReady = Array.from(r.players.values()).every(p => p.ready);
      if (!allReady) {
        send(ws, { type: 'system', text: 'not everyone is ready' });
        return;
      }
      r.lobby.started = true;
      roomUpdate(r);
      broadcast(r, { type: 'system', text: 'match started' });
      return;
    }

    if (msg.type === 'player_snapshot') {
      player.snapshot = msg.snapshot || null;
      roomUpdate(r);
      return;
    }

    if (msg.type === 'prompt_draft') {
      player.promptDraft = String(msg.text || '').slice(0, 800);
      roomUpdate(r);
      return;
    }

    if (msg.type === 'lock_in') {
      if (player.promptLocked) return;
      const text = String(msg.text || '').trim().slice(0, 1200);
      if (!text) return;
      player.promptLocked = true;
      player.promptText = text;
      player.lockTs = now();
      const lockedCount = Array.from(r.players.values()).filter(p => p.promptLocked).length;
      player.lockOrder = lockedCount - 1;

      broadcast(r, {
        type: 'prompt_locked',
        playerId: player.id,
        name: player.name,
        text,
        order: player.lockOrder,
      });

      roomUpdate(r);
      return;
    }

    if (msg.type === 'sync') {
      // host -> specific client
      if (id !== r.hostId) return;
      const targetId = msg.targetId;
      const targetWs = r.sockets.get(targetId);
      if (!targetWs) return;
      send(targetWs, { type: 'sync', sync: msg.sync || {} });
      return;
    }

    if (msg.type === 'sync_broadcast') {
      // host -> everyone
      if (id !== r.hostId) return;

      // reset prompt locks for next turn
      for (const p of r.players.values()) {
        p.promptLocked = false;
        p.promptText = '';
        p.promptDraft = '';
        p.lockOrder = null;
        p.lockTs = null;
      }

      broadcast(r, { type: 'sync', sync: msg.sync || {} });
      roomUpdate(r);
      return;
    }
  });

  ws.on('close', () => {
    const roomCode = ws.__room;
    const r = roomCode ? rooms.get(roomCode) : null;
    if (!r) return;
    r.sockets.delete(id);
    r.players.delete(id);

    // re-host if host left
    if (r.hostId === id) {
      const next = r.sockets.keys().next().value || null;
      r.hostId = next;
      if (next && r.players.get(next)) r.players.get(next).role = 'host';
      broadcast(r, { type: 'system', text: next ? 'host migrated' : 'host left' });
      if (next) {
        // request host to sync everyone next time (optional)
      }
    }

    roomUpdate(r);
    cleanupRoomIfEmpty(r);
  });
});

server.listen(PORT, () => {
  console.log(`CYBERTERM MP relay listening on ws://localhost:${PORT}`);
});

