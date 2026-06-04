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

function getMockMatches() {
  return [
    {
      id: 'mock1', sport_key: 'soccer_fifa_world_cup',
      commence_time: new Date(Date.now() + 3600000).toISOString(),
      home_team: 'Brazil', away_team: 'Morocco',
      bookmakers: [{ key: 'mock', title: 'MockBook', markets: [
        { key: 'h2h', outcomes: [{ name: 'Brazil', price: 1.8 }, { name: 'Morocco', price: 4.5 }, { name: 'Draw', price: 3.2 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.9, point: 2.5 }, { name: 'Under', price: 1.9, point: 2.5 }] },
        { key: 'spreads', outcomes: [{ name: 'Brazil', price: 1.85, point: -0.5 }, { name: 'Morocco', price: 1.95, point: 0.5 }] },
      ]}],
    },
    {
      id: 'mock2', sport_key: 'soccer_fifa_world_cup',
      commence_time: new Date(Date.now() + 7200000).toISOString(),
      home_team: 'France', away_team: 'Senegal',
      bookmakers: [{ key: 'mock', title: 'MockBook', markets: [
        { key: 'h2h', outcomes: [{ name: 'France', price: 1.7 }, { name: 'Senegal', price: 5.0 }, { name: 'Draw', price: 3.5 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.85, point: 2.5 }, { name: 'Under', price: 1.95, point: 2.5 }] },
        { key: 'spreads', outcomes: [{ name: 'France', price: 1.9, point: -0.5 }, { name: 'Senegal', price: 1.9, point: 0.5 }] },
      ]}],
    },
    {
      id: 'mock3', sport_key: 'soccer_fifa_world_cup',
      commence_time: new Date(Date.now() + 10800000).toISOString(),
      home_team: 'Argentina', away_team: 'Algeria',
      bookmakers: [{ key: 'mock', title: 'MockBook', markets: [
        { key: 'h2h', outcomes: [{ name: 'Argentina', price: 1.6 }, { name: 'Algeria', price: 5.5 }, { name: 'Draw', price: 3.8 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.88, point: 2.5 }, { name: 'Under', price: 1.92, point: 2.5 }] },
        { key: 'spreads', outcomes: [{ name: 'Argentina', price: 1.87, point: -0.5 }, { name: 'Algeria', price: 1.93, point: 0.5 }] },
      ]}],
    },
    {
      id: 'mock4', sport_key: 'soccer_fifa_world_cup',
      commence_time: new Date(Date.now() + 14400000).toISOString(),
      home_team: 'Spain', away_team: 'Uruguay',
      bookmakers: [{ key: 'mock', title: 'MockBook', markets: [
        { key: 'h2h', outcomes: [{ name: 'Spain', price: 1.9 }, { name: 'Uruguay', price: 4.0 }, { name: 'Draw', price: 3.3 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.88, point: 2.5 }, { name: 'Under', price: 1.92, point: 2.5 }] },
        { key: 'spreads', outcomes: [{ name: 'Spain', price: 1.85, point: -0.5 }, { name: 'Uruguay', price: 1.95, point: 0.5 }] },
      ]}],
    },
  ]
}

module.exports = router;
