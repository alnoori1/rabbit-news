/* ═══════════════════════════════════════════════
   R1 News Fetcher v26 — main.js
   ═══════════════════════════════════════════════ */

const API_BASE = (localStorage.getItem('r1_api_base') || 'https://rabbit-news-worker.swordandscroll.workers.dev').replace(/\/$/, '');
const BREAKING_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.npr.org/1001/rss.xml',
  'https://www.theguardian.com/world/rss',
  'https://feeds.skynews.com/feeds/rss/world.xml',
  'https://www.cbsnews.com/latest/rss/world'
];

const RECENT_SEARCH_KEY = 'r1_recent_searches_v1';
const RECENT_ARTICLE_KEY = 'r1_recent_articles_v1';
const ARTICLE_FONT_KEY = 'r1_article_font_scale_v1';
const SEEN_ARTICLE_KEY = 'r1_seen_article_ids_v1';
const SUPERSEDED_REQUEST_MESSAGE = 'Request replaced by a newer action.';
const CARD_BATCH_SIZE = 20;
const WHEEL_CONFIG = {
  maxVisibleOffset: 3,
  angleStep: 62,
  radius: 132,
  minScale: 0.32
};

/* ── Paywall domain blocklist ── */
const PAYWALL_DOMAINS = [
  'nytimes.com', 'wsj.com', 'ft.com', 'washingtonpost.com',
  'economist.com', 'bloomberg.com', 'thetimes.co.uk', 'telegraph.co.uk',
  'theathletic.com', 'barrons.com', 'hbr.org', 'newyorker.com',
  'wired.com', 'theatlantic.com', 'foreignpolicy.com', 'foreignaffairs.com',
  'medium.com', 'substack.com'
];

