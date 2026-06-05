const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Required fields missing' });

  const { data: existing } = await supabase.from('users').select('id').eq('username', username).single();
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const hashed = await bcrypt.hash(password, 10);
  const { data, error } = await supabase.from('users').insert({
    username,
    password: hashed,
    balance: 0,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign({ id: data.id, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: data.id, username, balance: data.balance } });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, balance: user.balance } });
});

module.exports = router;
