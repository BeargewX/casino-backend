const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');

router.get('/balance', authenticate, async (req, res) => {
  const { data } = await supabase.from('users').select('balance').eq('id', req.user.id).single();
  res.json({ balance: data?.balance ?? 0 });
});

router.get('/history', authenticate, async (req, res) => {
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  res.json(data || []);
});

module.exports = router;
