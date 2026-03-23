// netlify/functions/api.js  — wraps our Express app as a serverless function
const serverless = require('serverless-http');

// Re-use the same Express app, but export it as a Lambda handler
const express    = require('express');
const { MongoClient } = require('mongodb');
const cors       = require('cors');

const app = express();

const DB_NAME  = process.env.DATABASE_NAME  || 'sample_mflix';
const COLL     = process.env.COLLECTION_NAME|| 'movies';
const INDEX    = process.env.INDEX_NAME     || 'default';

app.use(cors());
app.use(express.json());

// Demo data (same as server.js)
const DEMO = [
  { _id:'1', title:'The Godfather',       year:1972, genres:['Crime','Drama'],   imdb:{rating:9.2,votes:1800000}, poster:'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_SX300.jpg', plot:'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.', directors:['Francis Ford Coppola'], cast:['Marlon Brando','Al Pacino','James Caan'] },
  { _id:'2', title:'The Shawshank Redemption', year:1994, genres:['Drama'],      imdb:{rating:9.3,votes:2600000}, poster:'https://m.media-amazon.com/images/M/MV5BNDE3ODcxYzMtY2YzZC00NmNlLWJiNDMtZDViZWM2MzIxZDYwXkEyXkFqcGdeQXVyNjU0OTQ0OTY@._V1_SX300.jpg', plot:'Two imprisoned men bond over a number of years, finding solace and eventual redemption.', directors:['Frank Darabont'], cast:['Tim Robbins','Morgan Freeman'] },
  { _id:'3', title:'Inception',            year:2010, genres:['Sci-Fi','Action'], imdb:{rating:8.8,votes:2200000}, poster:'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg',       plot:'A thief who steals corporate secrets through dream-sharing technology.', directors:['Christopher Nolan'], cast:['Leonardo DiCaprio','Joseph Gordon-Levitt'] },
  { _id:'4', title:'Pulp Fiction',          year:1994, genres:['Crime','Drama'],  imdb:{rating:8.9,votes:2000000}, poster:'https://m.media-amazon.com/images/M/MV5BNGNhMDIzZTUtNTBlZi00MTRlLWFjM2ItYzViMjE3YzI5MjUzXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_SX300.jpg', plot:'The lives of two mob hitmen, a boxer, a gangster and his wife intertwine.', directors:['Quentin Tarantino'], cast:['John Travolta','Uma Thurman'] },
  { _id:'5', title:'The Dark Knight',       year:2008, genres:['Action','Crime'], imdb:{rating:9.0,votes:2500000}, poster:'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg',       plot:'When the Joker wreaks havoc on Gotham, Batman must fight injustice.', directors:['Christopher Nolan'], cast:['Christian Bale','Heath Ledger'] },
  { _id:'6', title:'Interstellar',          year:2014, genres:['Sci-Fi','Drama'], imdb:{rating:8.7,votes:1700000}, poster:'https://m.media-amazon.com/images/M/MV5BZjdkOTU3MDktN2IxOS00OGEyLWFmMjktY2FiMmZkNWIyODZiXkEyXkFqcGdeQXVyMTMxODk2OTU@._V1_SX300.jpg', plot:'Explorers travel through a wormhole in space to ensure humanity\'s survival.', directors:['Christopher Nolan'], cast:['Matthew McConaughey','Anne Hathaway'] },
];

// Cached DB client (reuses across warm Lambda invocations)
let cachedClient, moviesCol, isDemoMode = false;

async function getCollection() {
  if (moviesCol) return moviesCol;

  const uri = process.env.MONGODB_URI;
  if (!uri) { isDemoMode = true; return null; }

  try {
    cachedClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await cachedClient.connect();
    moviesCol = cachedClient.db(DB_NAME).collection(COLL);
    return moviesCol;
  } catch (e) {
    console.error('DB connect failed:', e.message);
    isDemoMode = true;
    return null;
  }
}

function demoFilter(q) {
  const ql = q.toLowerCase();
  return DEMO.filter(m => m.title.toLowerCase().includes(ql));
}

