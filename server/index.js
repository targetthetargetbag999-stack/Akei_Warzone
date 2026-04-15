require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const { Match, STATES } = require('./match');
const { LOBBY } = require('./constants');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 10000,
  pingInterval: 5000,
});

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log('✅ Supabase connected');
} else {
  console.warn('⚠️  No Supabase credentials — match results will not be persisted');
}

const matches = {};
const playerMatch = {};

function getOrCreateLobby() {
  for (const [id, match] of Object.entries(matches)) {
    if (match.state === STATES.LOBBY && match.playerCount < LOBBY.MAX_PLAYERS) return match;
    if (match.state === STATES.COUNTDOWN && match.playerCount < LOBBY.MAX_PLAYERS) return match;
  }
  const id = uuidv4().slice(0, 8);
  matches[id] = new Match(io, id, supabase);
  console.log(`🎮 New match created: ${id}`);
  return matches[id];
}

app.get('/health', (_, res) => res.json({ ok: true, matches: Object.keys(matches).length }));

app.get('/leaderboard', async (req, res) => {
  if (!supabase) return res.json({ error: 'Supabase not configured' });
  const { data, error } = await supabase
    .from('player_stats')
    .select('username, wins, kills, matches_played')
    .order('wins', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);
  socket.on('joinGame', ({ username }) => {
    const name = (username || 'Player').slice(0, 20).replace(/[^a-zA-Z0-9_\- ]/g, '');
    const match = getOrCreateLobby();
    playerMatch[socket.id] = match.id;
    match.addPlayer(socket, name);
    console.log(`👤 ${name} joined match ${match.id} (${match.playerCount} players)`);
  });
  socket.on('move', (data) => {
    const matchId = playerMatch[socket.id];
    if (matchId && matches[matchId]) matches[matchId].handleMove(socket.id, data);
  });
  socket.on('shoot', (data) => {
    const matchId = playerMatch[socket.id];
    if (matchId && matches[matchId]) matches[matchId].handleShoot(socket.id, data);
  });
  socket.on('reload', () => {
    const matchId = playerMatch[socket.id];
    if (matchId && matches[matchId]) matches[matchId].handleReload(socket.id);
  });
  socket.on('pickup', ({ itemId }) => {
    const matchId = playerMatch[socket.id];
    if (matchId && matches[matchId]) matches[matchId].handlePickup(socket.id, itemId);
  });
  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    const matchId = playerMatch[socket.id];
    if (matchId && matches[matchId]) {
      matches[matchId].removePlayer(socket.id);
      if (matches[matchId].state === STATES.ENDED || matches[matchId].playerCount === 0) {
        setTimeout(() => delete matches[matchId], 5000);
      }
    }
    delete playerMatch[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Battle Royale server running on port ${PORT}`));
