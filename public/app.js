// ─── API base ────────────────────────────────────────────────────────────────
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://localhost:8080/api` : '/api';

// ─── State ───────────────────────────────────────────────────────────────────
const state = { query: '', results: [], mode: 'trending', genre: '', year: '' };
let acTimer = null, acController = null, acIdx = -1, searchSkip = 0;

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput   = $('searchInput');
const searchSubmit  = $('searchSubmit');
const acDropdown    = $('acDropdown');
const moviesGrid    = $('moviesGrid');
const sectionTitle  = $('sectionTitle');
const sectionSub    = $('sectionSubtitle');
const modalOverlay  = $('modalOverlay');
const modalClose    = $('modalClose');
const modalContent  = $('modalContent');
const pillText      = $('pillText');
const navTrending   = $('navTrending');
const navNowPlaying = $('navNowPlaying');
const loadMoreWrap  = $('loadMoreWrap');
const loadMoreBtn   = $('loadMoreBtn');
const filterGenre   = $('filterGenre');
const filterYear    = $('filterYear');
const filtersBar    = $('filtersBar');

// ─── Utility ─────────────────────────────────────────────────────────────────
function poster(url) {
  return url && url.startsWith('http') ? url : 'https://placehold.co/300x450/0d1117/64748b?text=No+Poster';
}

