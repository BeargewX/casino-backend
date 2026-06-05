const supabase = require('../supabase');
const jwt = require('jsonwebtoken');

// ─── Constants ───────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];
const TURN_SECONDS = 30;

const rooms = {};

// ─── Deck ────────────────────────────────────────────────────
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, value: RANK_VAL[r] });
  return d.sort(() => Math.random() - 0.5);
}
function deal(deck, n) { return deck.splice(0, n); }

// ─── Hand Evaluation ─────────────────────────────────────────
function evalFive(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const vals = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const groups = Object.values(counts).sort((a, b) => b - a);
  const isFlush = suits.every(s => s === suits[0]);

  // Normal straight
  const isStr = vals[0] - vals[4] === 4 && new Set(vals).size === 5;
  // Wheel A-2-3-4-5
  const isWheel = vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2;
  const isStraight = isStr || isWheel;
  // For wheel, high card is 5
  const strHigh = isWheel ? [5, 4, 3, 2, 1] : vals;

  if (isFlush && isStr && vals[0] === 14) return { rank: 9, tiebreak: vals, name: 'Royal Flush' };
  if (isFlush && isStraight) return { rank: 8, tiebreak: strHigh, name: 'Straight Flush' };
  if (groups[0] === 4) {
    const quad = Number(Object.keys(counts).find(k => counts[k] === 4));
    const kick = vals.filter(v => v !== quad);
    return { rank: 7, tiebreak: [quad, quad, quad, quad, ...kick], name: 'Four of a Kind' };
  }
  if (groups[0] === 3 && groups[1] === 2) {
    const trip = Number(Object.keys(counts).find(k => counts[k] === 3));
    const pair = Number(Object.keys(counts).find(k => counts[k] === 2));
    return { rank: 6, tiebreak: [trip, trip, trip, pair, pair], name: 'Full House' };
  }
  if (isFlush) return { rank: 5, tiebreak: vals, name: 'Flush' };
  if (isStraight) return { rank: 4, tiebreak: strHigh, name: 'Straight' };
  if (groups[0] === 3) {
    const trip = Number(Object.keys(counts).find(k => counts[k] === 3));
    const kicks = vals.filter(v => v !== trip).sort((a, b) => b - a);
    return { rank: 3, tiebreak: [trip, trip, trip, ...kicks], name: 'Three of a Kind' };
  }
  if (groups[0] === 2 && groups[1] === 2) {
    const pairs = Object.keys(counts).filter(k => counts[k] === 2).map(Number).sort((a, b) => b - a);
    const kick = vals.filter(v => v !== pairs[0] && v !== pairs[1]);
    return { rank: 2, tiebreak: [...pairs, ...pairs, ...kick], name: 'Two Pair' };
  }
  if (groups[0] === 2) {
    const pair = Number(Object.keys(counts).find(k => counts[k] === 2));
    const kicks = vals.filter(v => v !== pair).sort((a, b) => b - a);
    return { rank: 1, tiebreak: [pair, pair, ...kicks], name: 'One Pair' };
  }
  return { rank: 0, tiebreak: vals, name: 'High Card' };
}

function bestHand(hole, community) {
  const all = [...hole, ...community];
  let best = null;
  // Try all C(7,5) = 21 combos
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const five = all.filter((_, idx) => idx !== i && idx !== j);
      const ev = evalFive(five);
      if (!best || compareHands(ev, best) > 0) best = ev;
    }
  }
  return best;
}

// Returns >0 if a beats b, 0 if tie, <0 if b beats a
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.tiebreak.length; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

// ─── Room ────────────────────────────────────────────────────
function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: [],        // { userId, username, socketId, balance, hole, bet, folded, allIn, sittingOut }
      deck: [],
      community: [],
      pot: 0,
      sidePots: [],       // [{ amount, eligible: [userId] }]
      currentBet: 0,
      minRaise: 0,
      currentTurn: -1,
      phase: 'waiting',   // waiting | preflop | flop | turn | river | showdown
      smallBlind: 50,
      bigBlind: 100,
      dealerIdx: 0,
      sbIdx: -1,
      bbIdx: -1,
      lastAggressorIdx: -1,  // track who last raised
      lastWinner: null,
      lastPot: 0,
      lastHandResults: [],   // [{ username, hole, handName, won }]
      turnTimer: null,
      turnStartedAt: null,
      handNum: 0,
    };
  }
  return rooms[roomId];
}

