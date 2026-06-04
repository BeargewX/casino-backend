const supabase = require('../supabase');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

const rooms = {};

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank, value: RANK_VALUES[rank] });
  return deck.sort(() => Math.random() - 0.5);
}

function dealCards(deck, n) {
  return deck.splice(0, n);
}

function handRank(cards) {
  const all = [...cards];
  all.sort((a, b) => b.value - a.value);
  const ranks = all.map(c => c.value);
  const suits = all.map(c => c.suit);
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5;

  if (isFlush && isStraight && ranks[0] === 14) return [9, ranks];
  if (isFlush && isStraight) return [8, ranks];
  if (counts[0] === 4) return [7, ranks];
  if (counts[0] === 3 && counts[1] === 2) return [6, ranks];
  if (isFlush) return [5, ranks];
  if (isStraight) return [4, ranks];
  if (counts[0] === 3) return [3, ranks];
  if (counts[0] === 2 && counts[1] === 2) return [2, ranks];
  if (counts[0] === 2) return [1, ranks];
  return [0, ranks];
}

function bestHand(hole, community) {
  const all = [...hole, ...community];
  let best = null;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const five = all.filter((_, idx) => idx !== i && idx !== j);
    const rank = handRank(five);
    if (!best || rank[0] > best[0] || (rank[0] === best[0] && rank[1][0] > best[1][0])) best = rank;
  }
  return best;
}

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: [],
      deck: [],
      community: [],
      pot: 0,
      currentBet: 0,
      currentTurn: 0,
      phase: 'waiting',
      smallBlind: 50,
      bigBlind: 100,
      dealerIdx: 0,
    };
  }
  return rooms[roomId];
}

function startGame(room) {
  if (room.players.length < 2) return;
  room.deck = makeDeck();
  room.community = [];
  room.pot = 0;
  room.currentBet = room.bigBlind;
  room.phase = 'preflop';

  room.players.forEach(p => {
    p.hole = dealCards(room.deck, 2);
    p.bet = 0;
    p.folded = false;
    p.allIn = false;
  });

  const sbIdx = (room.dealerIdx + 1) % room.players.length;
  const bbIdx = (room.dealerIdx + 2) % room.players.length;
  room.players[sbIdx].bet = room.smallBlind;
  room.players[sbIdx].balance -= room.smallBlind;
  room.players[bbIdx].bet = room.bigBlind;
  room.players[bbIdx].balance -= room.bigBlind;
  room.pot = room.smallBlind + room.bigBlind;
  room.currentTurn = (bbIdx + 1) % room.players.length;
}

function nextPhase(room, io) {
  const active = room.players.filter(p => !p.folded);
  if (active.length === 1) return endGame(room, io);

  room.players.forEach(p => p.bet = 0);
  room.currentBet = 0;

  if (room.phase === 'preflop') {
    room.phase = 'flop';
    room.community.push(...dealCards(room.deck, 3));
  } else if (room.phase === 'flop') {
    room.phase = 'turn';
    room.community.push(...dealCards(room.deck, 1));
  } else if (room.phase === 'turn') {
    room.phase = 'river';
    room.community.push(...dealCards(room.deck, 1));
  } else if (room.phase === 'river') {
    return showdown(room, io);
  }

  room.currentTurn = (room.dealerIdx + 1) % room.players.length;
  while (room.players[room.currentTurn].folded) {
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
  }
  broadcastState(room, io);
}

function showdown(room, io) {
  room.phase = 'showdown';
  const active = room.players.filter(p => !p.folded);
  let winner = active[0];
  let winnerRank = bestHand(winner.hole, room.community);

  for (const p of active.slice(1)) {
    const rank = bestHand(p.hole, room.community);
    if (rank[0] > winnerRank[0] || (rank[0] === winnerRank[0] && rank[1][0] > winnerRank[1][0])) {
      winner = p;
      winnerRank = rank;
    }
  }

  winner.balance += room.pot;
  room.lastWinner = winner.username;
  room.lastPot = room.pot;

  supabase.from('transactions').insert({
    user_id: winner.userId,
    type: 'win',
    amount: room.pot,
    description: `Poker win: ${room.pot} chips`,
    balance_after: winner.balance,
  });

  broadcastState(room, io, true);

  setTimeout(() => {
    room.phase = 'waiting';
    room.dealerIdx = (room.dealerIdx + 1) % room.players.length;
    if (room.players.length >= 2) {
      startGame(room);
      broadcastState(room, io);
    }
  }, 5000);
}

