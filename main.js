/* ═══════════════════════════════════════════════
   R1 News Fetcher v26 — main.js
   ═══════════════════════════════════════════════ */

const APP_VERSION = '78';
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
const SOURCE_HEALTH_KEY = 'r1_source_health_v1';
const SHELL_VERSION_KEY = 'r1_shell_version';
const SUPERSEDED_REQUEST_MESSAGE = 'Request replaced by a newer action.';
const CARD_BATCH_SIZE = 20;
const TAP_OPEN_MAX_DELTA = 12;
const WHEEL_CONFIG = {
  maxVisibleOffset: 2.2,
  angleStep: 55,
  radius: 104,
  minScale: 0.45
};
const LIVE_COVERAGE_TITLE_RE = /\b(live updates?|what to know|as it happened|live blog|minute by minute|watch live)\b/i;
const LIVE_COVERAGE_URL_RE = /\/(?:live|live-updates?|blogs?)\/|\/live-updates(?:[-/]|$)|[?&]page=live\b/i;
const VIDEO_STORY_RE = /\/videos?\//i;
const READER_INCOMPATIBLE_URL_RE = /\/(?:videos?|video|audio|podcasts?|gallery|photos|pictures|slideshow|interactive|shorts?)\//i;
const READER_INCOMPATIBLE_TITLE_RE = /^(watch|listen|photos):/i;
const AGGREGATOR_HOST_PENALTIES = {
  'aol.com': 1.5,
  'msn.com': 1.8,
  'uk.news.yahoo.com': 0.9,
  'news.yahoo.com': 0.8,
  'finance.yahoo.com': 0.8
};
const ARTICLE_WARNING_LABELS = {
  thin_content: 'This source did not provide enough clean article text.',
  high_link_density: 'This page was link-heavy and likely mixed with related headlines.',
  headline_list: 'This page looked more like a headline list than a clean article.',
  headline_noise: 'This article contained embedded headline clusters that were removed.',
  related_content: 'Related-story blocks were removed for readability.',
  readability_failed: 'This source did not produce a reliable reader view.'
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
  {
    key: 'us',
    label: 'US',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml'],
      queries: ['United States news', 'US politics', 'US economy']
    })
  },
  {
    key: 'uk',
    label: 'UK',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/uk/rss.xml'],
      queries: ['United Kingdom news', 'UK politics', 'Britain economy']
    })
  },
  {
    key: 'europe',
    label: 'Europe',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/europe/rss.xml'],
      queries: ['Europe news', 'European Union news', 'Europe politics']
    })
  },
  {
    key: 'africa',
    label: 'Africa',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/africa/rss.xml'],
      queries: ['Africa news', 'African Union news', 'East Africa news']
    })
  },
  {
    key: 'asia',
    label: 'Asia',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/asia/rss.xml'],
      queries: ['Asia news', 'East Asia news', 'South Asia news']
    })
  },
  {
    key: 'middle-east',
    label: 'Middle East',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/middle_east/rss.xml'],
      queries: ['Middle East news', 'Gulf news', 'Levant news']
    })
  },
  {
    key: 'australia',
    label: 'Australia',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/australia/rss.xml'],
      queries: ['Australia news', 'Oceania news', 'New Zealand news']
    })
  },
  {
    key: 'latin-america',
    label: 'L. America',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/world/latin_america/rss.xml'],
      queries: ['Latin America news', 'South America news', 'Central America news']
    })
  },
  {
    key: 'india',
    label: 'India',
    feeds: buildRegionalFeedBundle({
      queries: ['India news', 'India politics', 'India economy']
    })
  },
  {
    key: 'china',
    label: 'China',
    feeds: buildRegionalFeedBundle({
      queries: ['China news', 'China economy', 'China politics']
    })
  },
  {
    key: 'business',
    label: 'Business',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/business/rss.xml'],
      queries: ['Business news', 'Global markets news', 'Economy news']
    })
  },
  {
    key: 'science-tech',
    label: 'Sci/Tech',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/technology/rss.xml'],
      queries: ['Technology news', 'AI news', 'Science news']
    })
  },
  {
    key: 'sport',
    label: 'Sport',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/sport/rss.xml'],
      queries: ['Sports news', 'Football news', 'Basketball news']
    })
  },
  {
    key: 'entertainment',
    label: 'Entertain',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'],
      queries: ['Entertainment news', 'Film and TV news', 'Music news']
    })
  },
  {
    key: 'health',
    label: 'Health',
    feeds: buildRegionalFeedBundle({
      directFeeds: ['https://feeds.bbci.co.uk/news/health/rss.xml'],
      queries: ['Health news', 'Medical research news', 'Public health news']
    })
  },
];
const REGION_MAP = new Map(REGIONS.map((region) => [region.key, region]));
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
  articleNotice: document.getElementById('articleNotice'),
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
  breakingWheelPosition: 0,
  breakingWheelTarget: 0,
  breakingWheelFrame: 0,
  breakingWheelAnimationStart: 0,
  breakingWheelAnimationFrom: 0,
  requestControllers: new Map(),
  currentFeedContext: null,
  deckTouchStartY: 0,
  breakingTouchStartY: 0,
  breakingRequestId: 0,
  cardsRequestId: 0,
  lastBreakingRefreshAt: 0,
  cardWheelPosition: 0,
  cardWheelTarget: 0,
  cardWheelFrame: 0,
  cardWheelAnimationStart: 0,
  cardWheelAnimationFrom: 0,
  loadedCardCount: 0,
  seenArticleIds: new Set(),
  sourceHealth: {},
  suppressCardEnterUntil: 0,
  currentArticleContext: null
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

