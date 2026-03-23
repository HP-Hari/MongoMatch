const serverless = require('serverless-http');
const express    = require('express');
const { MongoClient } = require('mongodb');
const cors       = require('cors');
const fetch      = require('node-fetch');

const app = express();

// ─── Environment Configuration ───────────────────────────────────────────────
// These values are now strictly read from environment variables for security.
const DB_NAME  = process.env.DATABASE_NAME  || 'sample_mflix';
const COLL     = process.env.COLLECTION_NAME|| 'movies';
const INDEX    = process.env.INDEX_NAME     || 'default';
const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const OMDB_BASE = 'https://www.omdbapi.com';

app.use(cors());
app.use(express.json());

const TMDB_GENRES = {28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Science Fiction',10770:'TV Movie',53:'Thriller',10752:'War',37:'Western'};

function tmdbMovie(m) {
  return {
    _id: `tmdb_${m.id}`, tmdbId: m.id, title: m.title || m.name,
    year: m.release_date ? parseInt(m.release_date.slice(0,4)) : null,
    plot: m.overview, poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    genres: (m.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean),
    imdb: { rating: m.vote_average ? parseFloat(m.vote_average.toFixed(1)) : null, votes: m.vote_count },
    source: 'tmdb'
  };
}

async function tmdbFetch(endpoint, params = {}) {
  if (!TMDB_KEY) return null;
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_KEY);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  try { const r = await fetch(url.toString()); return r.ok ? r.json() : null; }
  catch(e) { return null; }
}

async function omdbFetch(imdbId, title) {
  if (!OMDB_KEY) return null;
  const url = new URL(OMDB_BASE); url.searchParams.set('apikey', OMDB_KEY);
  if (imdbId) url.searchParams.set('i', imdbId); else if (title) url.searchParams.set('t', title);
  try { const r = await fetch(url.toString()); return r.ok ? r.json() : null; }
  catch(e) { return null; }
}

let cachedClient, moviesCol, isDemo = false;
async function connectDB() {
  if (moviesCol) return moviesCol;
  const uri = process.env.MONGODB_URI;
  if (!uri) { isDemo = true; return null; }
  try {
    cachedClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await cachedClient.connect();
    moviesCol = cachedClient.db(DB_NAME).collection(COLL);
    return moviesCol;
  } catch(e) { isDemo = true; return null; }
}

function buildSearchPipeline({ q, genre, yearRange, autocomplete = false, skip = 0, limit = 20 }) {
  const filters = [];
  if (genre) filters.push({ text: { query: genre, path: 'genres' } });
  if (yearRange) {
    const [start, end] = yearRange.split(',').map(Number);
    filters.push({ range: { path: 'year', gte: start, lte: end || 2100 } });
  }

  const searchClause = {
    compound: {
      should: [
        { phrase: { query: q, path: 'title', score: { boost: { value: 10 } } } },
        { text: { query: q, path: 'title', fuzzy: { maxEdits: 2 }, score: { boost: { value: 5 } } } },
        { text: { query: q, path: ['cast', 'directors'], fuzzy: { maxEdits: 1 } } },
        { text: { query: q, path: 'plot', fuzzy: { maxEdits: 1 } } }
      ],
      filter: filters.length ? filters : undefined,
      minimumShouldMatch: 1
    }
  };

  if (autocomplete) {
      return [
        { $search: { index: INDEX, autocomplete: { query: q, path: 'title', fuzzy: { maxEdits: 2 } } } },
        { $limit: limit },
        { $project: { _id:1, title:1, year:1, genres:1, poster:1, imdb:1 } }
      ];
  }

  return [
    {
      $search: {
        index: INDEX,
        ...searchClause,
        score: { function: { multiply: [
          { score: 'relevance' },
          { add: [
            { path: { value: 'imdb.rating', undefined: 5 } },
            { log10: { add: [{ path: { value: 'imdb.votes', undefined: 0 } }, 1] } }
          ]}
        ] } }
      }
    },
    { $addFields: { score: { $meta: 'searchScore' } } },
    { $sort: { score: -1 } }, { $skip: skip }, { $limit: limit },
    { $project: { _id:1, title:1, year:1, genres:1, plot:1, poster:1, imdb:1, score:1 } }
  ];
}

app.get('/api/status', async (_req, res) => {
  const col = await connectDB(); 
  const count = (col && !isDemo) ? await col.estimatedDocumentCount().catch(()=>0) : 0;
  res.json({ mode: isDemo ? 'tmdb-only' : 'live', movieCount: count, tmdb: !!TMDB_KEY, omdb: !!OMDB_KEY });
});

