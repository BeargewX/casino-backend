const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

router.post('/place', authenticate, async (req, res) => {
  const { match_id, market, selection, odds, amount } = req.body;
  if (!match_id || !market || !selection || !odds || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid bet data' });
  }

  const { data: user } = await supabase.from('users').select('balance').eq('id', req.user.id).single();
  if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  const newBalance = user.balance - amount;
  await supabase.from('users').update({ balance: newBalance }).eq('id', req.user.id);

  const { data: bet } = await supabase.from('bets').insert({
    user_id: req.user.id,
    match_id,
    market,
    selection,
    odds,
    amount,
    potential_win: Math.floor(amount * odds),
    status: 'pending',
  }).select().single();

  await supabase.from('transactions').insert({
    user_id: req.user.id,
    type: 'bet',
    amount: -amount,
    description: `Bet: ${selection} @ ${odds}`,
    balance_after: newBalance,
  });

  res.json({ bet, balance: newBalance });
});

router.get('/my', authenticate, async (req, res) => {
  const { data } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  res.json(data || []);
});

module.exports = router;