// ─── Timer ───────────────────────────────────────────────────
function startTimer(room, io) {
  clearTimer(room);
  room.turnStartedAt = Date.now();
  room.turnTimer = setTimeout(() => {
    const player = room.players[room.currentTurn];
    if (player && !player.folded && !player.allIn) {
      console.log(`[Poker] Auto-fold: ${player.username} (timeout)`);
      player.folded = true;
      advanceTurn(room, io);
    }
  }, TURN_SECONDS * 1000);
}

function clearTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

// ─── Start Game ──────────────────────────────────────────────
function startGame(room) {
  const activePlayers = room.players.filter(p => p.balance > 0 && !p.sittingOut);
  if (activePlayers.length < 2) return;

  room.handNum++;
  room.deck = makeDeck();
  room.community = [];
  room.pot = 0;
  room.sidePots = [];
  room.currentBet = room.bigBlind;
  room.minRaise = room.bigBlind;
  room.phase = 'preflop';
  room.lastHandResults = [];
  room.lastWinner = null;

  // Only active players play; others sit out
  room.players.forEach(p => {
    if (p.balance > 0 && !p.sittingOut) {
      p.hole = deal(room.deck, 2);
      p.bet = 0;
      p.folded = false;
      p.allIn = false;
    } else {
      p.hole = [];
      p.folded = true;
      p.bet = 0;
      p.allIn = false;
    }
  });

  // Find dealer, SB, BB among active (non-folded) players
  const activeIdxs = room.players.map((p, i) => i).filter(i => !room.players[i].folded);

  // Advance dealer to next active
  let dIdx = room.dealerIdx;
  for (let i = 0; i < activeIdxs.length; i++) {
    dIdx = (dIdx + 1) % room.players.length;
    if (!room.players[dIdx].folded) break;
  }
  room.dealerIdx = dIdx;

  const getNext = (from) => {
    let idx = (from + 1) % room.players.length;
    let tries = 0;
    while (room.players[idx].folded && tries < room.players.length) {
      idx = (idx + 1) % room.players.length;
      tries++;
    }
    return idx;
  };

  room.sbIdx = getNext(room.dealerIdx);
  room.bbIdx = getNext(room.sbIdx);

  // Post blinds
  const postBlind = (idx, amount) => {
    const p = room.players[idx];
    const actual = Math.min(amount, p.balance);
    p.balance -= actual;
    p.bet = actual;
    room.pot += actual;
    if (p.balance === 0) p.allIn = true;
  };

  postBlind(room.sbIdx, room.smallBlind);
  postBlind(room.bbIdx, room.bigBlind);

  // First to act preflop = after BB
  room.currentTurn = getNext(room.bbIdx);
  // BB is last aggressor preflop (so BB gets option if no raise)
  room.lastAggressorIdx = room.bbIdx;
}

// ─── Advance Turn ────────────────────────────────────────────
function getNextActive(room, from) {
  let idx = (from + 1) % room.players.length;
  let tries = 0;
  while ((room.players[idx].folded || room.players[idx].allIn) && tries < room.players.length) {
    idx = (idx + 1) % room.players.length;
    tries++;
  }
  if (room.players[idx].folded || room.players[idx].allIn) return -1; // all done
  return idx;
}

function isBettingRoundOver(room) {
  const activePlayers = room.players.filter(p => !p.folded && !p.allIn);

  // If 0 or 1 can still act, round is over
  if (activePlayers.length <= 1) return true;

  // Everyone who can act must have called current bet
  const allCalled = activePlayers.every(p => p.bet === room.currentBet);
  if (!allCalled) return false;

  // We've gone all the way around back to last aggressor
  // nextTurn would be lastAggressor → round is over
  const next = getNextActive(room, room.currentTurn);
  if (next === -1) return true;
  if (next === room.lastAggressorIdx) return true;

  return false;
}

