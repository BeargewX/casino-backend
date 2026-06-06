const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

// ─── Symbol Pool ──────────────────────────────────────────────
// 5x5 grid, 25 symbols per spin
// RTP ~70% — house edge 30%
const NORMAL_POOL = [
  'skull','skull','skull','skull','skull','skull','skull','skull','skull','skull','skull','skull', // 12
  'shield','shield','shield','shield','shield','shield','shield','shield',                          // 8
  'sword','sword','sword','sword','sword','sword',                                                  // 6
  'coin','coin','coin','coin','coin',                                                               // 5
  'fire','fire','fire','fire',                                                                      // 4
  'gem','gem','gem',                                                                                // 3
  'dragon',                                                                                         // 1 Wild
]

// Scatter pool (only during normal spin, not free spins)
const SCATTER_CHANCE = 0.04 // 4% per cell = ~1 scatter per spin avg

// Egg pool (only during free spins)
const EGG_POOL = [
  { sym: 'egg_red',     mult: 2,    weight: 100 },
  { sym: 'egg_gold',    mult: 5,    weight: 30  },
  { sym: 'egg_silver',  mult: 10,   weight: 12  },
  { sym: 'egg_emerald', mult: 50,   weight: 3   },
  { sym: 'egg_dragon',  mult: 1000, weight: 1   },
]
const EGG_TOTAL = EGG_POOL.reduce((a, b) => a + b.weight, 0) // 146
const EGG_SPAWN_CHANCE = 0.015 // 1.5% per cell during free spins

// Payouts: min 3 in a row on a payline
const PAYOUTS = {
  dragon:  { 3: 50,  4: 200,  5: 500  },
  gem:     { 3: 20,  4: 80,   5: 200  },
  fire:    { 3: 10,  4: 40,   5: 100  },
  coin:    { 3: 5,   4: 15,   5: 50   },
  sword:   { 3: 3,   4: 10,   5: 30   },
  shield:  { 3: 2,   4: 6,    5: 15   },
  skull:   { 3: 1,   4: 3,    5: 8    },
  scatter: { 3: 0,   4: 0,    5: 0    }, // scatter doesn't pay itself
}

const WILD = 'dragon'
const SCATTER = 'scatter'

// ─── Helpers ─────────────────────────────────────────────────
function randFrom(pool) {
  return pool[Math.floor(Math.random() * pool.length)]
}

function randEgg() {
  let r = Math.random() * EGG_TOTAL
  for (const e of EGG_POOL) {
    r -= e.weight
    if (r <= 0) return e
  }
  return EGG_POOL[0]
}

// Generate 5x5 grid
// grid[col][row] = symbol
function spinGrid(isFreeSpins = false) {
  const grid = []
  for (let col = 0; col < 5; col++) {
    const column = []
    for (let row = 0; row < 5; row++) {
      // During free spins: eggs can appear instead of normal symbols
      if (isFreeSpins && Math.random() < EGG_SPAWN_CHANCE) {
        column.push({ sym: randEgg().sym, mult: randEgg().mult })
      } else if (!isFreeSpins && Math.random() < SCATTER_CHANCE) {
        column.push({ sym: SCATTER })
      } else {
        column.push({ sym: randFrom(NORMAL_POOL) })
      }
    }
    grid.push(column)
  }
  return grid
}

// 25 paylines for 5x5:
// Rows 0-4 (5 horizontal)
// Diagonals and V-shapes (20 more)
function getPaylines(grid) {
  const lines = []

  // 5 horizontal rows
  for (let row = 0; row < 5; row++) {
    lines.push(grid.map(col => col[row]))
  }

  // V shapes
  lines.push([grid[0][0], grid[1][1], grid[2][2], grid[3][1], grid[4][0]])
  lines.push([grid[0][4], grid[1][3], grid[2][2], grid[3][3], grid[4][4]])
  lines.push([grid[0][1], grid[1][2], grid[2][3], grid[3][2], grid[4][1]])
  lines.push([grid[0][3], grid[1][2], grid[2][1], grid[3][2], grid[4][3]])

  // Diagonal ↘
  lines.push([grid[0][0], grid[1][1], grid[2][2], grid[3][3], grid[4][4]])
  // Diagonal ↗
  lines.push([grid[0][4], grid[1][3], grid[2][2], grid[3][1], grid[4][0]])

  // Zigzag patterns
  lines.push([grid[0][0], grid[1][2], grid[2][4], grid[3][2], grid[4][0]])
  lines.push([grid[0][4], grid[1][2], grid[2][0], grid[3][2], grid[4][4]])
  lines.push([grid[0][1], grid[1][0], grid[2][1], grid[3][0], grid[4][1]])
  lines.push([grid[0][3], grid[1][4], grid[2][3], grid[3][4], grid[4][3]])

  return lines
}