function isPaywalled(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return PAYWALL_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

/* ── Region / country RSS feeds ── */
const REGIONS = [
  { label: '🇺🇸 US', url: buildBingNewsSearchFeed('United States news') },
  { label: '🇬🇧 UK', url: buildBingNewsSearchFeed('United Kingdom news') },
  { label: '🇪🇺 Europe', url: buildBingNewsSearchFeed('Europe news') },
  { label: '🌍 Africa', url: buildBingNewsSearchFeed('Africa news') },
  { label: '🌏 Asia', url: buildBingNewsSearchFeed('Asia news') },
  { label: '🏛️ Middle East', url: buildBingNewsSearchFeed('Middle East news') },
  { label: '🇦🇺 Australia', url: buildBingNewsSearchFeed('Australia news') },
  { label: '🌎 L. America', url: buildBingNewsSearchFeed('Latin America news') },
  { label: '🇮🇳 India', url: buildBingNewsSearchFeed('India news') },
  { label: '🇨🇳 China', url: buildBingNewsSearchFeed('China news') },
  { label: '💼 Business', url: buildBingNewsSearchFeed('Business news') },
  { label: '🔬 Sci/Tech', url: buildBingNewsSearchFeed('Technology news') },
  { label: '⚽ Sport', url: buildBingNewsSearchFeed('Sports news') },
  { label: '🎬 Entertain', url: buildBingNewsSearchFeed('Entertainment news') },
  { label: '🏥 Health', url: buildBingNewsSearchFeed('Health news') },
];
const REGIONS_VISIBLE = 6;

/* ── DOM refs ── */
const els = {
  navRefresh: document.getElementById('navRefresh'),
  navHome: document.getElementById('navHome'),
  viewLabel: document.getElementById('viewLabel'),
  fontTools: document.getElementById('fontTools'),
  fontDown: document.getElementById('fontDown'),
  fontUp: document.getElementById('fontUp'),

  viewHome: document.getElementById('viewHome'),
  viewCards: document.getElementById('viewCards'),
  viewArticle: document.getElementById('viewArticle'),

  searchInput: document.getElementById('searchInput'),
  searchForm: document.getElementById('searchForm'),
  regionSelect: document.getElementById('regionSelect'),
  breakingDeck: document.getElementById('breakingDeck'),
  breakingLoading: document.getElementById('breakingLoading'),

  cardCounter: document.getElementById('cardCounter'),
  deck: document.getElementById('deck'),
  moreHint: document.getElementById('moreHint'),
  moreHintText: document.getElementById('moreHintText'),

  articleImage: document.getElementById('articleImage'),
  articleTitle: document.getElementById('articleTitle'),
  articleSource: document.getElementById('articleSource'),
  articleSections: document.getElementById('articleSections'),

  status: document.getElementById('status')
};

/* ── State ── */
const state = {
  view: 'home',
  cards: [],
  activeCardIndex: 0,
  articleFontScale: 0.72,
  regionsExpanded: false,
  breakingCards: [],
  breakingIndex: 0,
  requestControllers: new Map(),
  currentFeedContext: null,
  deckTouchStartY: 0,
  breakingTouchStartY: 0,
  breakingRequestId: 0,
  cardsRequestId: 0,
  lastBreakingRefreshAt: 0,
  loadedCardCount: 0,
  seenArticleIds: new Set(),
  suppressCardEnterUntil: 0
};

/* ═══ Status / Loading ═══ */
let statusTimer;
function setStatus(message, { persist = false } = {}) {
  clearTimeout(statusTimer);
  els.status.textContent = message || '';
  els.status.classList.remove('status--loading');
  if (message && !persist) {
    statusTimer = setTimeout(() => { els.status.textContent = ''; }, 3000);
  }
}

function showLoading(message) {
  els.status.textContent = message || 'Loading…';
  els.status.classList.add('status--loading');
}

function hideLoading() {
  els.status.classList.remove('status--loading');
}

/* ═══ Helpers ═══ */
function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function normaliseToUrl(input) {
  if (!input) return null;
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return null;
}

function addCacheBust(url) {
  return `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
}

function buildBingNewsSearchFeed(query) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
}

function parsePublishedTs(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function decodeHtmlEntities(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value);
  return textarea.value;
}

function simplifyText(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitHeadlineAndSource(title = '', source = '') {
  const marker = ' - ';
  const markerIndex = title.lastIndexOf(marker);
  if (markerIndex > 0) {
    const tail = title.slice(markerIndex + marker.length).trim();
    if (!source || tail.toLowerCase() === source.toLowerCase()) {
      return { title: title.slice(0, markerIndex).trim(), source: source || tail };
    }
  }
  return { title: title.trim(), source: source.trim() };
}

function sourceFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function decodeFeedUrl(url = '') {
  return String(url).replace(/&amp;/g, '&');
}

function unwrapNewsUrl(url) {
  try {
    const parsed = new URL(decodeFeedUrl(url));
    if (parsed.hostname.includes('bing.com') && parsed.pathname.includes('/news/apiclick.aspx')) {
      return parsed.searchParams.get('url') || decodeFeedUrl(url);
    }
    return decodeFeedUrl(url);
  } catch {
    return decodeFeedUrl(url);
  }
}

function formatAge(publishedTs) {
  if (!publishedTs) return '';
  const minutes = Math.max(1, Math.round((Date.now() - publishedTs) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function getCardId(card) {
  return card.id || card.url || card.link || `${card.title || ''}|${card.published || ''}`;
}

function normalizeCard(card = {}) {
  const url = unwrapNewsUrl(card.url || card.link || '');
  const publishedTs = Number(card.publishedTs) || parsePublishedTs(card.published);
  const rawSource = decodeHtmlEntities(card.source || card.sourceName || '');
  const decodedTitle = decodeHtmlEntities(card.title || '');
  const sourceOverride = ['news.google.com', 'bing.com', 'www.bing.com'].includes(rawSource) ? '' : rawSource;
  const split = splitHeadlineAndSource(decodedTitle, sourceOverride);
  const summary = decodeHtmlEntities(String(card.snippet || card.summary || '')).replace(/\s+/g, ' ').trim();
  return {
    ...card,
    id: getCardId(card),
    url,
    link: url,
    title: split.title || card.title || 'Untitled story',
    sourceLabel: split.source || sourceOverride || sourceFromUrl(url),
    publishedTs,
    ageLabel: formatAge(publishedTs),
    summary
  };
}

function dedupeCards(cards = []) {
  const seen = new Set();
  const unique = [];
  cards.forEach((rawCard) => {
    const card = normalizeCard(rawCard);
    if (!card.url) return;
    const key = simplifyText(card.title).slice(0, 90) || card.url;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(card);
  });
  return unique;
}

function applySeenBoost(card, baseScore) {
  return state.seenArticleIds.has(card.id) ? baseScore : baseScore + (4 * 60 * 60 * 1000);
}

function sortFreshCards(cards = [], { maxAgeHours = 96 } = {}) {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  return cards
    .map(normalizeCard)
    .filter((card) => card.url && !isPaywalled(card.url))
    .filter((card) => !card.publishedTs || card.publishedTs >= cutoff)
    .sort((left, right) => applySeenBoost(right, right.publishedTs || 0) - applySeenBoost(left, left.publishedTs || 0));
}

function scoreSearchCard(card, query) {
  const normalizedCard = normalizeCard(card);
  const tokens = simplifyText(query).split(/\s+/).filter(Boolean);
  const title = simplifyText(normalizedCard.title);
  const summary = simplifyText(normalizedCard.summary);
  const source = simplifyText(normalizedCard.sourceLabel);
  const phrase = simplifyText(query);
  let score = normalizedCard.publishedTs || 0;

  if (phrase && title.includes(phrase)) score += 2000000000;
  if (phrase && summary.includes(phrase)) score += 1000000000;

  tokens.forEach((token) => {
    if (title.includes(token)) score += 400000000;
    if (summary.includes(token)) score += 180000000;
    if (source.includes(token)) score += 120000000;
  });

  if (tokens.length && tokens.every((token) => title.includes(token))) score += 1600000000;
  if (tokens.length && tokens.every((token) => (title + ' ' + summary).includes(token))) score += 900000000;

  return applySeenBoost(normalizedCard, score);
}

function sortSearchCards(cards = [], query = '') {
  return cards
    .map(normalizeCard)
    .filter((card) => card.url && !isPaywalled(card.url))
    .sort((left, right) => scoreSearchCard(right, query) - scoreSearchCard(left, query));
}

function saveSeenArticles() {
  storageSave(SEEN_ARTICLE_KEY, Array.from(state.seenArticleIds).slice(-300));
}

function markCardSeen(card) {
  const normalized = normalizeCard(card);
  if (!normalized.id) return;
  state.seenArticleIds.add(normalized.id);
  saveSeenArticles();
}

function appendNextCardBatch() {
  const nextCount = Math.min(state.cards.length, state.loadedCardCount + CARD_BATCH_SIZE);
  for (let index = state.loadedCardCount; index < nextCount; index += 1) {
    els.deck.appendChild(createCardElement(state.cards[index], index));
  }
  state.loadedCardCount = nextCount;
}

function updateLoadMoreHint() {
  const remaining = state.cards.length - state.loadedCardCount;
  const canLoadMore = remaining > 0;
  els.moreHint.classList.toggle('hidden', !canLoadMore);
  if (canLoadMore) {
    const nextBatch = Math.min(CARD_BATCH_SIZE, remaining);
    els.moreHintText.textContent = `${nextBatch} more headlines below`;
  }
}

function isSupersededRequest(error) {
  return error?.message === SUPERSEDED_REQUEST_MESSAGE;
}

function abortManagedRequest(requestKey) {
  if (!requestKey) return;
  const existing = state.requestControllers.get(requestKey);
  if (existing) {
    existing.__abortReason = 'superseded';
    existing.abort('superseded');
    state.requestControllers.delete(requestKey);
  }
}

/* ═══ #11 + #15: API with timeout + cancel in-flight ═══ */
async function api(path, payload, method = 'POST', { requestKey = `${method}:${path}`, timeoutMs = 10000 } = {}) {
  abortManagedRequest(requestKey);
  const controller = new AbortController();
  if (requestKey) {
    state.requestControllers.set(requestKey, controller);
  }

  const timeout = setTimeout(() => {
    controller.__abortReason = 'timeout';
    controller.abort('timeout');
  }, timeoutMs);

  try {
    const requestUrl = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(requestUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      if (controller.__abortReason === 'superseded' || controller.signal.reason === 'superseded') {
        throw new Error(SUPERSEDED_REQUEST_MESSAGE);
      }
      throw new Error('Request timed out. Check your connection.');
    }
    throw error;
  } finally {
    if (requestKey && state.requestControllers.get(requestKey) === controller) {
      state.requestControllers.delete(requestKey);
    }
  }
}

/* ═══ #12: Retry with backoff ═══ */
async function apiWithRetry(path, payload, method = 'POST', options = {}) {
  try {
    return await api(path, payload, method, options);
  } catch (firstError) {
    if (firstError.message === 'Request timed out. Check your connection.' || isSupersededRequest(firstError)) {
      throw firstError;
    }
    await new Promise(r => setTimeout(r, 2000));
    try {
      return await api(path, payload, method, options);
    } catch {
      throw firstError;
    }
  }
}

/* ═══ Storage (creationStorage with localStorage fallback) ═══ */
async function storageSave(key, value) {
  try {
    if (window.creationStorage?.plain) {
      await window.creationStorage.plain.setItem(key, btoa(JSON.stringify(value)));
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* silent */ }
}

async function storageLoad(key) {
  try {
    if (window.creationStorage?.plain) {
      const raw = await window.creationStorage.plain.getItem(key);
      return raw ? JSON.parse(atob(raw)) : null;
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ═══ #16: Migrate localStorage → creationStorage ═══ */
async function migrateStorage() {
  if (!window.creationStorage?.plain) return;
  const keys = [RECENT_SEARCH_KEY, RECENT_ARTICLE_KEY, ARTICLE_FONT_KEY];
  for (const key of keys) {
    try {
      const old = localStorage.getItem(key);
      if (old) {
        const existing = await window.creationStorage.plain.getItem(key);
        if (!existing) {
          await window.creationStorage.plain.setItem(key, btoa(old));
        }
        localStorage.removeItem(key);
      }
    } catch { /* silent */ }
  }
}

/* ═══ Navigation ═══ */
function setView(view, { push = true } = {}) {
  state.view = view;

  els.viewHome.classList.toggle('hidden', view !== 'home');
  els.viewCards.classList.toggle('hidden', view !== 'cards');
  els.viewArticle.classList.toggle('hidden', view !== 'article');

  els.fontTools.classList.toggle('hidden', view !== 'article');
  els.cardCounter.classList.toggle('hidden', view !== 'cards');

  const labels = { home: 'Home', cards: 'News Cards', article: 'Article' };
  els.viewLabel.textContent = labels[view] || 'Home';

  if (push) history.pushState({ view }, '', `#${view}`);
}

function goBackView() {
  if (state.view === 'article') return setView('cards');
  if (state.view === 'cards') return setView('home');
}

function scrollCards(direction) {
  if (!state.cards.length) return;
  if (direction > 0 && state.activeCardIndex >= state.loadedCardCount - 1 && state.loadedCardCount < state.cards.length) {
    appendNextCardBatch();
  }
  state.activeCardIndex = Math.max(0, Math.min(state.loadedCardCount - 1, state.activeCardIndex + direction));
  applyWheelTransforms();
}

function goHomeView() {
  setView('home');
}

/* ═══ Font controls ═══ */
function applyArticleFontScale() {
  state.articleFontScale = Math.max(0.62, Math.min(1.0, Number(state.articleFontScale) || 0.72));
  const sections = document.getElementById('articleSections');
  if (sections) sections.style.fontSize = `${state.articleFontScale}em`;
  storageSave(ARTICLE_FONT_KEY, state.articleFontScale);
}

function changeArticleFont(delta) {
  state.articleFontScale = (Number(state.articleFontScale) || 0.72) + delta;
  applyArticleFontScale();
  setStatus(`Text size: ${Math.round(state.articleFontScale * 100)}%`);
}

/* ═══ Collapsible region grid ═══ */
function renderRegions() {
  els.regionSelect.innerHTML = '<option value="" disabled selected>🌍 By Region</option>';
  REGIONS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.url;
    opt.textContent = r.label;
    els.regionSelect.appendChild(opt);
  });
}

