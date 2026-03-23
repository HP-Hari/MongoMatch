// ─── API base (works locally AND on Netlify) ──────────────────────────────────
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://localhost:${window.location.port || 8080}/api`
  : '/api';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  query: '',
  genre: '',
  yearMin: '',
  yearMax: '',
  sortBy: 'relevance',
  skip: 0,
  limit: 20,
  results: [],
  loading: false,
  mode: 'trending',   // 'trending' | 'search'
};

let debounceTimer = null;
let acController  = null;  // AbortController for autocomplete
let acKeyIndex    = -1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput   = $('searchInput');
const navSearchInput= $('navSearchInput');
const acDropdown    = $('acDropdown');
const moviesGrid    = $('moviesGrid');
const sectionTitle  = $('sectionTitle');
const sectionSub    = $('sectionSubtitle');
const loadMoreWrap  = $('loadMoreWrap');
const loadMoreBtn   = $('loadMoreBtn');
const filtersBar    = $('filtersBar');
const filterGenre   = $('filterGenre');
const filterYear    = $('filterYear');
const filterSort    = $('filterSort');
const filtersCount  = $('filtersCount');
const filterReset   = $('filterReset');
const modalOverlay  = $('modalOverlay');
const modalClose    = $('modalClose');
const modalContent  = $('modalContent');
const connectionPill= $('connectionPill');
const pillText      = $('pillText');
const genreChips    = $('genreChips');
const toast         = $('toast');
const searchClear   = $('searchClear');
const navTrending   = $('navTrending');
const navGenres     = $('navGenres');

// ─── Utility ─────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add('hidden'), duration);
}

function formatVotes(n) {
  if (!n) return '';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M votes';
  if (n >= 1e3) return Math.round(n/1e3) + 'K votes';
  return n + ' votes';
}

function posterSrc(url) {
  return (url && url.startsWith('http')) ? url : 'https://placehold.co/300x450/0d1117/64748b?text=No+Poster';
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
function renderSkeletons(n = 12) {
  moviesGrid.innerHTML = Array.from({length: n}).map(() => `
    <div class="skeleton">
      <div class="skeleton-poster"></div>
      <div class="skeleton-info">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>
  `).join('');
}

// ─── Movie Card ───────────────────────────────────────────────────────────────
function movieCardHTML(m) {
  const rating = m.imdb?.rating;
  return `
    <div class="movie-card" data-id="${m._id}">
      <div class="movie-poster-wrap">
        <img class="movie-poster" src="${posterSrc(m.poster)}" alt="${m.title}" loading="lazy"
             onerror="this.src='https://placehold.co/300x450/0d1117/64748b?text=No+Poster'">
        <div class="movie-card-overlay"></div>
        <div class="movie-play-btn">▶</div>
        ${rating ? `<div class="movie-rating">⭐ ${rating}</div>` : ''}
      </div>
      <div class="movie-info">
        <div class="movie-title">${m.title}</div>
        <div class="movie-meta">
          <span>${m.year || '—'}</span>
          ${m.runtime ? `<span>·</span><span>${m.runtime}m</span>` : ''}
        </div>
        ${m.genres?.length ? `<div class="movie-genre">${m.genres.slice(0,3).join(' · ')}</div>` : ''}
      </div>
    </div>
  `;
}

// ─── Render grid ─────────────────────────────────────────────────────────────
function renderMovies(movies, append = false) {
  if (!append) state.results = movies;
  else state.results = [...state.results, ...movies];

  if (!append) {
    moviesGrid.innerHTML = movies.length === 0
      ? `<div class="state-box">
           <div class="state-icon">🎬</div>
           <h3>No results found</h3>
           <p>Try different keywords or adjust your filters.</p>
         </div>`
      : movies.map(movieCardHTML).join('');
  } else {
    movies.forEach(m => {
      const div = document.createElement('div');
      div.innerHTML = movieCardHTML(m);
      moviesGrid.appendChild(div.firstElementChild);
    });
  }

  // Event listeners on cards
  moviesGrid.querySelectorAll('.movie-card').forEach(card => {
    card.onclick = () => {
      const movie = state.results.find(m => String(m._id) === card.dataset.id);
      if (movie) openModal(movie);
    };
  });

  // Load more visibility
  loadMoreWrap.classList.toggle('hidden', movies.length < state.limit);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function performSearch(q, append = false) {
  if (!q?.trim()) return;
  state.query = q;
  state.mode  = 'search';

  if (!append) {
    state.skip = 0;
    renderSkeletons();
    filtersBar.classList.remove('hidden');
    sectionTitle.innerHTML = `Results for "<span>${q}</span>"`;
    sectionSub.textContent = '';
    window.scrollTo({ top: document.querySelector('.section').offsetTop - 100, behavior: 'smooth' });
  } else {
    state.skip += state.limit;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading…';
  }

  const params = new URLSearchParams({ q, skip: state.skip });
  if (state.genre)   params.set('genre',   state.genre);
  if (state.yearMin) params.set('yearMin', state.yearMin);
  if (state.yearMax) params.set('yearMax', state.yearMax);
  if (state.sortBy !== 'relevance') params.set('sortBy', state.sortBy);

  try {
    const res  = await fetch(`${API_BASE}/search?${params}`);
    const data = await res.json();
    renderMovies(data, append);
    filtersCount.textContent = state.skip + data.length + ' movie' + (state.skip + data.length !== 1 ? 's' : '');
  } catch (e) {
    moviesGrid.innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div><h3>Search failed</h3><p>${e.message}</p></div>`;
  }
}

// ─── Trending ─────────────────────────────────────────────────────────────────
async function loadTrending() {
  state.mode = 'trending';
  filtersBar.classList.add('hidden');
  renderSkeletons(16);
  sectionTitle.innerHTML = 'Trending <span>Now</span>';
  sectionSub.textContent = 'Top-rated movies loved by millions';
  loadMoreWrap.classList.add('hidden');
  try {
    const res  = await fetch(`${API_BASE}/trending`);
    const data = await res.json();
    renderMovies(data, false);
    loadMoreWrap.classList.add('hidden'); // no pagination for trending
  } catch (e) {
    moviesGrid.innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div><h3>Failed to load trending</h3></div>`;
  }
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────
async function fetchSuggestions(q) {
  if (!q.trim()) { acDropdown.classList.add('hidden'); return; }

  if (acController) acController.abort();
  acController = new AbortController();

  try {
    const res  = await fetch(`${API_BASE}/autocomplete?q=${encodeURIComponent(q)}`, { signal: acController.signal });
    const data = await res.json();
    renderAC(data, q);
  } catch (e) {
    if (e.name !== 'AbortError') acDropdown.classList.add('hidden');
  }
}

function renderAC(items, q) {
  acKeyIndex = -1;
  if (!items.length) { acDropdown.classList.add('hidden'); return; }

  acDropdown.innerHTML = items.map((m, i) => `
    <div class="ac-item" data-idx="${i}" data-title="${m.title}">
      <img class="ac-thumb" src="${posterSrc(m.poster)}" alt="${m.title}" loading="lazy"
           onerror="this.src='https://placehold.co/38x56/0d1117/64748b?text='">
      <div class="ac-info">
        <h4>${highlightMatch(m.title, q)}</h4>
        <p>${m.year || ''}</p>
        ${m.genres?.[0] ? `<span class="ac-genre">${m.genres[0]}</span>` : ''}
      </div>
    </div>
  `).join('') + `<div class="ac-footer">
    <span>${items.length} suggestion${items.length !== 1 ? 's' : ''}</span>
    <span>↵ to search</span>
  </div>`;

  acDropdown.classList.remove('hidden');

  acDropdown.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const title = item.dataset.title;
      searchInput.value = title;
      closeAC();
      performSearch(title);
    });
  });
}

