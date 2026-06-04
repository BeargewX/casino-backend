const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

// Middleware: admin only
const adminOnly = async (req, res, next) => {
  const { data: user } = await supabase.from('users').select('is_admin').eq('id', req.user.id).single();
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
};

// Get all users
router.get('/users', authenticate, adminOnly, async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('id, username, balance, is_admin, created_at')
    .order('created_at', { ascending: false });
  res.json(data || []);
});

// Add/remove balance
router.post('/users/:id/balance', authenticate, adminOnly, async (req, res) => {
  const { amount, note } = req.body;
  const { data: user } = await supabase.from('users').select('balance, username').eq('id', req.params.id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newBalance = Math.max(0, user.balance + amount);
  await supabase.from('users').update({ balance: newBalance }).eq('id', req.params.id);
  await supabase.from('transactions').insert({
    user_id: req.params.id,
    type: amount > 0 ? 'admin_add' : 'admin_remove',
    amount,
    description: note || (amount > 0 ? 'Admin เติมเงิน' : 'Admin หักเงิน'),
    balance_after: newBalance,
  });
  res.json({ balance: newBalance });
});

// Reset balance
router.post('/users/:id/reset', authenticate, adminOnly, async (req, res) => {
  const { amount = 10000 } = req.body;
  await supabase.from('users').update({ balance: amount }).eq('id', req.params.id);
  await supabase.from('transactions').insert({
    user_id: req.params.id,
    type: 'admin_reset',
    amount,
    description: `Admin รีเซ็ตเงินเป็น ${amount}`,
    balance_after: amount,
  });
  res.json({ balance: amount });
});

// Toggle admin
router.post('/users/:id/toggle-admin', authenticate, adminOnly, async (req, res) => {
  const { data: user } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single();
  const newVal = !user?.is_admin;
  await supabase.from('users').update({ is_admin: newVal }).eq('id', req.params.id);
  res.json({ is_admin: newVal });
});

// Get stats
router.get('/stats', authenticate, adminOnly, async (req, res) => {
  const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: betCount } = await supabase.from('bets').select('*', { count: 'exact', head: true });
  const { data: txData } = await supabase.from('transactions').select('amount').eq('type', 'win');
  const totalWon = txData?.reduce((a, b) => a + (b.amount || 0), 0) || 0;
  res.json({ userCount, betCount, totalWon });
});

// Get all bets
router.get('/bets', authenticate, adminOnly, async (req, res) => {
  const { data } = await supabase
    .from('bets')
    .select('*, users(username)')
    .order('created_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

// Settle bet (mark won/lost)
router.post('/bets/:id/settle', authenticate, adminOnly, async (req, res) => {
  const { result } = req.body; // 'won' or 'lost'
  const { data: bet } = await supabase.from('bets').select('*').eq('id', req.params.id).single();
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  if (bet.status !== 'pending') return res.status(400).json({ error: 'Already settled' });

  await supabase.from('bets').update({ status: result }).eq('id', req.params.id);

  if (result === 'won') {
    const { data: user } = await supabase.from('users').select('balance').eq('id', bet.user_id).single();
    const newBalance = user.balance + bet.potential_win;
    await supabase.from('users').update({ balance: newBalance }).eq('id', bet.user_id);
    await supabase.from('transactions').insert({
      user_id: bet.user_id,
      type: 'win',
      amount: bet.potential_win,
      description: `ชนะเดิมพัน: ${bet.selection}`,
      balance_after: newBalance,
    });
  }
  res.json({ success: true });
});

module.exports = { router, adminOnly };