/* ═══ Empty state ═══ */
function renderEmptyState(container, emoji, message) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-emoji">${emoji}</span><span>${message}</span>`;
  container.appendChild(div);
}

/* ═══ Breaking news as 3D wheel ═══ */
function createBreakingCardElement(card, index) {
  const normalizedCard = normalizeCard(card);
  const el = document.createElement('article');
  el.className = 'news-card';
  el.dataset.index = String(index);

  if (normalizedCard.image?.url) {
    const img = document.createElement('img');
    img.className = 'news-card-image';
    img.src = normalizedCard.image.url;
    img.alt = normalizedCard.title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className = 'news-card-image news-card-image--placeholder';
      ph.textContent = 'Breaking';
      el.prepend(ph);
    };
    el.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-image news-card-image--placeholder';
    ph.textContent = 'Breaking';
    el.appendChild(ph);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';
  const meta = document.createElement('div');
  meta.className = 'news-card-meta';
  meta.innerHTML = `<span class="news-card-source">${escapeHtml(normalizedCard.sourceLabel)}</span><span class="news-card-age">${escapeHtml(normalizedCard.ageLabel)}</span>`;
  const title = document.createElement('h3');
  title.textContent = normalizedCard.title || `Story ${index + 1}`;
  content.append(meta, title);
  el.appendChild(content);

  bindCardOpen(el, () => {
    if (normalizedCard.url) readArticle(normalizedCard.url, normalizedCard.image?.url, normalizedCard);
  });
  return el;
}