function highlight(text, query) {
  if (!query || !text) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function skeletons(n = 12) {
  moviesGrid.innerHTML = Array.from({length: n}, () => `
    <div class="skeleton"><div class="skeleton-poster"></div>
    <div class="skeleton-info"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DYNAMIC FILTERS — Load real genres from Atlas
// ═══════════════════════════════════════════════════════════════════════════════
async function loadGenres() {
  try {
    const res = await fetch(`${API_BASE}/genres`);
    const genres = await res.json();
    filterGenre.innerHTML = '<option value="">All Genres</option>' + 
      genres.map(g => `<option value="${g}">${g}</option>`).join('');
  } catch(e) {}
}

async function updateFilters() {
  state.genre = filterGenre.value;
  state.year = filterYear.value;
  if (state.query) performSearch(state.query);
}

filterGenre.onchange = updateFilters;
filterYear.onchange = updateFilters;

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTOCOMPLETE — Rich dropdown with keyboard nav, highlights, and ratings
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchAutocomplete(q) {
  if (!q.trim()) { closeAC(); return; }
  if (acController) acController.abort();
  acController = new AbortController();

  try {
    const res = await fetch(`${API_BASE}/autocomplete?q=${encodeURIComponent(q)}`, {
      signal: acController.signal
    });
    const items = await res.json();
    renderAC(items, q);
  } catch(e) { if (e.name !== 'AbortError') closeAC(); }
}

function renderAC(items, q) {
  acIdx = -1;
  if (!items.length) {
    acDropdown.innerHTML = `<div class="ac-empty">No suggestions for "<strong>${q}</strong>"</div>`;
    acDropdown.classList.remove('hidden');
    return;
  }

  acDropdown.innerHTML = items.map((m, i) => {
    const rating = m.imdb?.rating;
    const genres = (m.genres || []).slice(0, 2).join(' · ');
    return `
      <div class="ac-item" data-idx="${i}">
        <img class="ac-thumb" src="${poster(m.poster)}" onerror="this.src='https://placehold.co/38x56/0d1117/64748b?text='">
        <div class="ac-info">
          <h4>${highlight(m.title, q)}</h4>
          <p>
            ${m.year ? `<span>${m.year}</span>` : ''}
            ${genres ? `<span class="ac-genre">${genres}</span>` : ''}
          </p>
        </div>
        <div class="ac-right">
          ${rating ? `<span class="ac-rating">⭐ ${rating}</span>` : ''}
          ${m.source === 'tmdb' ? `<span class="ac-live">LIVE</span>` : ''}
        </div>
      </div>
    `;
  }).join('') + `
    <div class="ac-footer">
      <span>↑↓ Navigate · Enter to search</span>
      <span>${items.length} suggestions</span>
    </div>
  `;

  acDropdown.querySelectorAll('.ac-item').forEach((el, i) => {
    el.onmousedown = (e) => {
      e.preventDefault();
      const title = items[i].title;
      searchInput.value = title;
      closeAC();
      performSearch(title);
    };
    el.onmouseenter = () => { acIdx = i; highlightACItem(); };
  });

  acDropdown.classList.remove('hidden');
}

function highlightACItem() {
  acDropdown.querySelectorAll('.ac-item').forEach((el, i) => { el.classList.toggle('active', i === acIdx); });
  const activeEl = acDropdown.querySelector('.ac-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function closeAC() { acDropdown.classList.add('hidden'); acIdx = -1; }

// ═══════════════════════════════════════════════════════════════════════════════
//  SEARCH INPUT
// ═══════════════════════════════════════════════════════════════════════════════
searchInput.addEventListener('input', (e) => {
  clearTimeout(acTimer);
  acTimer = setTimeout(() => fetchAutocomplete(e.target.value), 200);
});

searchInput.addEventListener('keydown', (e) => {
  const items = acDropdown.querySelectorAll('.ac-item');
  const visible = !acDropdown.classList.contains('hidden');
  if (e.key === 'ArrowDown' && visible) {
    e.preventDefault(); acIdx = (acIdx + 1) % items.length; highlightACItem();
  } else if (e.key === 'ArrowUp' && visible) {
    e.preventDefault(); acIdx = acIdx <= 0 ? items.length - 1 : acIdx - 1; highlightACItem();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (visible && acIdx >= 0 && items[acIdx]) items[acIdx].onmousedown(e);
    else { closeAC(); performSearch(searchInput.value); }
  } else if (e.key === 'Escape') closeAC();
});

searchInput.addEventListener('blur', () => setTimeout(closeAC, 150));
searchSubmit.onclick = () => { closeAC(); performSearch(searchInput.value); };

// ═══════════════════════════════════════════════════════════════════════════════
//  MOVIE GRID & SEARCH
// ═══════════════════════════════════════════════════════════════════════════════
function renderMovies(movies, append = false) {
  if (!append) state.results = movies;
  else state.results = [...state.results, ...movies];

  const html = movies.map(m => `
    <div class="movie-card" onclick="window._openModal('${m._id}')">
      <div class="movie-poster-wrap">
        <img class="movie-poster" src="${poster(m.poster)}" loading="lazy"
             onerror="this.src='https://placehold.co/300x450/0d1117/64748b?text=No+Poster'">
        <div class="movie-card-overlay"></div>
        <div class="movie-play-btn">▶</div>
        ${m.imdb?.rating ? `<div class="movie-rating">⭐ ${m.imdb.rating}</div>` : ''}
        ${m.source === 'tmdb' ? `<div class="movie-source-badge">LIVE</div>` : ''}
      </div>
      <div class="movie-info">
        <div class="movie-title">${m.title}</div>
        <div class="movie-meta">
          <span>${m.year || '—'}</span>
          ${m.genres?.length ? `<span>·</span><span>${m.genres.slice(0,2).join(', ')}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  if (append) moviesGrid.insertAdjacentHTML('beforeend', html);
  else if (!movies.length) moviesGrid.innerHTML = `<div class="state-box"><div class="state-icon">🎬</div><h3>No results found</h3><p>Try different keywords or filters.</p></div>`;
  else moviesGrid.innerHTML = html;

  loadMoreWrap.classList.toggle('hidden', movies.length < 20 || state.mode !== 'search');
}

async function performSearch(q, append = false) {
  if (!q?.trim()) return;
  state.query = q;
  state.mode = 'search';

  if (!append) {
    searchSkip = 0;
    skeletons();
    sectionTitle.innerHTML = `Results for "<span>${q}</span>"`;
    sectionSub.textContent = 'Hybrid search across Atlas + TMDB Live';
    filtersBar.classList.remove('hidden');
    // Scroll to results
    setTimeout(() => document.querySelector('#resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  } else {
    searchSkip += 20;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading…';
  }

  try {
    const url = new URL(`${API_BASE}/search`, window.location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('skip', searchSkip);
    if (state.genre) url.searchParams.set('genre', state.genre);
    if (state.year) url.searchParams.set('year', state.year);

    const res = await fetch(url.toString());
    const data = await res.json();
    renderMovies(data, append);
  } catch(e) {
    moviesGrid.innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div><h3>Search failed</h3></div>`;
  }
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
}

loadMoreBtn.onclick = () => performSearch(state.query, true);

// ═══════════════════════════════════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════════════════════════════════
window._openModal = async function(id) {
  modalContent.innerHTML = `<div class="state-box" style="padding:4rem 2rem;">Loading details…</div>`;
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`${API_BASE}/movie/${id}`);
    const movie = await res.json();
    const omdb = movie.omdb;
    const rating = omdb?.rating || movie.imdb?.rating;
    const genres = (movie.genres || []).map(g => `<span class="modal-tag primary">${g}</span>`).join('');

    modalContent.innerHTML = `
      <div class="modal-hero">
        <div class="modal-poster-col">
          <img class="modal-poster" src="${poster(movie.poster)}">
          <div class="modal-poster-gradient"></div>
        </div>
        <div class="modal-info">
          ${omdb?.rated ? `<span class="modal-rated">${omdb.rated}</span>` : ''}
          <h2 class="modal-title">${movie.title}</h2>
          <div class="modal-tags">
            ${movie.year ? `<span class="modal-tag">${movie.year}</span>` : ''}
            ${movie.runtime ? `<span class="modal-tag">${movie.runtime} min</span>` : ''}
            ${genres}
          </div>

          <div class="modal-big-stats">
            <div class="stat-item"><span class="stat-val">${rating || 'N/A'}</span><span class="stat-lbl">${omdb ? 'LIVE IMDb' : 'IMDb'}</span></div>
            ${omdb?.metacritic && omdb.metacritic!=='N/A' ? `<div class="stat-item"><span class="stat-val ${parseInt(omdb.metacritic)>=60?'good':''}">${omdb.metacritic}</span><span class="stat-lbl">METASCORE</span></div>`:''}
            ${omdb?.votes && omdb.votes!=='N/A' ? `<div class="stat-item"><span class="stat-val">${Number(omdb.votes.replace(/,/g,'')).toLocaleString()}</span><span class="stat-lbl">VOTES</span></div>`:''}
          </div>

          ${omdb?.awards && omdb.awards!=='N/A'?`<div class="modal-awards">${omdb.awards}</div>`:''}
          ${omdb?.boxOffice && omdb.boxOffice!=='N/A'?`<div class="modal-awards" style="color:#4ade80; border-color:rgba(74,222,128,.1); background:rgba(74,222,128,.05);">💰 Box Office: ${omdb.boxOffice}</div>`:''}

          <p class="modal-plot">${movie.fullplot || movie.plot || 'No plot summary available.'}</p>

          ${movie.directors?.length?`<p class="modal-section-title">Director${movie.directors.length>1?'s':''}</p><p class="modal-people">${movie.directors.join(', ')}</p>`:''}
          ${movie.cast?.length?`<p class="modal-section-title">Cast</p><p class="modal-people">${movie.cast.join(', ')}</p>`:''}

          <div class="modal-actions">
            ${movie.imdbId ? `<a href="https://www.imdb.com/title/${movie.imdbId}" target="_blank" rel="noopener" class="btn btn-imdb">🎬 View on IMDb</a>` : ''}
            ${movie.tmdbId ? `<a href="https://www.themoviedb.org/movie/${movie.tmdbId}" target="_blank" rel="noopener" class="btn btn-tmdb">📡 TMDB</a>` : ''}
          </div>
        </div>
      </div>
    `;
  } catch(e) { modalContent.innerHTML = `<div class="state-box">Failed to load movie details.</div>`; }
};