function highlightMatch(text, q) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<strong style="color:#a5b4fc">$1</strong>');
}

function closeAC() { acDropdown.classList.add('hidden'); acKeyIndex = -1; }

function navigateAC(dir) {
  const items = acDropdown.querySelectorAll('.ac-item');
  if (!items.length) return;
  items[acKeyIndex]?.classList.remove('active');
  acKeyIndex = (acKeyIndex + dir + items.length) % items.length;
  items[acKeyIndex]?.classList.add('active');
  searchInput.value = items[acKeyIndex]?.dataset.title || searchInput.value;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(m) {
  const rating = m.imdb?.rating;
  const votes  = formatVotes(m.imdb?.votes);
  const genres = (m.genres || []).map(g => `<span class="modal-tag primary">${g}</span>`).join('');
  const tags   = [
    m.year    ? `<span class="modal-tag">${m.year}</span>` : '',
    m.runtime ? `<span class="modal-tag">${m.runtime} min</span>` : '',
    m.rated   ? `<span class="modal-tag">${m.rated}</span>` : '',
    rating    ? `<span class="modal-tag">⭐ ${rating}/10 ${votes ? '· ' + votes : ''}</span>` : '',
  ].join('');

  modalContent.innerHTML = `
    <div class="modal-hero">
      <div class="modal-poster-col">
        <img class="modal-poster" src="${posterSrc(m.poster)}" alt="${m.title}"
             onerror="this.src='https://placehold.co/220x340/0d1117/64748b?text=No+Poster'">
        <div class="modal-poster-gradient"></div>
      </div>
      <div class="modal-info">
        ${m.rated ? `<span class="modal-rated">${m.rated}</span>` : ''}
        <h2 class="modal-title">${m.title}</h2>
        <div class="modal-tags">${tags}${genres}</div>
        <p class="modal-plot">${m.fullplot || m.plot || 'No description available.'}</p>
        ${m.directors?.length ? `<p class="modal-section-title">Director${m.directors.length > 1 ? 's' : ''}</p><p class="modal-people">${m.directors.join(', ')}</p>` : ''}
        ${m.cast?.length ? `<p class="modal-section-title">Cast</p><p class="modal-people">${m.cast.slice(0,6).join(', ')}</p>` : ''}
        ${m.languages?.length ? `<p class="modal-section-title">Languages</p><p class="modal-people">${m.languages.slice(0,4).join(', ')}</p>` : ''}
        ${m.awards?.text ? `<div class="modal-awards">${m.awards.text}</div>` : ''}
      </div>
    </div>
  `;
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── Genre chips ─────────────────────────────────────────────────────────────
const QUICK_GENRES = ['Action','Comedy','Drama','Horror','Sci-Fi','Romance','Thriller','Animation','Documentary','Crime'];

function renderGenreChips(genres) {
  const list = genres?.length ? genres.slice(0, 14) : QUICK_GENRES;
  genreChips.innerHTML = list.map(g => `<button class="genre-chip" data-genre="${g}">${g}</button>`).join('');
  genreChips.querySelectorAll('.genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      genreChips.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      searchInput.value = chip.dataset.genre;
      searchClear.classList.remove('hidden');
      performSearch(chip.dataset.genre);
    });
  });
}