function buildRegionalFeedBundle({ queries = [], directFeeds = [] } = {}) {
  return [...new Set([
    ...directFeeds,
    ...queries.map((query) => buildBingNewsSearchFeed(query))
  ])];
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

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function upgradeImageUrl(url, host = '') {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    if (/ichef\.bbci\.co\.uk$/i.test(parsed.hostname)) {
      parsed.pathname = parsed.pathname.replace(/\/news\/\d+\//i, '/news/1024/');
      return parsed.toString();
    }

    ['w', 'width'].forEach((key) => {
      const value = Number(parsed.searchParams.get(key) || 0);
      if (value && value < 1200) parsed.searchParams.set(key, '1200');
    });
    ['h', 'height'].forEach((key) => {
      const value = Number(parsed.searchParams.get(key) || 0);
      if (value && value < 900) parsed.searchParams.set(key, '900');
    });
    if (parsed.searchParams.has('quality')) {
      parsed.searchParams.set('quality', '90');
    }
    if (parsed.searchParams.has('q')) {
      const value = Number(parsed.searchParams.get('q') || 0);
      if (value && value < 90) parsed.searchParams.set('q', '90');
    }

    let upgraded = parsed.toString()
      .replace(/([?&](?:w|width)=)(\d{2,4})/gi, (_, prefix) => `${prefix}1200`)
      .replace(/([?&](?:h|height)=)(\d{2,4})/gi, (_, prefix) => `${prefix}900`)
      .replace(/([?&](?:quality|q)=)(\d{1,3})/gi, (_, prefix) => `${prefix}90`)
      .replace(/\/(?:square|thumbnail|thumb|small|tiny)[/_-]/gi, '/large/');

    if (/reuters\.com$/i.test(host || parsed.hostname)) {
      upgraded = upgraded.replace(/\/\d+\?/, '/1200?');
    }

    return upgraded;
  } catch {
    return url;
  }
}

function getSourcePenalty(host) {
  const health = state.sourceHealth[host] || { clean: 0, sourceOnly: 0, failed: 0 };
  const learnedPenalty = Math.max(0, (health.sourceOnly * 0.9) + (health.failed * 1.2) - (health.clean * 0.45));
  return (AGGREGATOR_HOST_PENALTIES[host] || 0) + learnedPenalty;
}

function summarizeWarnings(warnings = []) {
  const message = warnings.map((warning) => ARTICLE_WARNING_LABELS[warning]).filter(Boolean)[0];
  return message || '';
}

function setArticleNotice(message = '', tone = 'info') {
  if (!els.articleNotice) return;
  els.articleNotice.textContent = message;
  els.articleNotice.classList.toggle('hidden', !message);
  els.articleNotice.classList.toggle('article-note--warn', tone === 'warn');
}

function buildCardFlags(card) {
  const flags = [];
  if (!state.seenArticleIds.has(card.id)) {
    flags.push({ label: 'NEW', tone: 'new' });
  }
  if (getSourcePenalty(card.host) >= 2) {
    flags.push({ label: 'SITE', tone: 'source' });
  }
  return flags;
}

function getCardId(card) {
  return card.id || card.url || card.link || `${card.title || ''}|${card.published || ''}`;
}

function normalizeCard(card = {}) {
  const url = unwrapNewsUrl(card.url || card.link || '');
  const publishedTs = Number(card.publishedTs) || parsePublishedTs(card.published);
  const rawSource = decodeHtmlEntities(card.source || card.sourceName || '');
  const decodedTitle = decodeHtmlEntities(card.title || '');
  const sourceOverride = ['bing.com', 'www.bing.com'].includes(rawSource) ? '' : rawSource;
  const split = splitHeadlineAndSource(decodedTitle, sourceOverride);
  const summary = decodeHtmlEntities(String(card.snippet || card.summary || '')).replace(/\s+/g, ' ').trim();
  const host = getHostFromUrl(url);
  const cardImage = card.image?.url ? {
    ...card.image,
    url: upgradeImageUrl(card.image.url, host)
  } : null;
  return {
    ...card,
    id: getCardId(card),
    url,
    link: url,
    title: split.title || card.title || 'Untitled story',
    sourceLabel: split.source || sourceOverride || sourceFromUrl(url),
    host,
    publishedTs,
    ageLabel: formatAge(publishedTs),
    summary,
    image: cardImage,
    isNew: !state.seenArticleIds.has(getCardId(card))
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

function scoreFreshCard(card) {
  const livePenalty = LIVE_COVERAGE_TITLE_RE.test(card.title) ? (5 * 60 * 60 * 1000) : 0;
  const sourcePenalty = getSourcePenalty(card.host) * (90 * 60 * 1000);
  return applySeenBoost(card, (card.publishedTs || 0) - livePenalty - sourcePenalty);
}

function isLiveCoverageCard(card) {
  const normalizedCard = normalizeCard(card);
  return (
    LIVE_COVERAGE_TITLE_RE.test(normalizedCard.title || '') ||
    LIVE_COVERAGE_TITLE_RE.test(normalizedCard.summary || '') ||
    LIVE_COVERAGE_URL_RE.test(normalizedCard.url || '')
  );
}

function isVideoStoryCard(card) {
  const normalizedCard = normalizeCard(card);
  return (
    VIDEO_STORY_RE.test(normalizedCard.url || '') ||
    /^watch:/i.test(normalizedCard.title || '')
  );
}

function isReaderFriendlyCard(card) {
  const normalizedCard = normalizeCard(card);
  if (!normalizedCard.url || isPaywalled(normalizedCard.url)) return false;
  if (isLiveCoverageCard(normalizedCard)) return false;
  if (isVideoStoryCard(normalizedCard)) return false;
  if (READER_INCOMPATIBLE_URL_RE.test(normalizedCard.url || '')) return false;
  if (READER_INCOMPATIBLE_TITLE_RE.test(normalizedCard.title || '')) return false;
  if (getSourcePenalty(normalizedCard.host) >= 3.2) return false;
  return true;
}

function scoreBreakingCard(card) {
  const normalizedCard = normalizeCard(card);
  let score = scoreFreshCard(normalizedCard);
  if (isLiveCoverageCard(normalizedCard)) score -= 24 * 60 * 60 * 1000;
  if (isVideoStoryCard(normalizedCard)) score -= 6 * 60 * 60 * 1000;
  return score;
}

function sortFreshCards(cards = [], { maxAgeHours = 96 } = {}) {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  return cards
    .map(normalizeCard)
    .filter(isReaderFriendlyCard)
    .filter((card) => !card.publishedTs || card.publishedTs >= cutoff)
    .sort((left, right) => scoreFreshCard(right) - scoreFreshCard(left));
}

function sortBreakingCards(cards = [], { maxAgeHours = 96 } = {}) {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  const normalized = cards
    .map(normalizeCard)
    .filter(isReaderFriendlyCard)
    .filter((card) => !card.publishedTs || card.publishedTs >= cutoff);

  const standalone = normalized
    .filter((card) => !isLiveCoverageCard(card))
    .sort((left, right) => scoreBreakingCard(right) - scoreBreakingCard(left));

  const liveCoverage = normalized
    .filter((card) => isLiveCoverageCard(card))
    .sort((left, right) => scoreBreakingCard(right) - scoreBreakingCard(left));

  return dedupeCards([...standalone, ...liveCoverage]);
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

  score -= getSourcePenalty(normalizedCard.host) * 450000000;
  if (LIVE_COVERAGE_TITLE_RE.test(normalizedCard.title) && !/live/i.test(query)) {
    score -= 350000000;
  }

  return applySeenBoost(normalizedCard, score);
}

function sortSearchCards(cards = [], query = '') {
  return cards
    .map(normalizeCard)
    .filter(isReaderFriendlyCard)
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
    const remainingAfterBatch = state.cards.length - nextCount;
    const nextBatchCount = Math.min(CARD_BATCH_SIZE, Math.max(0, remainingAfterBatch));
    const shouldShowLoadMore = index === nextCount - 1 && remainingAfterBatch > 0;
    els.deck.appendChild(createCardElement(state.cards[index], index, { shouldShowLoadMore, nextBatchCount }));
  }
  state.loadedCardCount = nextCount;
}

function updateLoadMoreHint() {
  const remaining = state.cards.length - state.loadedCardCount;
  const canLoadMore = remaining > 0 && state.activeCardIndex === state.loadedCardCount - 1;
  els.moreHint.classList.toggle('hidden', !canLoadMore);
  if (canLoadMore) {
    const nextBatch = Math.min(CARD_BATCH_SIZE, remaining);
    els.moreHintText.textContent = `Scroll for ${nextBatch} more headlines`;
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
  const keys = [RECENT_SEARCH_KEY, RECENT_ARTICLE_KEY, ARTICLE_FONT_KEY, SEEN_ARTICLE_KEY, SOURCE_HEALTH_KEY];
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

function cancelWheelAnimation(frameKey) {
  if (state[frameKey]) {
    cancelAnimationFrame(state[frameKey]);
    state[frameKey] = 0;
  }
}

function scrollCards(direction) {
  if (!state.cards.length) return;
  if (direction > 0 && state.activeCardIndex >= state.loadedCardCount - 1 && state.loadedCardCount < state.cards.length) {
    appendNextCardBatch();
  }
  const nextIndex = Math.max(0, Math.min(state.loadedCardCount - 1, state.activeCardIndex + direction));
  if (nextIndex === state.activeCardIndex && state.cardWheelTarget === nextIndex) return;
  state.activeCardIndex = nextIndex;
  state.cardWheelPosition = nextIndex;
  state.cardWheelTarget = nextIndex;
  cancelWheelAnimation('cardWheelFrame');
  applyWheelTransforms();
}

function goHomeView() {
  setView('home');
}

/* ═══ Font controls ═══ */
function applyArticleFontScale() {
  state.articleFontScale = Math.max(0.62, Math.min(1.72, Number(state.articleFontScale) || 0.72));
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
  els.regionSelect.innerHTML = '<option value="" disabled selected>By Region</option>';
  REGIONS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.key;
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

function createCardMetaElement(card) {
  const meta = document.createElement('div');
  meta.className = 'news-card-meta';

  const source = document.createElement('span');
  source.className = 'news-card-source';
  source.textContent = card.sourceLabel;

  const age = document.createElement('span');
  age.className = 'news-card-age';
  age.textContent = card.ageLabel;

  meta.append(source, age);

  const flags = buildCardFlags(card);
  if (flags.length) {
    const flagWrap = document.createElement('span');
    flagWrap.className = 'news-card-flags';
    flags.forEach((flag) => {
      const el = document.createElement('span');
      el.className = `news-card-flag${flag.tone === 'source' ? ' news-card-flag--source' : ''}`;
      el.textContent = flag.label;
      flagWrap.appendChild(el);
    });
    meta.appendChild(flagWrap);
  }

  return meta;
}

/* ═══ Breaking news as 3D wheel ═══ */
function createBreakingCardElement(card, index) {
  return createCardElement(card, index, { placeholderLabel: 'Breaking', includeSummary: true });
}

function applyWheelTransformsToNodes(cards, activePosition, { updateLoadMore = false, counterId = null, activeIndex = null } = {}) {
  if (!cards.length) return;
  if (updateLoadMore) updateLoadMoreHint();

  const focusedIndex = Math.max(0, Math.min(cards.length - 1, activeIndex ?? Math.round(activePosition)));
  const counterIndex = activeIndex ?? focusedIndex;

  cards.forEach((card, i) => {
    const offset = i - activePosition;
    const absOff = Math.abs(offset);

    if (absOff > WHEEL_CONFIG.maxVisibleOffset) {
      card.style.cssText = 'display:none';
      return;
    }

    const angle = offset * WHEEL_CONFIG.angleStep;
    const radius = WHEEL_CONFIG.radius;
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const y = Math.sin(radians) * radius;
    const z = (cos - 1) * radius * 1.08;
    const scale = Math.max(WHEEL_CONFIG.minScale, cos);
    const opacity = Math.max(0, (cos * 1.08) - 0.08);
    const blur = absOff === 0 ? 0 : absOff < 1.1 ? 0.08 : 0.28;
    const shadowAlpha = absOff === 0 ? 0.56 : absOff < 1.1 ? 0.42 : 0.26;
    const rotateY = offset * -6.5;

    card.style.cssText = `
      display: block;
      transform: translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${(-angle).toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(3)});
      opacity: ${opacity.toFixed(3)};
      z-index: ${Math.round(100 - (absOff * 12))};
      pointer-events: ${i === focusedIndex ? 'auto' : 'none'};
      filter: blur(${blur.toFixed(2)}px);
      box-shadow: 0 ${10 + (absOff * 3)}px ${30 + (absOff * 4)}px rgba(0, 0, 0, ${shadowAlpha.toFixed(3)});
    `;
    card.classList.toggle('is-active', i === focusedIndex);
  });

  if (counterId) {
    const counter = document.getElementById(counterId);
    if (counter) counter.textContent = `${counterIndex + 1} / ${cards.length}`;
  }
}

function applyBreakingWheelTransforms() {
  const cards = [...els.breakingDeck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  applyWheelTransformsToNodes(cards, state.breakingWheelPosition, {
    counterId: 'breakCounter',
    activeIndex: state.breakingIndex
  });
}

function scrollBreaking(direction) {
  if (!state.breakingCards.length) return;
  const nextIndex = Math.max(0, Math.min(state.breakingCards.length - 1, state.breakingIndex + direction));
  if (nextIndex === state.breakingIndex && state.breakingWheelTarget === nextIndex) return;
  state.breakingIndex = nextIndex;
  state.breakingWheelPosition = nextIndex;
  state.breakingWheelTarget = nextIndex;
  cancelWheelAnimation('breakingWheelFrame');
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

    const uniqueCards = sortBreakingCards(dedupeCards(allCards)).slice(0, 24);
    state.breakingCards = uniqueCards;
    els.breakingDeck.innerHTML = '';
    state.breakingIndex = 0;
    state.breakingWheelPosition = 0;
    state.breakingWheelTarget = 0;
    if (state.breakingWheelFrame) {
      cancelAnimationFrame(state.breakingWheelFrame);
      state.breakingWheelFrame = 0;
    }
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
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  let activeTouchId = null;

  element.addEventListener('click', () => {
    if (Date.now() - lastTouchOpenAt < 450) return;
    handler();
  });
  element.addEventListener('touchstart', (ev) => {
    const touch = ev.changedTouches[0];
    if (!touch) return;
    activeTouchId = touch.identifier;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchMoved = false;
  }, { passive: true });
  element.addEventListener('touchmove', (ev) => {
    const touch = Array.from(ev.changedTouches).find((entry) => entry.identifier === activeTouchId) || ev.changedTouches[0];
    if (!touch) return;
    if (
      Math.abs(touch.clientX - touchStartX) > TAP_OPEN_MAX_DELTA ||
      Math.abs(touch.clientY - touchStartY) > TAP_OPEN_MAX_DELTA
    ) {
      touchMoved = true;
    }
  }, { passive: true });
  element.addEventListener('touchend', (ev) => {
    const touch = Array.from(ev.changedTouches).find((entry) => entry.identifier === activeTouchId) || ev.changedTouches[0];
    if (!touch) return;
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);
    activeTouchId = null;
    if (touchMoved || deltaX > TAP_OPEN_MAX_DELTA || deltaY > TAP_OPEN_MAX_DELTA) {
      return;
    }
    ev.preventDefault();
    lastTouchOpenAt = Date.now();
    handler();
  }, { passive: false });
  element.addEventListener('touchcancel', () => {
    touchMoved = true;
    activeTouchId = null;
  }, { passive: true });
}

function createCardElement(card, index, {
  shouldShowLoadMore = false,
  nextBatchCount = 0,
  placeholderLabel = 'Top Story',
  includeSummary = true
} = {}) {
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
      ph.textContent = placeholderLabel;
      article.prepend(ph);
    };
    article.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-image news-card-image--placeholder';
    ph.textContent = placeholderLabel;
    article.appendChild(ph);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';
  const meta = createCardMetaElement(normalizedCard);

  const title = document.createElement('h3');
  title.textContent = normalizedCard.title || `Story ${index + 1}`;

  content.append(meta, title);

  if (includeSummary) {
    const snippet = document.createElement('p');
    snippet.textContent = normalizedCard.summary || 'Tap to open full story.';
    content.appendChild(snippet);
  }

  if (shouldShowLoadMore) {
    const loadMore = document.createElement('div');
    loadMore.className = 'news-card-loadmore';

    const label = document.createElement('span');
    label.className = 'news-card-loadmore-label';
    label.textContent = 'More';

    const text = document.createElement('span');
    text.className = 'news-card-loadmore-text';
    text.textContent = `Scroll down for ${nextBatchCount} more headlines`;

    loadMore.append(label, text);
    content.appendChild(loadMore);
  }

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
  applyWheelTransformsToNodes(cards, state.cardWheelPosition, {
    updateLoadMore: true,
    activeIndex: state.activeCardIndex
  });

  // Card counter
  els.cardCounter.textContent = `${state.activeCardIndex + 1} / ${state.cards.length}`;
}

function refreshActiveCard() {
  if (state.view !== 'cards') return;
  applyWheelTransforms();
}

function renderCards(cards = [], sourceLabel = 'News') {
  state.cards = cards.map(normalizeCard);
  state.activeCardIndex = 0;
  state.cardWheelPosition = 0;
  state.cardWheelTarget = 0;
  if (state.cardWheelFrame) {
    cancelAnimationFrame(state.cardWheelFrame);
    state.cardWheelFrame = 0;
  }
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

function recordSourceHealth(url, outcome = 'clean') {
  const host = getHostFromUrl(url);
  const current = state.sourceHealth[host] || { clean: 0, sourceOnly: 0, failed: 0 };
  current[outcome] = (current[outcome] || 0) + 1;

  // Keep the learned scoring bounded so one bad streak does not permanently poison a source.
  ['clean', 'sourceOnly', 'failed'].forEach((key) => {
    current[key] = Math.min(current[key], 12);
  });

  state.sourceHealth[host] = current;
  storageSave(SOURCE_HEALTH_KEY, state.sourceHealth);
}

function pruneArticleDom(root) {
  const junkSelector = [
    'aside',
    'nav',
    'form',
    'button',
    '[aria-label*="related" i]',
    '[class*="related" i]',
    '[class*="recommended" i]',
    '[class*="newsletter" i]',
    '[class*="promo" i]',
    '[class*="advert" i]',
    '[class*="trending" i]',
    '[class*="popular" i]',
    '[class*="most-read" i]',
    '[class*="live-blog" i]',
    '[id*="related" i]',
    '[id*="recommended" i]',
    '[id*="trending" i]'
  ].join(',');

  root.querySelectorAll(junkSelector).forEach((node) => node.remove());

  const cluePattern = /\b(related|recommended|more headlines|latest headlines|top stories|read more|you may also like|most read|live updates|watch live|newsletter|sign up|advertisement|trending|popular now|more coverage)\b/i;
  root.querySelectorAll('section, div, ul, ol, aside').forEach((node) => {
    if (!node.parentElement) return;
    const text = decodeHtmlEntities((node.textContent || '').replace(/\s+/g, ' ').trim());
    const textLength = text.length;
    const paragraphs = node.querySelectorAll('p').length;
    const links = node.querySelectorAll('a').length;
    const listItems = node.querySelectorAll('li').length;
    const headingCount = node.querySelectorAll('h2,h3,h4').length;
    const attrText = `${node.id || ''} ${node.className || ''} ${node.getAttribute('aria-label') || ''}`;
    const linkDensity = (Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + (link.textContent || '').trim().length, 0)) / Math.max(1, textLength);

    if (paragraphs >= 4 || textLength >= 1800) return;

    if (cluePattern.test(attrText) && paragraphs <= 2 && textLength < 1200) {
      node.remove();
      return;
    }

    if (cluePattern.test(text.slice(0, 180)) && paragraphs <= 2 && links >= 2 && textLength < 900) {
      node.remove();
      return;
    }

    if (listItems >= 4 && paragraphs <= 2 && links >= Math.max(3, Math.floor(listItems / 2))) {
      node.remove();
      return;
    }

    if (headingCount >= 4 && paragraphs <= 2 && linkDensity > 0.24) {
      node.remove();
      return;
    }

    if (linkDensity > 0.36 && textLength < 700) {
      node.remove();
    }
  });
}

function analyzeArticleContent(root) {
  const text = decodeHtmlEntities((root.textContent || '').replace(/\s+/g, ' ').trim());
  const paragraphs = Array.from(root.querySelectorAll('p')).map((p) => (p.textContent || '').trim()).filter((value) => value.length >= 45);
  const listItems = root.querySelectorAll('li').length;
  const headingLike = Array.from(root.querySelectorAll('li,h2,h3,h4')).filter((node) => {
    const value = (node.textContent || '').trim();
    return value.length >= 18 && value.length <= 120 && !/[.!?]/.test(value);
  }).length;
  const linkTextLength = Array.from(root.querySelectorAll('a')).reduce((sum, link) => sum + (link.textContent || '').trim().length, 0);
  const linkDensity = linkTextLength / Math.max(1, text.length);
  const warnings = [];

  if (text.length < 500 || paragraphs.length < 2) warnings.push('thin_content');
  if (linkDensity > 0.24) warnings.push('high_link_density');
  if (listItems >= 6 && paragraphs.length <= 4) warnings.push('headline_list');
  if (headingLike >= 8 && paragraphs.length <= 4) warnings.push('headline_noise');
  if (/\b(related stories|more headlines|latest headlines|top stories|recommended)\b/i.test(text)) warnings.push('related_content');

  let qualityScore = 1;
  if (warnings.includes('thin_content')) qualityScore -= 0.4;
  if (warnings.includes('high_link_density')) qualityScore -= 0.28;
  if (warnings.includes('headline_list')) qualityScore -= 0.36;
  if (warnings.includes('headline_noise')) qualityScore -= 0.3;
  if (warnings.includes('related_content')) qualityScore -= 0.14;

  return {
    textLength: text.length,
    paragraphCount: paragraphs.length,
    qualityScore: Math.max(0, Number(qualityScore.toFixed(2))),
    warnings,
    fallbackPreferred: qualityScore < 0.48 || warnings.includes('headline_list') || warnings.includes('headline_noise')
  };
}

function shouldPreferSourceOnly(data) {
  if (!data) return true;
  if (data.mode === 'source_only' || data.fallbackPreferred) return true;
  if (!data.content) return true;
  if (Number(data.qualityScore) && Number(data.qualityScore) < 0.48) return true;
  if ((data.warnings || []).includes('thin_content') && Number(data.paragraphCount || 0) <= 3 && Number(data.textLength || 0) < 900) {
    return true;
  }
  if ((data.warnings || []).some((warning) => ['headline_list', 'headline_noise', 'high_link_density'].includes(warning))) {
    return true;
  }
  return false;
}

function getSourceOnlyMessage(data) {
  const warningMessage = summarizeWarnings(data?.warnings || []);
  return warningMessage || 'This source did not produce a clean reader view. Use the original source below.';
}

function ensureArticleAssessment(data) {
  if (!data?.content) return data;
  if (typeof data.qualityScore === 'number' || data.fallbackPreferred || Array.isArray(data.warnings)) {
    return data;
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = data.content;
  pruneArticleDom(wrapper);
  const assessment = analyzeArticleContent(wrapper);
  return {
    ...data,
    content: wrapper.innerHTML,
    ...assessment
  };
}

/* ═══ Article with lead image (always preserved) ═══ */
function renderArticle(data, fallbackImageUrl) {
  state.currentArticleContext = {
    url: data.url,
    imageUrl: fallbackImageUrl || data.image?.url || data.leadImage || '',
    cardMeta: state.currentArticleContext?.cardMeta || null
  };
  els.articleTitle.textContent = data.title || 'Article';
  setArticleNotice(
    data?.warnings?.length ? summarizeWarnings(data.warnings) || 'Reader view cleaned for better readability.' : '',
    data?.warnings?.length ? 'warn' : 'info'
  );

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
  pruneArticleDom(block);
  els.articleSections.appendChild(block);
}

function renderArticleFallback(url, fallbackImageUrl, message) {
  state.currentArticleContext = {
    url,
    imageUrl: fallbackImageUrl || '',
    cardMeta: state.currentArticleContext?.cardMeta || null
  };
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
  setArticleNotice(message || 'Open the original source for the cleanest version of this story.', 'warn');
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

async function fetchCardsFromFeeds(feedUrls, { requestKeyPrefix, requestId, maxAgeHours = 7 * 24, sortFn = sortFreshCards } = {}) {
  const results = await Promise.all(feedUrls.map((feedUrl, index) =>
    apiWithRetry('/top', { url: addCacheBust(feedUrl) }, 'POST', { requestKey: `${requestKeyPrefix}:${index}` }).catch(() => ({ items: [] }))
  ));

  if (requestId !== state.cardsRequestId) {
    return null;
  }

  return sortFn(dedupeCards(results.flatMap((result) => result.items || [])), { maxAgeHours });
}

async function fetchRegionNews(regionKey) {
  const region = REGION_MAP.get(regionKey);
  if (!region) {
    setStatus('Region configuration not found.');
    return;
  }

  const requestId = ++state.cardsRequestId;
  state.currentFeedContext = { type: 'region', regionKey: region.key, label: region.label };

  try {
    showLoading(`Scanning ${region.feeds.length} regional sources...`);
    const preparedCards = await fetchCardsFromFeeds(region.feeds, {
      requestKeyPrefix: `region:${region.key}`,
      requestId,
      maxAgeHours: 10 * 24,
      sortFn: sortFreshCards
    });

    if (preparedCards === null || requestId !== state.cardsRequestId) return;
    hideLoading();

    renderCards(preparedCards, `${region.label} News`);
    setStatus(`${region.label}: ${preparedCards.length} headlines from ${region.feeds.length} sources`);
  } catch (error) {
    if (requestId !== state.cardsRequestId) return;
    if (isSupersededRequest(error)) return;
    hideLoading();
    renderErrorCard(error.message, () => fetchRegionNews(region.key));
  }
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');
  const requestId = ++state.cardsRequestId;
  state.currentFeedContext = { type: 'search', query: q };

  try {
    showLoading('Searching across sources…');
    const searchFeeds = [...new Set([
      buildBingNewsSearchFeed(q),
      buildBingNewsSearchFeed(`"${q}"`),
      buildBingNewsSearchFeed(`${q} latest`)
    ])];
    const rankedCards = await fetchCardsFromFeeds(searchFeeds, {
      requestKeyPrefix: 'search',
      requestId,
      maxAgeHours: 10 * 24,
      sortFn: (cards) => sortSearchCards(cards, q)
    });
    if (rankedCards === null || requestId !== state.cardsRequestId) return;
    hideLoading();
    renderCards(rankedCards.slice(0, 120), `Search: ${q}`);
  } catch (error) {
    if (requestId !== state.cardsRequestId) return;
    if (isSupersededRequest(error)) return;
    hideLoading();
    renderErrorCard(error.message, () => searchNews(query));
  }
}

async function readArticle(url, cardImageUrl, cardMeta = null) {
  if (cardMeta) markCardSeen(cardMeta);
  state.currentArticleContext = {
    url,
    imageUrl: cardImageUrl || '',
    cardMeta: cardMeta || null
  };
  if (isPaywalled(url)) {
    setStatus('⚠️ This source may require a subscription.', { persist: true });
  }
  try {
    showLoading('Opening article…');
    const rawData = await apiWithRetry('/article', { url: addCacheBust(url) }, 'POST', { requestKey: 'article' });
    hideLoading();
    const data = ensureArticleAssessment(rawData);

    const textContent = data.textContent || data.content || '';
    if (textContent.length < 100) {
      setStatus('⚠️ Article may be behind a paywall — limited content available.', { persist: true });
    }

    if (shouldPreferSourceOnly(data)) {
      recordSourceHealth(url, 'sourceOnly');
      renderArticleFallback(url, cardImageUrl, getSourceOnlyMessage(data));
      setStatus(`Opened source view for ${new URL(url).hostname || 'source'}.`);
      return;
    }

    recordSourceHealth(url, 'clean');
    renderArticle(data, cardImageUrl);
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyArticleFontScale();
    setStatus(`Opened article from ${new URL(url).hostname || 'source'}.`);
  } catch (error) {
    if (isSupersededRequest(error)) return;
    hideLoading();
    recordSourceHealth(url, 'failed');
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
    const sourceHealth = await storageLoad(SOURCE_HEALTH_KEY);
    state.sourceHealth = sourceHealth && typeof sourceHealth === 'object' ? sourceHealth : {};
  } catch {
    state.articleFontScale = 0.72;
    state.seenArticleIds = new Set();
    state.sourceHealth = {};
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
      } else if (state.currentFeedContext.type === 'region') {
        fetchRegionNews(state.currentFeedContext.regionKey);
      } else if (state.currentFeedContext.type === 'search') {
        searchNews(state.currentFeedContext.query);
      }
    } else if (state.view === 'article' && state.currentArticleContext?.url) {
      readArticle(state.currentArticleContext.url, state.currentArticleContext.imageUrl, state.currentArticleContext.cardMeta);
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
    const regionKey = els.regionSelect.value;
    const opt = els.regionSelect.options[els.regionSelect.selectedIndex];
    if (regionKey) {
      els.searchInput.value = '';
      fetchRegionNews(regionKey);
      els.regionSelect.selectedIndex = 0; // Reset after navigation
    }
  });

  // Breaking news nav arrows removed per user request

  // Font controls
  els.fontDown.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(-0.1); });
  els.fontUp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(0.12); });

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
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeArticleFont(0.12); }
      else if (event.key === '-') { event.preventDefault(); changeArticleFont(-0.1); }
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

  // Map the side button to a consistent back action outside home.
  window.addEventListener('sideClick', () => {
    if (state.view === 'article' || state.view === 'cards') {
      goBackView();
    }
  });
}

/* ═══ Service Worker registration & cache busting ═══ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).then(reg => {
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

async function enforceShellVersion() {
  try {
    const previous = localStorage.getItem(SHELL_VERSION_KEY);
    if (!previous || previous === APP_VERSION) {
      localStorage.setItem(SHELL_VERSION_KEY, APP_VERSION);
      return false;
    }

    localStorage.setItem(SHELL_VERSION_KEY, APP_VERSION);
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    location.reload();
    return true;
  } catch {
    localStorage.setItem(SHELL_VERSION_KEY, APP_VERSION);
    return false;
  }
}

/* ═══ #17: Boot with error boundary ═══ */
async function boot() {
  try {
    const didReload = await enforceShellVersion();
    if (didReload) return;
    bindUi();
    initR1Hardware();
    renderRegions();
    await migrateStorage();
    await loadRecent();
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
