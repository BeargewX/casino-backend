const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

// ─── Symbol Pools ─────────────────────────────────────────────
// Balanced pool - skull reduced significantly
const NORMAL_POOL = [
  'skull','skull','skull',           // 3  (rare)
  'shield','shield','shield','shield', // 4
  'sword','sword','sword','sword','sword', // 5
  'coin','coin','coin','coin','coin','coin', // 6
  'fire','fire','fire','fire','fire','fire','fire', // 7
  'gem','gem','gem','gem','gem','gem','gem','gem', // 8
  'dragon','dragon', // 2 Wild
]
// Total 35 — dragon=5.7%, gem=22.8%, fire=20%, coin=17%, skull=8.5%

const SCATTER_CHANCE = 0.05  // 5% per cell in normal spin
const EGG_CHANCE     = 0.025 // 2.5% per cell in free spins

const EGG_POOL = [
  { sym: 'egg_red',     mult: 2,    w: 100 },
  { sym: 'egg_gold',    mult: 5,    w: 35  },
  { sym: 'egg_silver',  mult: 10,   w: 12  },
  { sym: 'egg_emerald', mult: 50,   w: 3   },
  { sym: 'egg_dragon',  mult: 1000, w: 1   },
]
const EGG_TOTAL = EGG_POOL.reduce((a, b) => a + b.w, 0)

// Payouts for 3/4/5 matching in a payline
const PAY = {
  dragon:  { 3:75,  4:300, 5:1000 },
  gem:     { 3:25,  4:100, 5:400  },
  fire:    { 3:15,  4:60,  5:200  },
  coin:    { 3:8,   4:30,  5:100  },
  sword:   { 3:5,   4:15,  5:50   },
  shield:  { 3:3,   4:10,  5:30   },
  skull:   { 3:2,   4:6,   5:15   },
}

const WILD    = 'dragon'
const SCATTER = 'scatter'

// ─── Helpers ─────────────────────────────────────────────────
function randPool(pool) { return pool[Math.floor(Math.random() * pool.length)] }

function randEgg() {
  let r = Math.random() * EGG_TOTAL
  for (const e of EGG_POOL) { r -= e.w; if (r <= 0) return e }
  return EGG_POOL[0]
}

// Generate 5x5 grid: grid[col][row]
function makeGrid(isFS = false) {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => {
      if (isFS && Math.random() < EGG_CHANCE) {
        const e = randEgg(); return { sym: e.sym, mult: e.mult }
      }
      if (!isFS && Math.random() < SCATTER_CHANCE) return { sym: SCATTER }
      return { sym: randPool(NORMAL_POOL) }
    })
  )
}

// ─── Paylines ─────────────────────────────────────────────────
// Returns array of lines, each line = array of {sym, col, row}
function buildPaylines(grid) {
  const c = (col, row) => ({ ...grid[col][row], col, row })
  return [
    // 5 horizontals
    [c(0,0),c(1,0),c(2,0),c(3,0),c(4,0)],
    [c(0,1),c(1,1),c(2,1),c(3,1),c(4,1)],
    [c(0,2),c(1,2),c(2,2),c(3,2),c(4,2)],
    [c(0,3),c(1,3),c(2,3),c(3,3),c(4,3)],
    [c(0,4),c(1,4),c(2,4),c(3,4),c(4,4)],
    // Diagonals
    [c(0,0),c(1,1),c(2,2),c(3,3),c(4,4)],
    [c(0,4),c(1,3),c(2,2),c(3,1),c(4,0)],
    // V shapes
    [c(0,0),c(1,2),c(2,4),c(3,2),c(4,0)],
    [c(0,4),c(1,2),c(2,0),c(3,2),c(4,4)],
    // W shapes
    [c(0,0),c(1,1),c(2,0),c(3,1),c(4,0)],
    [c(0,4),c(1,3),c(2,4),c(3,3),c(4,4)],
    [c(0,2),c(1,0),c(2,2),c(3,0),c(4,2)],
    [c(0,2),c(1,4),c(2,2),c(3,4),c(4,2)],
    // Zigzags
    [c(0,0),c(1,1),c(2,2),c(3,1),c(4,0)],
    [c(0,4),c(1,3),c(2,2),c(3,3),c(4,4)],
    [c(0,1),c(1,0),c(2,1),c(3,0),c(4,1)],
    [c(0,3),c(1,4),c(2,3),c(3,4),c(4,3)],
    // Edges
    [c(0,0),c(1,0),c(2,1),c(3,0),c(4,0)],
    [c(0,4),c(1,4),c(2,3),c(3,4),c(4,4)],
    [c(0,2),c(1,1),c(2,0),c(3,1),c(4,2)],
  ]
}