function advanceTurn(room, io) {
  clearTimer(room);

  // Check if only 1 player left
  const notFolded = room.players.filter(p => !p.folded);
  if (notFolded.length === 1) {
    return endGame(room, io);
  }

  if (isBettingRoundOver(room)) {
    return nextPhase(room, io);
  }

  // Find next player who can act
  const next = getNextActive(room, room.currentTurn);
  if (next === -1 || next === room.lastAggressorIdx) {
    return nextPhase(room, io);
  }

  room.currentTurn = next;
  broadcastState(room, io);
  startTimer(room, io);
}

// ─── Next Phase ──────────────────────────────────────────────
function nextPhase(room, io) {
  clearTimer(room);

  const notFolded = room.players.filter(p => !p.folded);
  if (notFolded.length === 1) return endGame(room, io);

  // Reset bets for new street
  room.players.forEach(p => p.bet = 0);
  room.currentBet = 0;
  room.minRaise = room.bigBlind;

  // All remaining are all-in → run out the board
  const canAct = room.players.filter(p => !p.folded && !p.allIn);

  if (room.phase === 'preflop') {
    room.phase = 'flop';
    room.community.push(...deal(room.deck, 3));
  } else if (room.phase === 'flop') {
    room.phase = 'turn';
    room.community.push(...deal(room.deck, 1));
  } else if (room.phase === 'turn') {
    room.phase = 'river';
    room.community.push(...deal(room.deck, 1));
  } else if (room.phase === 'river') {
    return showdown(room, io);
  }

  // If everyone is all-in, auto-advance
  if (canAct.length === 0) {
    broadcastState(room, io);
    setTimeout(() => nextPhase(room, io), 1500);
    return;
  }

  // First to act post-flop: first active after dealer
  const getNext = (from) => {
    let idx = (from + 1) % room.players.length;
    let tries = 0;
    while ((room.players[idx].folded || room.players[idx].allIn) && tries < room.players.length) {
      idx = (idx + 1) % room.players.length;
      tries++;
    }
    if (room.players[idx].folded || room.players[idx].allIn) return -1;
    return idx;
  };

  const first = getNext(room.dealerIdx);
  if (first === -1) {
    return showdown(room, io);
  }

  room.currentTurn = first;
  room.lastAggressorIdx = first; // first to act is default aggressor (so round completes after full orbit)

  broadcastState(room, io);
  startTimer(room, io);
}

// ─── Showdown ────────────────────────────────────────────────
function showdown(room, io) {
  clearTimer(room);
  room.phase = 'showdown';

  const active = room.players.filter(p => !p.folded);

  // Evaluate all hands
  const evaluated = active.map(p => ({
    ...p,
    handResult: bestHand(p.hole, room.community),
  }));

  // Sort by hand strength desc
  evaluated.sort((a, b) => compareHands(b.handResult, a.handResult));

  // Basic pot distribution (no side pot for simplicity of display, but handle ties)
  const best = evaluated[0].handResult;
  const winners = evaluated.filter(p => compareHands(p.handResult, best) === 0);
  const share = Math.floor(room.pot / winners.length);
  const remainder = room.pot - share * winners.length;

  winners.forEach((w, i) => {
    const actual = i === 0 ? share + remainder : share; // first winner gets remainder
    const player = room.players.find(p => p.userId === w.userId);
    if (player) player.balance += actual;
  });

  room.lastWinner = winners.map(w => w.username).join(', ');
  room.lastPot = room.pot;
  room.lastHandResults = evaluated.map(p => ({
    username: p.username,
    hole: p.hole,
    handName: p.handResult?.name || 'Unknown',
    won: winners.some(w => w.userId === p.userId),
  }));

  // Save to DB
  winners.forEach(w => {
    supabase.from('transactions').insert({
      user_id: w.userId,
      type: 'win',
      amount: share,
      description: `Poker: ${w.handResult?.name} wins ${share} chips`,
      balance_after: room.players.find(p => p.userId === w.userId)?.balance,
    });
  });

  broadcastState(room, io, true);

  // Auto next hand
  setTimeout(() => {
    room.phase = 'waiting';
    // Remove broke players
    room.players = room.players.filter(p => p.balance > 0);
    if (room.players.length >= 2) {
      startGame(room);
      broadcastState(room, io);
      if (room.phase !== 'waiting') startTimer(room, io);
    } else {
      broadcastState(room, io);
    }
  }, 6000);
}