app.get('/api/autocomplete', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);
  const col = await connectDB();
  if (!col || isDemo) {
    const data = await tmdbFetch('/search/movie', { query: q });
    return res.json((data?.results || []).slice(0, 10).map(tmdbMovie));
  }
  try {
    const results = await col.aggregate(buildSearchPipeline({ q, autocomplete: true, limit: 12 })).toArray();
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  const { q, skip, genre, year } = req.query;
  const col = await connectDB();
  let results = [];
  const skipN = parseInt(skip) || 0;
  if (col && !isDemo) {
    try {
      results = await col.aggregate(buildSearchPipeline({ q, genre, yearRange: year, skip: skipN })).toArray();
    } catch(e) {}
  }
  if (TMDB_KEY && skipN === 0) {
    const data = await tmdbFetch('/search/movie', { query: q });
    const tmdb = (data?.results || []).slice(0, 12).map(tmdbMovie);
    const seen = new Set(results.map(r => r.title.toLowerCase()));
    tmdb.forEach(m => {
      const genreMatch = !genre || m.genres.some(g => g.toLowerCase() === genre.toLowerCase());
      const [yStart, yEnd] = (year || '0,2100').split(',').map(Number);
      const yearMatch = !m.year || (m.year >= yStart && m.year <= (yEnd || 2100));
      if (genreMatch && yearMatch && !seen.has(m.title.toLowerCase())) results.push(m);
    });
  }
  res.json(results);
});

app.get('/api/trending', async (_req, res) => {
  const col = await connectDB();
  const [ap, tp] = await Promise.allSettled([
    col && !isDemo ? col.find({'imdb.rating':{$gte:8.5}}).sort({'imdb.votes':-1}).limit(10).toArray() : Promise.resolve([]),
    tmdbFetch('/trending/movie/week')
  ]);
  res.json({ trending: ap.value||[], popular: (tp.value?.results||[]).map(tmdbMovie) });
});

app.get('/api/nowplaying', async (_req, res) => {
  const data = await tmdbFetch('/movie/now_playing');
  res.json({ results: (data?.results || []).map(tmdbMovie) });
});

app.get('/api/movie/:id', async (req, res) => {
  const { id } = req.params; let movie;
  const { ObjectId } = require('mongodb');
  if (id.startsWith('tmdb_')) {
    const tid = id.replace('tmdb_', '');
    const data = await tmdbFetch(`/movie/${tid}`, { append_to_response: 'credits,external_ids' });
    if (!data) return res.status(404).json({ error: 'Not found' });
    movie = tmdbMovie(data); movie.fullplot = data.overview; movie.runtime = data.runtime;
    movie.imdbId = data.external_ids?.imdb_id;
    movie.cast = (data.credits?.cast || []).slice(0, 8).map(c => c.name);
    movie.directors = (data.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    if (data.genres) movie.genres = data.genres.map(g => g.name);
  } else {
    const col = await connectDB();
    try {
      movie = await col.findOne({ _id: new ObjectId(id) });
      if (movie?.imdb?.id) movie.imdbId = String(movie.imdb.id).startsWith('tt') ? movie.imdb.id : `tt${String(movie.imdb.id).padStart(7,'0')}`;
    } catch(e) {}
  }
  if (movie) {
    const live = await omdbFetch(movie.imdbId, movie.title);
    if (live && live.Response !== 'False') {
      movie.omdb = { rating: live.imdbRating, votes: live.imdbVotes, awards: live.Awards, metacritic: live.Metascore, rated: live.Rated, boxOffice: live.BoxOffice };
      if (!movie.fullplot && live.Plot !== 'N/A') movie.fullplot = live.Plot;
      if (!movie.directors && live.Director !== 'N/A') movie.directors = live.Director.split(', ');
      if (!movie.cast?.length && live.Actors !== 'N/A') movie.cast = live.Actors.split(', ');
      if (!movie.runtime && live.Runtime !== 'N/A') movie.runtime = parseInt(live.Runtime);
    }
  }
  res.json(movie || { error: 'Not found' });
});

app.get('/api/genres', async (_req, res) => {
  const col = await connectDB();
  if (col) { const g = await col.distinct('genres'); return res.json(g.filter(Boolean).sort()); }
  res.json(Object.values(TMDB_GENRES).sort());
});

module.exports.handler = serverless(app);
