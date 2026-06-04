const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

// 5-reel dragon slots
// RTP ~70% — house edge 30%
// Pool weighted heavily toward low symbols
const POOL = [
  'skull','skull','skull','skull','skull','skull','skull','skull','skull','skull','skull','skull', // 12
  'shield','shield','shield','shield','shield','shield','shield','shield',                          // 8
  'sword','sword','sword','sword','sword','sword',                                                  // 6
  'coin','coin','coin','coin','coin',                                                               // 5
  'fire','fire','fire','fire',                                                                      // 4
  'gem','gem','gem',                                                                                // 3
  'dragon','dragon',                                                                                // 2 (~5% per reel)
]
// Total 40 entries → dragon = 2/40 = 5% per reel
// 5 dragons in a row = 0.05^5 = 1 in 3.2 million spins 😂

// Payouts per symbol for 3,4,5 in a row
const PAYOUTS = {
  dragon: { 3: 50,  4: 200,  5: 1000 },
  gem:    { 3: 20,  4: 80,   5: 300  },
  fire:   { 3: 10,  4: 40,   5: 150  },
  coin:   { 3: 5,   4: 20,   5: 75   },
  sword:  { 3: 3,   4: 10,   5: 40   },
  shield: { 3: 2,   4: 6,    5: 20   },
  skull:  { 3: 1,   4: 3,    5: 10   },
}

// Wild = dragon substitutes any symbol
const WILD = 'dragon'

function randSym() {
  return POOL[Math.floor(Math.random() * POOL.length)]
}

function spinReels() {
  // 5 reels x 3 rows
  return Array.from({ length: 5 }, () => [randSym(), randSym(), randSym()])
}

// Check paylines on 5x3 grid
// Paylines: top row, middle row, bottom row, diagonal ↘, diagonal ↗
function getPaylines(grid) {
  return [
    [grid[0][0], grid[1][0], grid[2][0], grid[3][0], grid[4][0]], // top
    [grid[0][1], grid[1][1], grid[2][1], grid[3][1], grid[4][1]], // middle
    [grid[0][2], grid[1][2], grid[2][2], grid[3][2], grid[4][2]], // bottom
    [grid[0][0], grid[1][1], grid[2][2], grid[3][1], grid[4][0]], // V shape
    [grid[0][2], grid[1][1], grid[2][0], grid[3][1], grid[4][2]], // ^ shape
  ]
}

function calcLinePayout(line) {
  // Find leading symbol (ignore wild at start)
  let sym = line[0] === WILD ? line.find(s => s !== WILD) || WILD : line[0]
  let count = 0
  for (const s of line) {
    if (s === sym || s === WILD) count++
    else break
  }
  if (count < 3) return { mult: 0, sym, count }
  const mult = PAYOUTS[sym]?.[count] || 0
  return { mult, sym, count }
}

function calcTotalPayout(grid, bet) {
  const paylines = getPaylines(grid)
  let totalMult = 0
  const wins = []

  paylines.forEach((line, idx) => {
    const { mult, sym, count } = calcLinePayout(line)
    if (mult > 0) {
      totalMult += mult
      wins.push({ line: idx, sym, count, mult, win: Math.floor(bet * mult) })
    }
  })

  return { totalMult, wins, totalWin: Math.floor(bet * totalMult) }
}

router.post('/spin', authenticate, async (req, res) => {
  const { amount } = req.body
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum bet is 10' })

  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single()
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' })

  const grid = spinReels()
  const { totalWin, wins } = calcTotalPayout(grid, amount)
  const net = totalWin - amount
  const newBalance = user.balance + net

  await supabase.from('users').update({ balance: newBalance }).eq('id', req.user.id)
  await supabase.from('transactions').insert({
    user_id: req.user.id,
    type: totalWin > 0 ? 'win' : 'loss',
    amount: net,
    description: `Slots 5x3: ${wins.map(w => `${w.sym}x${w.count}`).join(', ') || 'no win'}`,
    balance_after: newBalance,
  })

  res.json({ grid, wins, totalWin, net, balance: newBalance })
})

module.exports = router;