function calcLinePayout(line) {
  const cells = line.map(c => c.sym || c)
  // Find leading symbol
  const first = cells[0] === WILD ? cells.find(s => s !== WILD && s !== SCATTER) || WILD : cells[0]
  if (first === SCATTER) return { mult: 0, sym: SCATTER, count: 0 }

  let count = 0
  for (const s of cells) {
    if (s === first || s === WILD) count++
    else break
  }

  if (count < 3) return { mult: 0, sym: first, count }
  const mult = PAYOUTS[first]?.[count] || 0
  return { mult, sym: first, count }
}

function calcGrid(grid, bet, isFreeSpins = false, freeMult = 1) {
  const paylines = getPaylines(grid)
  let totalMult = 0
  const wins = []

  paylines.forEach((line, idx) => {
    const { mult, sym, count } = calcLinePayout(line)
    if (mult > 0) {
      const winAmt = Math.floor(bet * mult * freeMult)
      totalMult += mult
      wins.push({ line: idx, sym, count, mult, win: winAmt })
    }
  })

  // Count scatters anywhere in grid
  let scatterCount = 0
  grid.forEach(col => col.forEach(cell => {
    if ((cell.sym || cell) === SCATTER) scatterCount++
  }))

  // Count eggs and total egg multiplier (free spins only)
  let eggMult = 1
  const eggs = []
  if (isFreeSpins) {
    grid.forEach((col, ci) => col.forEach((cell, ri) => {
      if (cell.sym?.startsWith('egg_')) {
        eggMult *= cell.mult || 1
        eggs.push({ col: ci, row: ri, sym: cell.sym, mult: cell.mult })
      }
    }))
  }

  const totalWin = wins.reduce((a, b) => a + b.win, 0) * eggMult
  return { wins, totalMult, totalWin: Math.floor(totalWin), scatterCount, eggMult, eggs }
}

// ─── Routes ──────────────────────────────────────────────────
router.post('/spin', authenticate, async (req, res) => {
  const { amount } = req.body
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum bet is 10' })

  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single()
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' })

  const grid = spinGrid(false)
  const { wins, totalWin, scatterCount, eggs } = calcGrid(grid, amount, false, 1)

  // Free spins trigger
  let freeSpinsAwarded = 0
  if (scatterCount >= 3) {
    freeSpinsAwarded = scatterCount === 3 ? 10 : scatterCount === 4 ? 15 : 25
  }

  const net = totalWin - amount
  const newBalance = user.balance + net

  await supabase.from('users').update({ balance: newBalance }).eq('id', req.user.id)
  await supabase.from('transactions').insert({
    user_id: req.user.id,
    type: totalWin > 0 ? 'win' : 'loss',
    amount: net,
    description: `Slots 5x5: ${wins.length > 0 ? wins.map(w => `${w.sym}x${w.count}`).join(',') : 'no win'}${freeSpinsAwarded ? ` +${freeSpinsAwarded}FS` : ''}`,
    balance_after: newBalance,
  })

  res.json({ grid, wins, totalWin, net, balance: newBalance, scatterCount, freeSpinsAwarded, eggs })
})

// Free spins spin endpoint
router.post('/freespin', authenticate, async (req, res) => {
  const { amount, freeMult = 2 } = req.body
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum bet is 10' })

  // Free spins don't deduct balance per spin
  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single()
  if (!user) return res.status(404).json({ error: 'User not found' })

  const grid = spinGrid(true) // eggs can appear
  const { wins, totalWin, scatterCount, eggMult, eggs } = calcGrid(grid, amount, true, freeMult)

  // Retrigger free spins
  let retrigger = 0
  if (scatterCount >= 3) {
    retrigger = scatterCount === 3 ? 5 : scatterCount === 4 ? 10 : 15
  }

  const newBalance = user.balance + totalWin

  if (totalWin > 0) {
    await supabase.from('users').update({ balance: newBalance }).eq('id', req.user.id)
    await supabase.from('transactions').insert({
      user_id: req.user.id,
      type: 'win',
      amount: totalWin,
      description: `Free Spin x${freeMult}${eggMult > 1 ? ` 🥚x${eggMult}` : ''}: +${totalWin}`,
      balance_after: newBalance,
    })
  }

  res.json({
    grid, wins, totalWin, net: totalWin,
    balance: totalWin > 0 ? newBalance : user.balance,
    scatterCount, eggMult, eggs, retrigger,
    isFreeSpins: true,
  })
})

module.exports = router;