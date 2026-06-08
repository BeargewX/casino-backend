const router = require('express').Router();
const axios = require('axios');
const { authenticate } = require('../middleware/auth');

const ODDS_BASE = 'https://api.the-odds-api.com/v4';
const AF_KEY = () => process.env.API_FOOTBALL_KEY || 'dceeea0ec2b216a845ba0d59db1424e3'
const AF_BASE = 'https://v3.football.api-sports.io';

const TEAM_IDS = {
  Mexico: 164, 'South Africa': 54, 'South Korea': 48, Czechia: 770,
  Canada: 101, 'Bosnia and Herzegovina': 756, Qatar: 164, Switzerland: 15,
  Brazil: 6, Morocco: 1, Haiti: 509, Scotland: 1178,
  'United States': 2, Paraguay: 775, Australia: 25, 'Türkiye': 777,
  Germany: 25, 'Curaçao': 1570, 'Ivory Coast': 46, Ecuador: 776,
  Netherlands: 1118, Japan: 29, Sweden: 778, Tunisia: 1569,
  Belgium: 1, Egypt: 779, Iran: 780, 'New Zealand': 1572,
  Spain: 9, 'Cape Verde': 1571, 'Saudi Arabia': 781, Uruguay: 782,
  France: 2, Senegal: 783, Iraq: 784, Norway: 785,
  Argentina: 26, Algeria: 786, Austria: 787, Jordan: 788,
  Portugal: 27, 'DR Congo': 789, Uzbekistan: 790, Colombia: 791,
  England: 10, Croatia: 792, Ghana: 793, Panama: 794,
}

const squadCache = {}

function afHeaders(apiKey) {
  return { 'x-apisports-key': apiKey, 'x-rapidapi-host': 'v3.football.api-sports.io' }
}

// GET squad by team name
router.get('/squad/:teamName', authenticate, async (req, res) => {
  const teamName = decodeURIComponent(req.params.teamName)
  const teamId = TEAM_IDS[teamName]
  if (!teamId) return res.status(404).json({ error: 'Team not found' })

  const cacheKey = `squad_${teamId}`
  if (squadCache[cacheKey] && Date.now() - squadCache[cacheKey].ts < 3600000) {
    return res.json(squadCache[cacheKey].data)
  }

  const apiKey = AF_KEY()

  try {
    const resp = await axios.get(`${AF_BASE}/players/squads`, {
      params: { team: teamId },
      headers: afHeaders(apiKey),
    })

    const squadData = resp.data?.response?.[0]
    if (!squadData) return res.status(404).json({ error: 'No squad data' })

    const players = squadData.players.map(p => ({
      id: p.id,
      name: p.name,
      age: p.age,
      number: p.number,
      position: p.position,
      photo: p.photo,
    }))

    const result = { teamId, teamName, players }
    squadCache[cacheKey] = { ts: Date.now(), data: result }
    res.json(result)
  } catch (err) {
    console.error('Squad error:', err.message)
    res.status(500).json({ error: 'Failed to fetch squad', detail: err.message })
  }
})

// GET lineup จริงตอนบอลเริ่ม (ใช้ fixtureId จาก /fixtures)
router.get('/lineup/:fixtureId', authenticate, async (req, res) => {
  const apiKey = AF_KEY()

  const cacheKey = `lineup_${req.params.fixtureId}`
  if (squadCache[cacheKey] && Date.now() - squadCache[cacheKey].ts < 1800000) {
    return res.json(squadCache[cacheKey].data)
  }

  try {
    const resp = await axios.get(`${AF_BASE}/fixtures/lineups`, {
      params: { fixture: req.params.fixtureId },
      headers: afHeaders(apiKey),
    })

    const lineups = resp.data?.response || []
    if (!lineups.length) {
      return res.json({ available: false, message: 'Lineup not announced yet' })
    }

    const result = lineups.map(team => ({
      available: true,
      teamId: team.team.id,
      teamName: team.team.name,
      formation: team.formation, // เช่น "4-3-3"
      startXI: team.startXI.map(p => ({
        id: p.player.id,
        name: p.player.name,
        number: p.player.number,
        position: p.player.pos, // G / D / M / F
        grid: p.player.grid,    // เช่น "2:3" → row:col วางบนสนามได้เลย
        photo: `https://media.api-sports.io/football/players/${p.player.id}.png`,
      })),
      substitutes: team.substitutes.map(p => ({
        id: p.player.id,
        name: p.player.name,
        number: p.player.number,
        position: p.player.pos,
        photo: `https://media.api-sports.io/football/players/${p.player.id}.png`,
      })),
    }))

    squadCache[cacheKey] = { ts: Date.now(), data: result }
    res.json(result)
  } catch (err) {
    console.error('Lineup error:', err.message)
    res.status(500).json({ error: 'Failed to fetch lineup' })
  }
})

