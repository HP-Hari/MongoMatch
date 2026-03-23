require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DATABASE_NAME || 'sample_mflix';
const COLLECTION = process.env.COLLECTION_NAME || 'movies';
const INDEX = process.env.INDEX_NAME || 'default';

let client, moviesCol, isDemoMode = false;

// ─── Demo data fallback ────────────────────────────────────────────────────────
const DEMO = [
  { _id:'1', title:'The Godfather',       year:1972, genres:['Crime','Drama'],   imdb:{rating:9.2,votes:1800000}, poster:'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_SX300.jpg', plot:'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.', directors:['Francis Ford Coppola'], cast:['Marlon Brando','Al Pacino','James Caan'] },
  { _id:'2', title:'The Shawshank Redemption', year:1994, genres:['Drama'],      imdb:{rating:9.3,votes:2600000}, poster:'https://m.media-amazon.com/images/M/MV5BNDE3ODcxYzMtY2YzZC00NmNlLWJiNDMtZDViZWM2MzIxZDYwXkEyXkFqcGdeQXVyNjU0OTQ0OTY@._V1_SX300.jpg', plot:'Two imprisoned men bond over a number of years, finding solace and eventual redemption.', directors:['Frank Darabont'], cast:['Tim Robbins','Morgan Freeman'] },
  { _id:'3', title:'Inception',            year:2010, genres:['Sci-Fi','Action'], imdb:{rating:8.8,votes:2200000}, poster:'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg',       plot:'A thief who steals corporate secrets through dream-sharing technology.', directors:['Christopher Nolan'], cast:['Leonardo DiCaprio','Joseph Gordon-Levitt'] },
  { _id:'4', title:'Pulp Fiction',          year:1994, genres:['Crime','Drama'],  imdb:{rating:8.9,votes:2000000}, poster:'https://m.media-amazon.com/images/M/MV5BNGNhMDIzZTUtNTBlZi00MTRlLWFjM2ItYzViMjE3YzI5MjUzXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_SX300.jpg', plot:'The lives of two mob hitmen, a boxer, a gangster and his wife intertwine.', directors:['Quentin Tarantino'], cast:['John Travolta','Uma Thurman'] },
  { _id:'5', title:'The Dark Knight',       year:2008, genres:['Action','Crime'], imdb:{rating:9.0,votes:2500000}, poster:'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg',       plot:'When the Joker wreaks havoc on Gotham, Batman must fight injustice.', directors:['Christopher Nolan'], cast:['Christian Bale','Heath Ledger'] },
  { _id:'6', title:'Interstellar',          year:2014, genres:['Sci-Fi','Drama'], imdb:{rating:8.7,votes:1700000}, poster:'https://m.media-amazon.com/images/M/MV5BZjdkOTU3MDktN2IxOS00OGEyLWFmMjktY2FiMmZkNWIyODZiXkEyXkFqcGdeQXVyMTMxODk2OTU@._V1_SX300.jpg', plot:'Explorers travel through a wormhole in space to ensure humanity\'s survival.', directors:['Christopher Nolan'], cast:['Matthew McConaughey','Anne Hathaway'] },
  { _id:'7', title:'The Matrix',            year:1999, genres:['Sci-Fi','Action'],imdb:{rating:8.7,votes:1900000}, poster:'https://m.media-amazon.com/images/M/MV5BNzQzOTk3OTAtNDQ0Zi00ZTVlLTM5YTUtZWU4ZjliMzZhZTE3XkEyXkFqcGdeQXVyNjU0OTQ0OTY@._V1_SX300.jpg', plot:'A computer hacker learns the world he lives in is a simulation.', directors:['Lana Wachowski','Lilly Wachowski'], cast:['Keanu Reeves','Laurence Fishburne'] },
  { _id:'8', title:'Schindler\'s List',     year:1993, genres:['Drama','History'],imdb:{rating:9.0,votes:1400000}, poster:'https://m.media-amazon.com/images/M/MV5BNDE4OTExMDg0Ml5BMl5BanBnXkFtZTgwMDk5NjkxMDE@._V1_SX300.jpg',       plot:'A German industrialist saves the lives of more than a thousand Jewish refugees.', directors:['Steven Spielberg'], cast:['Liam Neeson','Ben Kingsley'] },
];