function applyBreakingWheelTransforms() {
  const cards = [...els.breakingDeck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const active = state.breakingIndex;
  cards.forEach((card, i) => {
    const offset = i - active;
    const absOff = Math.abs(offset);

    if (absOff > WHEEL_CONFIG.maxVisibleOffset) {
      card.style.cssText = 'display:none';
      return;
    }

    const angle = offset * WHEEL_CONFIG.angleStep;
    const radius = WHEEL_CONFIG.radius;
    const y = Math.sin(angle * Math.PI / 180) * radius;
    const z = (Math.cos(angle * Math.PI / 180) - 1) * radius;
    const scale = Math.max(WHEEL_CONFIG.minScale, Math.cos(angle * Math.PI / 180));
    const opacity = Math.max(0, Math.cos(angle * Math.PI / 180) * 1.1 - 0.1);
    const blur = Math.min(2.8, absOff * 1.1);

    card.style.cssText = `
      display: block;
      transform: translateY(${y}px) translateZ(${z}px) rotateX(${-angle}deg) scale(${scale.toFixed(3)});
      opacity: ${opacity.toFixed(3)};
      z-index: ${10 - absOff};
      pointer-events: ${absOff === 0 ? 'auto' : 'none'};
      filter: blur(${blur.toFixed(2)}px);
    `;
    card.classList.toggle('is-active', i === active);
  });

  // Update breaking counter
  const bc = document.getElementById('breakCounter');
  if (bc) bc.textContent = `${active + 1} / ${cards.length}`;
}

function scrollBreaking(direction) {
  if (!state.breakingCards.length) return;
  state.breakingIndex = Math.max(0, Math.min(state.breakingCards.length - 1, state.breakingIndex + direction));
  applyBreakingWheelTransforms();
}

async function loadBreakingNewsInline() {
  const requestId = ++state.breakingRequestId;
  try {
    els.breakingLoading.classList.remove('hidden');
    els.breakingLoading.textContent = 'Aggregating global sources…';

    const promises = BREAKING_FEEDS.map((feedUrl, index) => {
      const cacheBustedUrl = addCacheBust(feedUrl);
      return api('/top', { url: cacheBustedUrl }, 'POST', { requestKey: `breaking:${index}` }).catch((error) => {
        if (isSupersededRequest(error)) return null;
        return null;
      });
    });

    const results = await Promise.all(promises);
    if (requestId !== state.breakingRequestId) return;
    els.breakingLoading.classList.add('hidden');

    let allCards = [];
    results.forEach(res => {
      if (res && res.items) allCards = allCards.concat(res.items);
    });

    if (!allCards.length) {
      renderEmptyState(els.breakingDeck, '📡', 'No breaking news right now');
      return;
    }

    const uniqueCards = sortFreshCards(dedupeCards(allCards)).slice(0, 24);
    state.breakingCards = uniqueCards;
    els.breakingDeck.innerHTML = '';
    state.breakingIndex = 0;
    state.lastBreakingRefreshAt = Date.now();
    state.breakingCards.forEach((card, index) => {
      els.breakingDeck.appendChild(createBreakingCardElement(card, index));
    });
    applyBreakingWheelTransforms();
  } catch (error) {
    if (requestId !== state.breakingRequestId || isSupersededRequest(error)) return;
    els.breakingLoading.textContent = 'Could not load breaking news.';
  }
}

/* ═══ #3: Card creation with entrance animations ═══ */
function bindCardOpen(element, handler) {
  let lastTouchOpenAt = 0;
  element.addEventListener('click', () => {
    if (Date.now() - lastTouchOpenAt < 450) return;
    handler();
  });
  element.addEventListener('touchend', (ev) => {
    ev.preventDefault();
    lastTouchOpenAt = Date.now();
    handler();
  }, { passive: false });
}

function createCardElement(card, index) {
  const normalizedCard = normalizeCard(card);
  const article = document.createElement('article');
  article.className = 'news-card animate-in';
  article.style.animationDelay = `${index * 50}ms`;
  article.dataset.index = String(index);

  if (normalizedCard.image?.url) {
    const img = document.createElement('img');
    img.className = 'news-card-image';
    img.src = normalizedCard.image.url;
    img.alt = normalizedCard.image.alt || normalizedCard.title || `News image ${index + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className = 'news-card-image news-card-image--placeholder';
      ph.textContent = 'Top Story';
      article.prepend(ph);
    };
    article.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-image news-card-image--placeholder';
    ph.textContent = 'Top Story';
    article.appendChild(ph);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';
  const meta = document.createElement('div');
  meta.className = 'news-card-meta';
  meta.innerHTML = `<span class="news-card-source">${escapeHtml(normalizedCard.sourceLabel)}</span><span class="news-card-age">${escapeHtml(normalizedCard.ageLabel)}</span>`;

  const title = document.createElement('h3');
  title.textContent = normalizedCard.title || `Story ${index + 1}`;

  const snippet = document.createElement('p');
  snippet.textContent = normalizedCard.summary || 'Tap to open full story.';

  content.append(meta, title, snippet);
  article.appendChild(content);

  const openCard = () => {
    const articleUrl = normalizedCard.url || normalizedCard.link;
    if (articleUrl) readArticle(articleUrl, normalizedCard.image?.url, normalizedCard);
  };
  bindCardOpen(article, openCard);

  return article;
}

/* ═══ 3D Wheel Carousel ═══ */
function applyWheelTransforms() {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const active = state.activeCardIndex;
  updateLoadMoreHint();

  cards.forEach((card, i) => {
    const offset = i - active; // -2, -1, 0, 1, 2...
    const absOff = Math.abs(offset);

    if (absOff > WHEEL_CONFIG.maxVisibleOffset) {
      card.style.cssText = 'display:none';
      return;
    }

    const angle = offset * WHEEL_CONFIG.angleStep;
    const radius = WHEEL_CONFIG.radius;
    const y = Math.sin(angle * Math.PI / 180) * radius;
    const z = (Math.cos(angle * Math.PI / 180) - 1) * radius;
    const scale = Math.max(WHEEL_CONFIG.minScale, Math.cos(angle * Math.PI / 180));
    const opacity = Math.max(0, Math.cos(angle * Math.PI / 180) * 1.1 - 0.1);
    const blur = Math.min(2.8, absOff * 1.1);

    card.style.cssText = `
      display: block;
      transform: translateY(${y}px) translateZ(${z}px) rotateX(${-angle}deg) scale(${scale.toFixed(3)});
      opacity: ${opacity.toFixed(3)};
      z-index: ${10 - absOff};
      pointer-events: ${absOff === 0 ? 'auto' : 'none'};
      filter: blur(${blur.toFixed(2)}px);
    `;

    card.classList.toggle('is-active', i === active);
  });

  // Card counter
  els.cardCounter.textContent = `${active + 1} / ${state.cards.length}`;
}

function refreshActiveCard() {
  if (state.view !== 'cards') return;
  applyWheelTransforms();
}

function renderCards(cards = [], sourceLabel = 'News') {
  state.cards = cards.map(normalizeCard);
  state.activeCardIndex = 0;
  state.loadedCardCount = 0;
  els.deck.innerHTML = '';

  if (!state.cards.length) {
    els.moreHint.classList.add('hidden');
    setStatus('No cards found. Try another source or keyword.');
    return;
  }

  appendNextCardBatch();

  setView('cards');
  applyWheelTransforms();
  setStatus(`${sourceLabel}: ${state.cards.length} cards`);
}

/* ═══ Article with lead image (always preserved) ═══ */
function renderArticle(data, fallbackImageUrl) {
  els.articleTitle.textContent = data.title || 'Article';

  // Show lead image: API image > fallback from card > hidden
  const imgUrl = data.image?.url || data.leadImage || fallbackImageUrl;
  if (imgUrl) {
    els.articleImage.src = imgUrl;
    els.articleImage.alt = data.title || 'Article image';
    els.articleImage.classList.remove('hidden');
    els.articleImage.onerror = () => els.articleImage.classList.add('hidden');
  } else {
    els.articleImage.classList.add('hidden');
  }

  if (data.url) {
    els.articleSource.href = data.url;
    els.articleSource.classList.remove('hidden');
  } else {
    els.articleSource.classList.add('hidden');
  }

  els.articleSections.innerHTML = '';

  // Readability returns data.content (HTML) and data.textContent (plain text)
  const htmlContent = data.content || '';
  if (!htmlContent) {
    renderEmptyState(els.articleSections, '📄', 'Could not extract article text.');
    return;
  }

  const block = document.createElement('section');
  block.className = 'article-chunk article-chunk--plain animate-in';
  // Sanitise: remove scripts, styles, and ALL inline width/height/style attributes
  let cleanHtml = htmlContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\s+width\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+height\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');
  block.innerHTML = cleanHtml;

  // Post-insert DOM cleanup: remove any remaining size attributes from all elements
  block.querySelectorAll('*').forEach(el => {
    el.removeAttribute('width');
    el.removeAttribute('height');
    el.removeAttribute('style');
    el.style.maxWidth = '100%';
    el.style.boxSizing = 'border-box';
  });
  // Remove ALL inline images, pictures, and figures from the article content (user only wants the single top-level lead image)
  block.querySelectorAll('img, picture, figure').forEach(el => el.remove());
  els.articleSections.appendChild(block);
}

function renderArticleFallback(url, fallbackImageUrl, message) {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'source';
    }
  })();

  els.articleTitle.textContent = `Open on ${host}`;
  if (fallbackImageUrl) {
    els.articleImage.src = fallbackImageUrl;
    els.articleImage.alt = host;
    els.articleImage.classList.remove('hidden');
    els.articleImage.onerror = () => els.articleImage.classList.add('hidden');
  } else {
    els.articleImage.classList.add('hidden');
  }

  els.articleSource.href = url;
  els.articleSource.classList.remove('hidden');
  els.articleSections.innerHTML = '';
  renderEmptyState(els.articleSections, '📰', message || 'Open the original source to keep reading.');
  setView('article');
  applyArticleFontScale();
}

/* ═══ API actions ═══ */
async function fetchNewsFromUrl(url, label = 'Source News') {
  const requestId = ++state.cardsRequestId;
  state.currentFeedContext = { type: 'url', url, label };
  try {
    showLoading('Fetching news cards…');
    const data = await apiWithRetry('/top', { url: addCacheBust(url) }, 'POST', { requestKey: 'cards' });
    if (requestId !== state.cardsRequestId) return;
    hideLoading();
    const preparedCards = sortFreshCards(dedupeCards(data.items || []), { maxAgeHours: 7 * 24 });
    renderCards(preparedCards, label || data.domain || 'News');
  } catch (error) {
    if (requestId !== state.cardsRequestId) return;
    if (isSupersededRequest(error)) return;
    hideLoading();
    renderErrorCard(error.message, () => fetchNewsFromUrl(url, label));
  }
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');
  const requestId = ++state.cardsRequestId;
  state.currentFeedContext = { type: 'search', query: q };

  try {
    showLoading('Searching across sources…');
    const searchFeeds = [
      buildBingNewsSearchFeed(q),
      buildBingNewsSearchFeed(`"${q}"`),
      buildBingNewsSearchFeed(`${q} latest`)
    ];
    const results = await Promise.all(searchFeeds.map((searchUrl, index) =>
      apiWithRetry('/top', { url: addCacheBust(searchUrl) }, 'POST', { requestKey: `search:${index}` }).catch(() => ({ items: [] }))
    ));
    if (requestId !== state.cardsRequestId) return;
    hideLoading();
    const combinedCards = dedupeCards(results.flatMap((result) => result.items || []));
    const rankedCards = sortSearchCards(combinedCards, q).slice(0, 60);
    renderCards(rankedCards, `Search: ${q}`);
  } catch (error) {
    if (requestId !== state.cardsRequestId) return;
    if (isSupersededRequest(error)) return;
    hideLoading();
    renderErrorCard(error.message, () => searchNews(query));
  }
}

async function readArticle(url, cardImageUrl, cardMeta = null) {
  if (cardMeta) markCardSeen(cardMeta);
  if (isPaywalled(url)) {
    setStatus('⚠️ This source may require a subscription.', { persist: true });
  }
  try {
    showLoading('Opening article…');
    const data = await apiWithRetry('/article', { url: addCacheBust(url) }, 'POST', { requestKey: 'article' });
    hideLoading();

    const textContent = data.textContent || data.content || '';
    if (textContent.length < 100) {
      setStatus('⚠️ Article may be behind a paywall — limited content available.', { persist: true });
    }

    renderArticle(data, cardImageUrl);
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyArticleFontScale();
    setStatus(`Opened article from ${new URL(url).hostname || 'source'}.`);
  } catch (error) {
    if (isSupersededRequest(error)) return;
    hideLoading();
    renderArticleFallback(url, cardImageUrl, 'Could not extract this story cleanly here. Use the source link below.');
    setStatus(error.message, { persist: true });
  }
}

/* ═══ #14: Error card with retry ═══ */
function renderErrorCard(message, retryFn) {
  state.cards = [];
  els.deck.innerHTML = '';

  const el = document.createElement('div');
  el.className = 'error-card animate-in';
  el.innerHTML = `
    <span class="empty-emoji">⚠️</span>
    <p>${escapeHtml(message)}</p>
    <button class="btn btn-soft" id="retryBtn">Retry</button>
  `;
  els.deck.appendChild(el);
  el.querySelector('#retryBtn').addEventListener('click', retryFn);

  setView('cards');
}

/* ═══ #13: Health check + resume ═══ */
async function healthCheck() {
  try {
    // Direct fetch to avoid canceling other api() requests
    // Custom timeout implementation since AbortSignal.timeout() is not supported on older R1 WebViews
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    await fetch(`${API_BASE}/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (error) {
    if (error.name !== 'AbortError') {
      setStatus(`API unavailable: ${error.message}`, { persist: true });
    }
  }
}

/* ═══ Persistence ═══ */
async function loadRecent() {
  try {
    const fontVal = await storageLoad(ARTICLE_FONT_KEY);
    state.articleFontScale = Number(fontVal) || 0.72;
    const seenIds = await storageLoad(SEEN_ARTICLE_KEY);
    state.seenArticleIds = new Set(Array.isArray(seenIds) ? seenIds : []);
  } catch {
    state.articleFontScale = 0.72;
    state.seenArticleIds = new Set();
  }
  applyArticleFontScale();
}

/* ═══ UI bindings ═══ */
function bindUi() {
  els.navRefresh.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (state.view === 'cards' && state.currentFeedContext) {
      if (state.currentFeedContext.type === 'url') {
        fetchNewsFromUrl(state.currentFeedContext.url, state.currentFeedContext.label);
      } else if (state.currentFeedContext.type === 'search') {
        searchNews(state.currentFeedContext.query);
      }
    } else {
      goHomeView();
      // Clear out search input and trigger fresh fetch
      els.searchInput.value = '';
      els.regionSelect.selectedIndex = 0;

      // Soft reload the breaking news inline
      loadBreakingNewsInline();
    }
  });
  els.navHome.addEventListener('click', goHomeView);

  els.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.suppressCardEnterUntil = Date.now() + 450;
    searchNews(els.searchInput.value);
  });

  els.regionSelect.addEventListener('change', () => {
    const query = els.regionSelect.value;
    const opt = els.regionSelect.options[els.regionSelect.selectedIndex];
    if (query) {
      els.searchInput.value = '';
      fetchNewsFromUrl(query, opt.textContent);
      els.regionSelect.selectedIndex = 0; // Reset after navigation
    }
  });

  // Breaking news nav arrows removed per user request

  // Font controls
  els.fontDown.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(-0.08); });
  els.fontUp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(0.08); });

  els.deck.addEventListener('touchstart', (event) => {
    state.deckTouchStartY = event.touches[0]?.clientY || 0;
  }, { passive: true });
  els.deck.addEventListener('touchend', (event) => {
    const touchY = event.changedTouches[0]?.clientY || 0;
    if (state.deckTouchStartY - touchY > 30) scrollCards(1);
    else if (touchY - state.deckTouchStartY > 30) scrollCards(-1);
  }, { passive: true });

  els.breakingDeck.addEventListener('touchstart', (event) => {
    state.breakingTouchStartY = event.touches[0]?.clientY || 0;
  }, { passive: true });
  els.breakingDeck.addEventListener('touchend', (event) => {
    const touchY = event.changedTouches[0]?.clientY || 0;
    if (state.breakingTouchStartY - touchY > 30) scrollBreaking(1);
    else if (touchY - state.breakingTouchStartY > 30) scrollBreaking(-1);
  }, { passive: true });

  window.addEventListener('resize', refreshActiveCard, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (state.view === 'cards') {
      if (['ArrowDown', 'PageDown', 'j', 'J'].includes(event.key)) { event.preventDefault(); scrollCards(1); return; }
      if (['ArrowUp', 'PageUp', 'k', 'K'].includes(event.key)) { event.preventDefault(); scrollCards(-1); return; }
      if (event.key === 'Enter') {
        if (Date.now() < state.suppressCardEnterUntil) return;
        event.preventDefault();
        const a = state.cards[state.activeCardIndex];
        if (a?.url) readArticle(a.url, a.image?.url, a);
      }
      return;
    }
    if (state.view === 'article') {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeArticleFont(0.08); }
      else if (event.key === '-') { event.preventDefault(); changeArticleFont(-0.08); }
    }
  });

  window.addEventListener('popstate', (event) => {
    const view = event.state?.view || 'home';
    setView(view, { push: false });
  });

  // #13 Health check on resume
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      healthCheck();
      if (state.view === 'home' && (!state.breakingCards.length || Date.now() - state.lastBreakingRefreshAt > 120000)) {
        loadBreakingNewsInline();
      }
    }
  });
}