function endGame(room, io) {
  const winner = room.players.find(p => !p.folded);
  if (winner) {
    winner.balance += room.pot;
    room.lastWinner = winner.username;
    room.lastPot = room.pot;
  }
  room.phase = 'waiting';
  broadcastState(room, io, true);

  setTimeout(() => {
    room.dealerIdx = (room.dealerIdx + 1) % room.players.length;
    if (room.players.length >= 2) {
      startGame(room);
      broadcastState(room, io);
    }
  }, 3000);
}

function broadcastState(room, io, reveal = false) {
  room.players.forEach((player, idx) => {
    const state = {
      phase: room.phase,
      community: room.community,
      pot: room.pot,
      currentBet: room.currentBet,
      currentTurn: room.currentTurn,
      lastWinner: room.lastWinner,
      lastPot: room.lastPot,
      players: room.players.map((p, i) => ({
        username: p.username,
        balance: p.balance,
        bet: p.bet,
        folded: p.folded,
        isMe: i === idx,
        hole: (i === idx || reveal) ? p.hole : p.hole?.map(() => ({ hidden: true })),
      })),
    };
    if (player.socketId) io.to(player.socketId).emit('game:state', state);
  });
}

module.exports = function setupPokerSocket(io) {
  const pokerNs = io.of('/poker');

  pokerNs.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const jwt = require('jsonwebtoken');
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  pokerNs.on('connection', (socket) => {
    const { id: userId, username } = socket.user;

    socket.on('room:join', async ({ roomId, buyIn = 1000 }) => {
      const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
      if (!user || user.balance < buyIn) {
        return socket.emit('error', 'Insufficient balance');
      }

      const room = getRoom(roomId);
      if (room.players.find(p => p.userId === userId)) {
        const existing = room.players.find(p => p.userId === userId);
        existing.socketId = socket.id;
        socket.join(roomId);
        return broadcastState(room, pokerNs);
      }

      if (room.players.length >= 8) return socket.emit('error', 'Room full');

      await supabase.from('users').update({ balance: user.balance - buyIn }).eq('id', userId);

      room.players.push({ userId, username, socketId: socket.id, balance: buyIn, hole: [], bet: 0, folded: false });
      socket.join(roomId);
      socket.roomId = roomId;

      if (room.players.length === 2 && room.phase === 'waiting') {
        startGame(room);
      }
      broadcastState(room, pokerNs);
    });

    socket.on('game:action', ({ action, amount }) => {
      const roomId = socket.roomId;
      if (!roomId) return;
      const room = rooms[roomId];
      if (!room) return;

      const playerIdx = room.players.findIndex(p => p.userId === userId);
      if (playerIdx !== room.currentTurn) return socket.emit('error', 'Not your turn');

      const player = room.players[playerIdx];

      if (action === 'fold') {
        player.folded = true;
      } else if (action === 'call') {
        const toCall = room.currentBet - player.bet;
        const actual = Math.min(toCall, player.balance);
        player.balance -= actual;
        player.bet += actual;
        room.pot += actual;
      } else if (action === 'raise') {
        const toCall = room.currentBet - player.bet;
        const total = toCall + (amount || room.bigBlind);
        const actual = Math.min(total, player.balance);
        player.balance -= actual;
        player.bet += actual;
        room.pot += actual;
        room.currentBet = player.bet;
      } else if (action === 'check') {
        if (player.bet < room.currentBet) return socket.emit('error', 'Cannot check');
      } else if (action === 'allin') {
        room.pot += player.balance;
        player.bet += player.balance;
        if (player.bet > room.currentBet) room.currentBet = player.bet;
        player.balance = 0;
        player.allIn = true;
      }

      let nextTurn = (room.currentTurn + 1) % room.players.length;
      let laps = 0;
      while ((room.players[nextTurn].folded || room.players[nextTurn].allIn) && laps < room.players.length) {
        nextTurn = (nextTurn + 1) % room.players.length;
        laps++;
      }

      const activePlayers = room.players.filter(p => !p.folded && !p.allIn);
      const allCalled = activePlayers.every(p => p.bet === room.currentBet || p.balance === 0);

      if (allCalled || activePlayers.length <= 1) {
        nextPhase(room, pokerNs);
      } else {
        room.currentTurn = nextTurn;
        broadcastState(room, pokerNs);
      }
    });

    socket.on('disconnect', () => {
      Object.values(rooms).forEach(room => {
        const idx = room.players.findIndex(p => p.userId === userId);
        if (idx !== -1) {
          room.players[idx].socketId = null;
        }
      });
    });
  });
};