// ─── DB connect ────────────────────────────────────────────────────────────────
async function connectDB() {
  if (!uri) { console.warn('⚠️  No MONGODB_URI — running in DEMO mode'); isDemoMode = true; return; }
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db(DB_NAME);
    moviesCol = db.collection(COLLECTION);
    const count = await moviesCol.countDocuments();
    console.log(`✅ MongoDB Atlas connected — ${count.toLocaleString()} movies in ${DB_NAME}.${COLLECTION}`);
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    isDemoMode = true;
    console.warn('🔄 Falling back to DEMO mode');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function demoFilter(q) {
  const qLow = q.toLowerCase();
  return DEMO.filter(m => m.title.toLowerCase().includes(qLow));
}

function buildSearchPipeline({ q, genre, yearMin, yearMax, sortBy, skip = 0, limit = 20, autocomplete = false }) {
  const pipeline = [];

  // Atlas Search stage
  const searchStage = autocomplete
    ? { autocomplete: { query: q, path: 'title', tokenOrder: 'any', fuzzy: { maxEdits: 1, prefixLength: 1 } } }
    : { text: { query: q, path: 'title', fuzzy: { maxEdits: 2, prefixLength: 1 } } };

  pipeline.push({ $search: { index: INDEX, ...searchStage } });

  // Post-search filters
  const match = {};
  if (genre)   match.genres = genre;
  if (yearMin || yearMax) {
    match.year = {};
    if (yearMin) match.year.$gte = parseInt(yearMin);
    if (yearMax) match.year.$lte = parseInt(yearMax);
  }
  if (Object.keys(match).length) pipeline.push({ $match: match });

  // Sort
  if (sortBy === 'rating')  pipeline.push({ $sort: { 'imdb.rating': -1 } });
  else if (sortBy === 'year') pipeline.push({ $sort: { year: -1 } });
  else pipeline.push({ $addFields: { score: { $meta: 'searchScore' } } }, { $sort: { score: -1 } });

  pipeline.push({ $skip: skip }, { $limit: limit });

  pipeline.push({ $project: {
    _id: 1, title: 1, year: 1, genres: 1, plot: 1, fullplot: 1,
    poster: 1, imdb: 1, directors: 1, cast: 1, runtime: 1, languages: 1, countries: 1,
    awards: 1, rated: 1, score: { $meta: 'searchScore' }
  }});

  return pipeline;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/status */
app.get('/api/status', async (req, res) => {
  let count = isDemoMode ? DEMO.length : 0;
  if (!isDemoMode) {
    try { count = await moviesCol.countDocuments(); } catch (_) {}
  }
  res.json({ mode: isDemoMode ? 'demo' : 'live', movieCount: count, index: INDEX });
});

/** GET /api/autocomplete?q= */
app.get('/api/autocomplete', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);

  if (isDemoMode) return res.json(demoFilter(q).slice(0, 8));

  try {
    const results = await moviesCol.aggregate(
      buildSearchPipeline({ q, autocomplete: true, limit: 8 })
    ).toArray();
    res.json(results);
  } catch (err) {
    console.error('Autocomplete error:', err.message);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
});

/** GET /api/search?q=&genre=&yearMin=&yearMax=&sortBy=&skip= */
app.get('/api/search', async (req, res) => {
  const { q, genre, yearMin, yearMax, sortBy, skip } = req.query;
  if (!q?.trim()) return res.json([]);

  if (isDemoMode) {
    let results = demoFilter(q);
    if (genre) results = results.filter(m => m.genres?.includes(genre));
    return res.json(results);
  }

  try {
    const results = await moviesCol.aggregate(
      buildSearchPipeline({ q, genre, yearMin, yearMax, sortBy, skip: parseInt(skip) || 0 })
    ).toArray();
    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

/** GET /api/genres — return distinct genres */
app.get('/api/genres', async (req, res) => {
  if (isDemoMode) return res.json([...new Set(DEMO.flatMap(m => m.genres))].sort());
  try {
    const genres = await moviesCol.distinct('genres');
    res.json(genres.filter(Boolean).sort());
  } catch (err) {
    console.error('Genres error:', err.message);
    res.status(500).json({ error: 'Could not fetch genres' });
  }
});

/** GET /api/trending — top-rated movies as "trending" */
app.get('/api/trending', async (req, res) => {
  if (isDemoMode) return res.json(DEMO.sort((a,b) => b.imdb.rating - a.imdb.rating).slice(0,12));
  try {
    const results = await moviesCol.find(
      { 'imdb.rating': { $gte: 8.0 }, poster: { $exists: true, $ne: '' }, year: { $gte: 1980 } },
      { projection: { _id:1, title:1, year:1, genres:1, poster:1, imdb:1, plot:1, fullplot:1, directors:1, cast:1, runtime:1, languages:1, countries:1, awards:1, rated:1 } }
    ).sort({ 'imdb.rating': -1, 'imdb.votes': -1 }).limit(16).toArray();
    res.json(results);
  } catch (err) {
    console.error('Trending error:', err.message);
    res.status(500).json({ error: 'Trending failed' });
  }
});

/** GET /api/movie/:id */
app.get('/api/movie/:id', async (req, res) => {
  if (isDemoMode) {
    const m = DEMO.find(d => d._id === req.params.id);
    return m ? res.json(m) : res.status(404).json({ error: 'Not found' });
  }
  try {
    const { ObjectId } = require('mongodb');
    const movie = await moviesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch movie' });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`🚀 Server running → http://localhost:${PORT}`));
})();