/* ═══ R1 hardware (scroll + PTT) with throttle ═══ */
function initR1Hardware() {
  let scrollLock = false;
  const SCROLL_COOLDOWN = 180;

  function throttledScroll(handler) {
    if (scrollLock) return;
    scrollLock = true;
    handler();
    setTimeout(() => { scrollLock = false; }, SCROLL_COOLDOWN);
  }

  window.addEventListener('scrollUp', () => {
    throttledScroll(() => {
      if (state.view === 'cards') {
        scrollCards(-1);
      } else if (state.view === 'article') {
        window.scrollBy({ top: -60, behavior: 'smooth' });
      } else if (state.view === 'home') {
        // #7 Pull-to-refresh: if at top, refresh breaking news
        if (window.scrollY <= 0) {
          scrollBreaking(-1);
        } else {
          window.scrollBy({ top: -50, behavior: 'smooth' });
        }
      }
    });
  });

  window.addEventListener('scrollDown', () => {
    throttledScroll(() => {
      if (state.view === 'cards') {
        scrollCards(1);
      } else if (state.view === 'article') {
        window.scrollBy({ top: 60, behavior: 'smooth' });
      } else if (state.view === 'home') {
        if (window.scrollY <= 0) {
          scrollBreaking(1);
        } else {
          window.scrollBy({ top: 50, behavior: 'smooth' });
        }
      }
    });
  });

  // PTT: open active card in cards view
  window.addEventListener('sideClick', () => {
    if (state.view === 'cards') {
      const active = state.cards[state.activeCardIndex];
      if (active?.url) readArticle(active.url, active.image?.url);
    } else if (state.view === 'article') {
      goBackView();
    }
  });
}

/* ═══ Service Worker registration & cache busting ═══ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=64').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New SW found, force clear caches and hard reload
            caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
              .then(() => window.location.reload(true));
          }
        });
      });
    }).catch(() => { /* silent */ });
  }
}

/* ═══ #17: Boot with error boundary ═══ */
function boot() {
  try {
    bindUi();
    initR1Hardware();
    renderRegions();
    loadRecent();
    migrateStorage(); // #16
    setView('home', { push: false });
    history.replaceState({ view: 'home' }, '', '#home');
    healthCheck();
    loadBreakingNewsInline();
    registerSW(); // #10
  } catch (error) {
    document.body.innerHTML = `
      <div style="padding:1rem;color:#f2f5f9;font-family:system-ui;text-align:center;margin-top:2rem;">
        <p style="font-size:1.5rem;">⚠️</p>
        <p style="font-size:.8rem;margin:.5rem 0;">Something went wrong</p>
        <button onclick="location.reload()" style="padding:.4rem .8rem;border-radius:8px;border:1px solid #2a3240;background:#212b39;color:#f2f5f9;font-size:.72rem;cursor:pointer;">Tap to reload</button>
      </div>
    `;
  }
}

boot();