// GET World Cup fixtures (league=1, season=2026)
router.get('/fixtures', authenticate, async (req, res) => {
  const apiKey = AF_KEY()

  try {
    const resp = await axios.get(`${AF_BASE}/fixtures`, {
      params: { league: 1, season: 2026 },
      headers: afHeaders(apiKey),
    })
    res.json(resp.data?.response || [])
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fixtures' })
  }
})

// GET standings (groups A-L)
router.get('/standings', authenticate, async (req, res) => {
  const apiKey = AF_KEY()

  try {
    const resp = await axios.get(`${AF_BASE}/standings`, {
      params: { league: 1, season: 2026 },
      headers: afHeaders(apiKey),
    })
    res.json(resp.data?.response || [])
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch standings' })
  }
})

// GET betting odds
router.get('/matches', authenticate, async (req, res) => {
  try {
    const resp = await axios.get(`${ODDS_BASE}/sports/soccer_fifa_world_cup/odds`, {
      params: {
        apiKey: process.env.ODDS_API_KEY,
        regions: 'eu',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'decimal',
      },
    })
    res.json(resp.data)
  } catch {
    res.json(getMockMatches())
  }
})

// GET live scores
router.get('/live', authenticate, async (req, res) => {
  try {
    const resp = await axios.get(`${ODDS_BASE}/sports/soccer_fifa_world_cup/scores`, {
      params: { apiKey: process.env.ODDS_API_KEY, daysFrom: 1 },
    })
    res.json(resp.data)
  } catch {
    res.json([])
  }
})

function makeMatch(id, home, away, h1, h2, h3, ou = 2.5, spread = -0.5) {
  // h1=home win, h2=away win, h3=draw
  // Auto-generate spreads and totals from h2h odds
  const spreadHome = +(h1 * 0.95).toFixed(2)
  const spreadAway = +(h2 * 0.92).toFixed(2)
  const overOdds   = 1.90
  const underOdds  = 1.90
  return {
    id, sport_key: 'soccer_fifa_world_cup',
    commence_time: new Date(Date.now() + (id.slice(-1).charCodeAt(0) * 3600000)).toISOString(),
    home_team: home, away_team: away,
    bookmakers: [{ key: 'mock', title: 'MockBook', markets: [
      { key: 'h2h', outcomes: [
        { name: home,   price: h1 },
        { name: away,   price: h2 },
        { name: 'Draw', price: h3 },
      ]},
      { key: 'totals', outcomes: [
        { name: 'Over',  price: overOdds,  point: ou },
        { name: 'Under', price: underOdds, point: ou },
      ]},
      { key: 'spreads', outcomes: [
        { name: home, price: spreadHome, point: spread      },
        { name: away, price: spreadAway, point: -spread     },
      ]},
    ]}],
  }
}

function getMockMatches() {
  return [
    makeMatch('mock_a', 'Brazil',    'Morocco',      1.75, 4.80, 3.40, 2.5, -0.5),
    makeMatch('mock_b', 'France',    'Senegal',      1.65, 5.20, 3.60, 2.5, -0.5),
    makeMatch('mock_c', 'Argentina', 'Algeria',      1.55, 6.00, 3.80, 2.5, -1.0),
    makeMatch('mock_d', 'Spain',     'Uruguay',      1.85, 4.20, 3.30, 2.5, -0.5),
    makeMatch('mock_e', 'England',   'Ghana',        1.60, 5.50, 3.70, 2.5, -0.5),
    makeMatch('mock_f', 'Germany',   'Ecuador',      1.70, 4.60, 3.50, 2.5, -0.5),
    makeMatch('mock_g', 'Portugal',  'Colombia',     1.80, 4.30, 3.40, 2.5, -0.5),
    makeMatch('mock_h', 'Netherlands','Japan',       1.90, 4.00, 3.30, 2.5, -0.5),
    makeMatch('mock_i', 'Mexico',    'South Korea',  2.20, 3.40, 3.10, 2.5,  0.0),
    makeMatch('mock_j', 'USA',       'Australia',    2.10, 3.60, 3.20, 2.5,  0.0),
    makeMatch('mock_k', 'Belgium',   'Morocco',      1.95, 3.90, 3.25, 2.5, -0.5),
    makeMatch('mock_l', 'Croatia',   'Canada',       2.00, 3.80, 3.20, 2.5,  0.0),
  ]
}

module.exports = router;