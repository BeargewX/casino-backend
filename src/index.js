require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const footballRoutes = require('./routes/football');
const betRoutes = require('./routes/bets');
const slotRoutes = require('./routes/slots');
const { router: adminRoutes } = require('./routes/admin');
const setupPokerSocket = require('./socket/poker');

// trim + clean ป้องกัน invalid chars จาก env
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim().replace(/[^\x20-\x7E]/g, '')

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  FRONTEND_URL,
].filter(o => o && o.startsWith('http'))

console.log('[CORS] allowed origins:', ALLOWED_ORIGINS)

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    const ok = ALLOWED_ORIGINS.some(o => origin === o)
    if (ok) return callback(null, true)
    console.log('[CORS] blocked:', origin)
    callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/football', footballRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', origins: ALLOWED_ORIGINS }));

setupPokerSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));