modalClose.onclick = () => { modalOverlay.classList.add('hidden'); document.body.style.overflow = ''; };
modalOverlay.onclick = (e) => { if (e.target === modalOverlay) { modalOverlay.classList.add('hidden'); document.body.style.overflow = ''; } };

// ═══════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════
navTrending.onclick = async () => {
  state.mode = 'trending'; state.query = '';
  skeletons(16); filtersBar.classList.add('hidden');
  sectionTitle.innerHTML = 'Trending <span>Now</span>';
  sectionSub.textContent = 'Top-rated classics and this week\'s popular releases.';
  try {
    const res = await fetch(`${API_BASE}/trending`);
    const data = await res.json();
    renderMovies([...(data.trending || []), ...(data.popular || [])]);
  } catch(e) {}
};

navNowPlaying.onclick = async () => {
  state.mode = 'nowplaying'; state.query = '';
  skeletons(16); filtersBar.classList.add('hidden');
  sectionTitle.innerHTML = 'Now in <span>Cinemas</span>';
  sectionSub.textContent = 'Real-time cinema releases from TMDB.';
  try {
    const res = await fetch(`${API_BASE}/nowplaying`);
    const data = await res.json();
    renderMovies(data.results || data);
  } catch(e) {}
};

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const d = await res.json();
    pillText.textContent = d.omdb ? 'Atlas + TMDB + OMDb' : d.tmdb ? 'Atlas + TMDB' : 'Atlas Search';
  } catch(e) { pillText.textContent = 'Connecting…'; }

  loadGenres();
  navTrending.click();
})();