function evalLine(line) {
  const syms = line.map(c => c.sym)
  if (syms[0] === SCATTER) return null
  const first = syms[0] === WILD ? syms.find(s => s !== WILD && s !== SCATTER) || WILD : syms[0]
  let count = 0
  for (const s of syms) {
    if (s === first || s === WILD) count++
    else break
  }
  if (count < 3) return null
  const mult = PAY[first]?.[count] || 0
  if (!mult) return null
  return { sym: first, count, mult, cells: line.slice(0, count).map(c => `${c.col},${c.row}`) }
}

function evalGrid(grid, bet, freeMult = 1) {
  const paylines = buildPaylines(grid)
  const wins = []
  const winCells = new Set()

  paylines.forEach((line, idx) => {
    const result = evalLine(line)
    if (result) {
      const win = Math.floor(bet * result.mult * freeMult)
      wins.push({ line: idx, ...result, win })
      result.cells.forEach(c => winCells.add(c))
    }
  })

  // Scatter count (anywhere in grid)
  let scatters = 0
  grid.forEach(col => col.forEach(cell => { if (cell.sym === SCATTER) scatters++ }))

  // Egg multiplier (free spins only)
  let eggMult = 1
  const eggs = []
  grid.forEach((col, ci) => col.forEach((cell, ri) => {
    if (cell.sym?.startsWith('egg_')) {
      eggMult *= (cell.mult || 1)
      eggs.push({ col: ci, row: ri, sym: cell.sym, mult: cell.mult })
    }
  }))

  const baseWin = wins.reduce((a, b) => a + b.win, 0)
  const totalWin = Math.floor(baseWin * eggMult)
  return { wins, totalWin, scatters, eggMult, eggs, winCells: [...winCells] }
}

// ─── Routes ──────────────────────────────────────────────────
router.post('/spin', authenticate, async (req, res) => {
  const { amount } = req.body
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum bet is 10' })
  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single()
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' })

  const grid = makeGrid(false)
  const { wins, totalWin, scatters, eggs } = evalGrid(grid, amount, 1)

  let freeSpinsAwarded = 0
  if (scatters >= 5)      freeSpinsAwarded = 25
  else if (scatters >= 4) freeSpinsAwarded = 15
  else if (scatters >= 3) freeSpinsAwarded = 10

  const net = totalWin - amount
  const newBal = user.balance + net
  await supabase.from('users').update({ balance: newBal }).eq('id', req.user.id)
  await supabase.from('transactions').insert({
    user_id: req.user.id, type: net >= 0 ? 'win' : 'loss', amount: net,
    description: `Slots: ${wins.map(w=>`${w.sym}x${w.count}`).join(',') || 'no win'}${freeSpinsAwarded ? ` +${freeSpinsAwarded}FS` : ''}`,
    balance_after: newBal,
  })
  res.json({ grid, wins, totalWin, net, balance: newBal, scatters, freeSpinsAwarded, eggs, winCells: [...new Set(wins.flatMap(w=>w.cells))] })
})

router.post('/freespin', authenticate, async (req, res) => {
  const { amount, freeMult = 2 } = req.body
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum bet is 10' })
  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single()
  if (!user) return res.status(404).json({ error: 'User not found' })

  const grid = makeGrid(true)
  const { wins, totalWin, scatters, eggMult, eggs } = evalGrid(grid, amount, freeMult)

  let retrigger = 0
  if (scatters >= 5)      retrigger = 15
  else if (scatters >= 4) retrigger = 10
  else if (scatters >= 3) retrigger = 5

  const newBal = totalWin > 0 ? user.balance + totalWin : user.balance
  if (totalWin > 0) {
    await supabase.from('users').update({ balance: newBal }).eq('id', req.user.id)
    await supabase.from('transactions').insert({
      user_id: req.user.id, type: 'win', amount: totalWin,
      description: `FreeSpin x${freeMult}${eggMult>1?` Egg x${eggMult}`:''}`,
      balance_after: newBal,
    })
  }
  res.json({ grid, wins, totalWin, net: totalWin, balance: newBal, scatters, eggMult, eggs, retrigger, winCells: [...new Set(wins.flatMap(w=>w.cells))] })
})

module.exports = router