// ─── End Game (fold win) ─────────────────────────────────────
function endGame(room, io) {
  clearTimer(room);
  const winner = room.players.find(p => !p.folded);
  if (winner) {
    winner.balance += room.pot;
    room.lastWinner = winner.username;
    room.lastPot = room.pot;
    room.lastHandResults = [{ username: winner.username, hole: winner.hole, handName: 'Fold Win', won: true }];

    supabase.from('transactions').insert({
      user_id: winner.userId,
      type: 'win',
      amount: room.pot,
      description: `Poker: wins ${room.pot} chips (others folded)`,
      balance_after: winner.balance,
    });
  }
  room.phase = 'showdown';
  broadcastState(room, io, true);

  setTimeout(() => {
    room.phase = 'waiting';
    room.players = room.players.filter(p => p.balance > 0);
    if (room.players.length >= 2) {
      startGame(room);
      broadcastState(room, io);
      if (room.phase !== 'waiting') startTimer(room, io);
    } else {
      broadcastState(room, io);
    }
  }, 4000);
}

// ─── Broadcast ───────────────────────────────────────────────
function broadcastState(room, io, reveal = false) {
  const timeLeft = room.turnStartedAt && room.phase !== 'waiting' && room.phase !== 'showdown'
    ? Math.max(0, TURN_SECONDS - Math.floor((Date.now() - room.turnStartedAt) / 1000))
    : null;

  room.players.forEach((player, idx) => {
    const myHand = !player.folded && player.hole?.length === 2 && room.community?.length >= 3
      ? bestHand(player.hole, room.community)
      : null;

    const state = {
      phase: room.phase,
      community: room.community,
      pot: room.pot,
      currentBet: room.currentBet,
      minRaise: room.minRaise,
      currentTurn: room.currentTurn,
      dealerIdx: room.dealerIdx,
      sbIdx: room.sbIdx,
      bbIdx: room.bbIdx,
      lastWinner: room.lastWinner,
      lastPot: room.lastPot,
      lastHandResults: reveal ? room.lastHandResults : [],
      timeLeft,
      handNum: room.handNum,
      players: room.players.map((p, i) => ({
        username: p.username,
        balance: p.balance,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        isMe: i === idx,
        isDealer: i === room.dealerIdx,
        isSB: i === room.sbIdx,
        isBB: i === room.bbIdx,
        hole: (i === idx || reveal) ? p.hole : p.hole?.map(() => ({ hidden: true })),
        handName: i === idx && myHand ? myHand.name : null,
        won: reveal ? room.lastHandResults?.find(r => r.username === p.username)?.won : null,
      })),
    };

    if (player.socketId) {
      try { io.to(player.socketId).emit('game:state', state); } catch {}
    }
  });
}