// ─── Genre filter select ──────────────────────────────────────────────────────
async function populateGenreSelect() {
  try {
    const res = await fetch(`${API_BASE}/genres`);
    const genres = await res.json();
    genres.forEach(g => {
      const o = document.createElement('option');
      o.value = o.textContent = g;
      filterGenre.appendChild(o);
    });
    renderGenreChips(genres);
  } catch (_) {
    renderGenreChips();
  }
}

// ─── Status pill ─────────────────────────────────────────────────────────────
async function checkStatus() {
  try {
    const res  = await fetch(`${API_BASE}/status`);
    const data = await res.json();
    if (data.mode === 'live') {
      pillText.textContent = `Live · ${Number(data.movieCount).toLocaleString()} movies`;
      connectionPill.classList.remove('demo');
    } else {
      pillText.textContent = 'Demo Mode';
      connectionPill.classList.add('demo');
      showToast('⚠️ Running in Demo Mode — connect MongoDB Atlas for full data', 4000);
    }
  } catch (_) {
    pillText.textContent = 'Offline';
    connectionPill.classList.add('demo');
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Main search input – autocomplete
searchInput.addEventListener('input', e => {
  const q = e.target.value;
  searchClear.classList.toggle('hidden', !q);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchSuggestions(q), 220);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown')  { e.preventDefault(); navigateAC(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); navigateAC(-1); }
  else if (e.key === 'Escape') closeAC();
  else if (e.key === 'Enter') {
    closeAC();
    performSearch(searchInput.value);
  }
});

searchInput.addEventListener('blur', () => setTimeout(closeAC, 150));

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  closeAC();
  loadTrending();
  genreChips.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
});

$('searchSubmit').addEventListener('click', () => {
  closeAC();
  performSearch(searchInput.value);
});

// Nav search input
navSearchInput.addEventListener('input', e => {
  const q = e.target.value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (q.trim()) {
      searchInput.value = q;
      performSearch(q);
    }
  }, 350);
});
navSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { performSearch(navSearchInput.value); navSearchInput.blur(); }
});

// Filters
filterGenre.addEventListener('change', () => { state.genre = filterGenre.value; performSearch(state.query); });
filterYear.addEventListener('change', () => {
  const val = filterYear.value;
  if (!val) { state.yearMin = ''; state.yearMax = ''; }
  else { [state.yearMin, state.yearMax] = val.split(','); }
  performSearch(state.query);
});
filterSort.addEventListener('change', () => { state.sortBy = filterSort.value; performSearch(state.query); });
filterReset.addEventListener('click', () => {
  filterGenre.value = ''; filterYear.value = ''; filterSort.value = 'relevance';
  state.genre = ''; state.yearMin = ''; state.yearMax = ''; state.sortBy = 'relevance';
  performSearch(state.query);
});

// Load more
loadMoreBtn.addEventListener('click', () => performSearch(state.query, true));

// Nav buttons
navTrending.addEventListener('click', () => {
  searchInput.value = ''; searchClear.classList.add('hidden');
  genreChips.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
  loadTrending();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
navGenres.addEventListener('click', () => {
  document.querySelector('.genre-chips')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Modal
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Navbar scroll effect
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  nav.style.background = window.scrollY > 60
    ? 'rgba(7,9,15,0.98)' : 'rgba(7,9,15,0.75)';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  await checkStatus();
  await populateGenreSelect();
  await loadTrending();
})();