function buildPipeline({ q, genre, yearMin, yearMax, sortBy, skip=0, limit=20, autocomplete=false }) {
  const pipeline = [];

  const searchStage = autocomplete
    ? { autocomplete: { query: q, path: 'title', tokenOrder: 'any', fuzzy: { maxEdits: 1, prefixLength: 1 } } }
    : { text: { query: q, path: 'title', fuzzy: { maxEdits: 2, prefixLength: 1 } } };

  pipeline.push({ $search: { index: INDEX, ...searchStage } });

  const match = {};
  if (genre)            match.genres = genre;
  if (yearMin || yearMax) {
    match.year = {};
    if (yearMin) match.year.$gte = parseInt(yearMin);
    if (yearMax) match.year.$lte = parseInt(yearMax);
  }
  if (Object.keys(match).length) pipeline.push({ $match: match });

  if (sortBy === 'rating') pipeline.push({ $sort: { 'imdb.rating': -1 } });
  else if (sortBy === 'year') pipeline.push({ $sort: { year: -1 } });
  else pipeline.push({ $addFields: { score: { $meta: 'searchScore' } } }, { $sort: { score: -1 } });

  pipeline.push({ $skip: skip }, { $limit: limit });
  pipeline.push({ $project: {
    _id:1, title:1, year:1, genres:1, plot:1, fullplot:1,
    poster:1, imdb:1, directors:1, cast:1, runtime:1, languages:1, countries:1, awards:1, rated:1,
    score: { $meta: 'searchScore' }
  }});
  return pipeline;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req, res) => {
  const col = await getCollection();
  let count = isDemoMode ? DEMO.length : 0;
  if (!isDemoMode && col) { try { count = await col.countDocuments(); } catch(_) {} }
  res.json({ mode: isDemoMode ? 'demo' : 'live', movieCount: count, index: INDEX });
});

app.get('/api/autocomplete', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);
  const col = await getCollection();
  if (isDemoMode || !col) return res.json(demoFilter(q).slice(0, 8));
  try {
    const r = await col.aggregate(buildPipeline({ q, autocomplete: true, limit: 8 })).toArray();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  const { q, genre, yearMin, yearMax, sortBy, skip } = req.query;
  if (!q?.trim()) return res.json([]);
  const col = await getCollection();
  if (isDemoMode || !col) {
    let r = demoFilter(q);
    if (genre) r = r.filter(m => m.genres?.includes(genre));
    return res.json(r);
  }
  try {
    const r = await col.aggregate(buildPipeline({ q, genre, yearMin, yearMax, sortBy, skip: parseInt(skip)||0 })).toArray();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/genres', async (_req, res) => {
  const col = await getCollection();
  if (isDemoMode || !col) return res.json([...new Set(DEMO.flatMap(m => m.genres))].sort());
  try {
    const g = await col.distinct('genres');
    res.json(g.filter(Boolean).sort());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trending', async (_req, res) => {
  const col = await getCollection();
  if (isDemoMode || !col) return res.json(DEMO.sort((a,b) => b.imdb.rating - a.imdb.rating));
  try {
    const r = await col.find(
      { 'imdb.rating': { $gte: 8.0 }, poster: { $exists: true, $ne: '' }, year: { $gte: 1980 } },
      { projection: { _id:1,title:1,year:1,genres:1,poster:1,imdb:1,plot:1,fullplot:1,directors:1,cast:1,runtime:1,languages:1,countries:1,awards:1,rated:1 } }
    ).sort({ 'imdb.rating': -1, 'imdb.votes': -1 }).limit(16).toArray();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/movie/:id', async (req, res) => {
  const col = await getCollection();
  if (isDemoMode || !col) {
    const m = DEMO.find(d => d._id === req.params.id);
    return m ? res.json(m) : res.status(404).json({ error: 'Not found' });
  }
  try {
    const { ObjectId } = require('mongodb');
    const movie = await col.findOne({ _id: new ObjectId(req.params.id) });
    if (!movie) return res.status(404).json({ error: 'Not found' });
    res.json(movie);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export as Netlify serverless function
module.exports.handler = serverless(app);