// ─── Setup ───────────────────────────────────────────────────
module.exports = function setupPokerSocket(io) {
  const pokerNs = io.of('/poker');

  // Auth middleware
  pokerNs.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  pokerNs.on('connection', (socket) => {
    const { id: userId, username } = socket.user;

    // ── Join Room ──
    socket.on('room:join', async ({ roomId, buyIn = 1000 }) => {
      try {
        const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (!user || user.balance < buyIn) {
          return socket.emit('error', 'ยอดเงินไม่พอ');
        }

        const room = getRoom(roomId);

        // Reconnect existing player
        const existing = room.players.find(p => p.userId === userId);
        if (existing) {
          existing.socketId = socket.id;
          socket.join(roomId);
          socket.roomId = roomId;
          return broadcastState(room, pokerNs);
        }

        if (room.players.length >= 8) return socket.emit('error', 'ห้องเต็มแล้ว');

        // Deduct balance
        await supabase.from('users').update({ balance: user.balance - buyIn }).eq('id', userId);

        // If game in progress, sit out until next hand
        const sittingOut = room.phase !== 'waiting';

        room.players.push({
          userId, username,
          socketId: socket.id,
          balance: buyIn,
          hole: [], bet: 0,
          folded: sittingOut,
          allIn: false,
          sittingOut,
        });

        socket.join(roomId);
        socket.roomId = roomId;

        if (sittingOut) {
          socket.emit('info', 'รอรอบถัดไป...');
        }

        // Start if enough players
        if (room.phase === 'waiting' && room.players.filter(p => p.balance > 0).length >= 2) {
          startGame(room);
          broadcastState(room, pokerNs);
          if (room.phase !== 'waiting') startTimer(room, io);
        } else {
          broadcastState(room, pokerNs);
        }
      } catch (err) {
        console.error('[Poker] join error:', err);
        socket.emit('error', 'เกิดข้อผิดพลาด');
      }
    });

    // ── Action ──
    socket.on('game:action', ({ action, amount }) => {
      const roomId = socket.roomId;
      if (!roomId) return;
      const room = rooms[roomId];
      if (!room) return;

      // Guard: only valid phases
      if (!['preflop', 'flop', 'turn', 'river'].includes(room.phase)) return;

      const playerIdx = room.players.findIndex(p => p.userId === userId);
      if (playerIdx === -1) return;
      if (playerIdx !== room.currentTurn) return socket.emit('error', 'ยังไม่ถึงตาคุณ');

      const player = room.players[playerIdx];
      if (player.folded || player.allIn) return;

      clearTimer(room);

      if (action === 'fold') {
        player.folded = true;

      } else if (action === 'check') {
        if (player.bet < room.currentBet) return socket.emit('error', 'ไม่สามารถ Check ได้ ต้อง Call หรือ Fold');

      } else if (action === 'call') {
        const toCall = Math.min(room.currentBet - player.bet, player.balance);
        player.balance -= toCall;
        player.bet += toCall;
        room.pot += toCall;
        if (player.balance === 0) player.allIn = true;

      } else if (action === 'raise') {
        const minTotal = room.currentBet + room.minRaise;
        const raiseTotal = Math.max(minTotal, Math.min(amount || minTotal, player.balance + player.bet));
        const raiseBy = raiseTotal - player.bet;
        const actual = Math.min(raiseBy, player.balance);

        player.balance -= actual;
        player.bet += actual;
        room.pot += actual;

        // Update min raise = size of this raise
        room.minRaise = Math.max(room.bigBlind, player.bet - room.currentBet);
        room.currentBet = Math.max(room.currentBet, player.bet);
        room.lastAggressorIdx = playerIdx;

        if (player.balance === 0) player.allIn = true;

      } else if (action === 'allin') {
        const allInAmount = player.balance;
        player.bet += allInAmount;
        room.pot += allInAmount;
        player.balance = 0;
        player.allIn = true;
        if (player.bet > room.currentBet) {
          room.minRaise = Math.max(room.bigBlind, player.bet - room.currentBet);
          room.currentBet = player.bet;
          room.lastAggressorIdx = playerIdx;
        }
      } else {
        return socket.emit('error', 'Action ไม่ถูกต้อง');
      }

      advanceTurn(room, pokerNs);
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
      const roomId = socket.roomId;
      if (!roomId) return;
      const room = rooms[roomId];
      if (!room) return;

      const idx = room.players.findIndex(p => p.userId === userId);
      if (idx === -1) return;

      room.players[idx].socketId = null;

      // If it's their turn, auto-fold
      if (idx === room.currentTurn && ['preflop','flop','turn','river'].includes(room.phase)) {
        console.log(`[Poker] Auto-fold on disconnect: ${username}`);
        room.players[idx].folded = true;
        advanceTurn(room, pokerNs);
      }
    });
  });
};