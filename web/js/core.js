'use strict';
/* Animax 2 — интерфейс.
   Каталог, оценки, статистика и комментарии берём из Shikimori через локальный сервер (server.py).
   Свои закладки, отметки серий, коллекции и настройки хранятся в state.json (%APPDATA%\Animax).
   Видео: свои файлы, ссылки на потоки (свой медиасервер и т.п.) и официальные ролики YouTube. */

// ================= помощники =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// w — какой ширины картинка нужна на экране; если исходник меньше, сервер аккуратно увеличит её
const img = (u, w = 420) => (u ? '/img?u=' + encodeURIComponent(u) + (w ? '&w=' + w : '') : 'icon-256.png');
// Лёгкий режим для слабых ПК (мало памяти или 1–2 ядра): меньше картинок крупного размера, без анимаций.
// Включается в настройках или сам по железу (сервер знает, сколько памяти и ядер) — см. initLite() в start.js.
let LITE = false;
// Постер нужного размера. Мелкий (строка списка) — сразу маленькая картинка; обычный — с запасом по качеству:
// при масштабе экрана 150–200 % или зуме окна браузер сам возьмёт крупную версию (в лёгком режиме — без неё).
const pimg = (a, cssW = 200) => cssW <= 120 ? `src="${img(a.poster, 240)}"`
  : LITE ? `src="${img(a.poster, 300)}"`
  : `src="${img(a.poster)}" srcset="${img(a.poster)} 420w, ${img(a.posterHi || a.poster, 900)} 900w" sizes="${cssW}px"`;
const uid = () => Math.random().toString(36).slice(2, 10);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = a => a[Math.floor(Math.random() * a.length)];

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
function fmtWhen(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 864e5;
  if (diff === 0) return 'сегодня в ' + hm;
  if (diff === 1) return 'вчера в ' + hm;
  if (diff === -1) return 'завтра в ' + hm;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ' в ' + hm;
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return n + ' ' + (a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many);
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  if (m < 60 * 24) return Math.round(m / 60) + ' ч назад';
  return fmtWhen(ts);
}
const kfmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n);

const KIND = { tv: 'ТВ', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл', tv_special: 'ТВ-спешл', music: 'Клип', pv: 'PV', cm: 'Реклама' };
const KIND_FULL = { tv: 'ТВ-сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл', tv_special: 'ТВ-спешл', music: 'Клип' };
const STATUS = { anons: 'Анонс', ongoing: 'Выходит', released: 'Вышел' };
const RATING = { none: '', g: '0+', pg: '6+', pg_13: '13+', r: '16+', r_plus: '18+', rx: '18+' };
const RATING_INFO = { g: 'G — без ограничений', pg: 'PG — детям рекомендуется смотреть с родителями', pg_13: 'PG-13 — детям до 13 лет просмотр не желателен', r: 'R — лицам до 17 лет обязательно присутствие взрослого', r_plus: 'R+ — лицам до 17 лет просмотр запрещён (есть откровенные сцены)' };
const ORIGIN = { original: 'Оригинал', manga: 'Манга', web_manga: 'Веб-манга', four_koma_manga: 'Ёнкома', light_novel: 'Ранобэ', novel: 'Роман', web_novel: 'Веб-новелла', visual_novel: 'Визуальная новелла', game: 'Игра', card_game: 'Карточная игра', book: 'Книга', picture_book: 'Книга с картинками', music: 'Музыка', radio: 'Радио', mixed_media: 'Несколько источников', other: 'Другое' };
const SEASON = { winter: 'зима', spring: 'весна', summer: 'лето', fall: 'осень' };
const LISTS = [['watching', 'Смотрю'], ['planned', 'В планах'], ['completed', 'Просмотрено'], ['on_hold', 'Отложено'], ['dropped', 'Брошено']];
const LIST_NAME = Object.fromEntries(LISTS);
const LIST_COLOR = { watching: 'var(--st-watching)', planned: 'var(--st-planned)', completed: 'var(--st-completed)', on_hold: 'var(--st-on_hold)', dropped: 'var(--st-dropped)' };
const STAR_WORDS = ['', 'Ужасно', 'Плохо', 'Нормально', 'Хорошо', 'Отлично'];
// Оценка хранится как 0.5…5 звёзд (шаг — половинка). Шкала «1–10» — те же звёзды, но с половинками: 4.5 ★ = 9/10.
const WORDS10 = ['', 'Хуже некуда', 'Ужасно', 'Очень плохо', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично', 'Великолепно', 'Шедевр'];
const scale10 = () => S.settings.scale === '10';
const scoreWord = v => scale10() ? WORDS10[Math.round(v * 2)] : STAR_WORDS[Math.round(v)];
const scoreText = v => scale10() ? `${Math.round(v * 2)}/10` : Number.isInteger(v) ? '★'.repeat(v) : `${v} ★`;
const likedText = () => scale10() ? '8–10' : '4–5 ★';
const ACCENTS = ['#8b6cff', '#ff5c8a', '#2fb6ff', '#3ccf8e', '#ffb547', '#ff6a3d'];
// Второй цвет градиента подбирается под акцент, чтобы кнопки и подсветка всегда были в одной гамме.
const ACCENT_PAIRS = {
  '#8b6cff': '#ff5c8a',  // фиолетовый → розовый
  '#ff5c8a': '#a06bff',  // розовый → фиолетовый
  '#2fb6ff': '#7b6bff',  // голубой → индиго
  '#3ccf8e': '#2fb6ff',  // зелёный → бирюзовый
  '#ffb547': '#ff6a3d',  // янтарный → коралловый
  '#ff6a3d': '#ffb547',  // коралловый → янтарный
};
// Если в настройках когда-нибудь появится свой цвет — сдвигаем оттенок на круг Иттена.
function accentPair(hex) {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ff5c8a';
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const hue2 = (hue + (hue > 100 && hue < 300 ? 45 : 315)) % 360;
  return `hsl(${Math.round(hue2)} ${Math.round(clamp(s * 100, 70, 95))}% ${Math.round(clamp(l * 100 + 8, 55, 72))}%)`;
}
const LEGAL_LINKS = {
  kinopoisk_hd: 'Кинопоиск HD', kinopoisk: 'Кинопоиск', wink: 'Wink', okko: 'Okko', ivi: 'Иви', crunchyroll: 'Crunchyroll',
  netflix: 'Netflix', hidive: 'HIDIVE', amazon_prime: 'Prime Video', disney_plus: 'Disney+', hulu: 'Hulu', youtube: 'YouTube',
  youtube_channel: 'YouTube-канал', official_site: 'Официальный сайт',
};
const INFO_LINKS = { wikipedia: 'Википедия', myanimelist: 'MyAnimeList', anime_news_network: 'Anime News Network', anime_db: 'AniDB', world_art: 'World Art' };
// Где смотреть: только официальные площадки. free — как у них с бесплатным доступом; kinds — какие kind из
// externalLinks Shikimori считаются прямой ссылкой на этот тайтл. Пиратских балансеров здесь нет и не будет.
const WATCH_SERVICES = [
  { name: 'VK Видео', free: 'бесплатно', kinds: ['vk', 'vk_video'], note: 'официальные каналы и ролики', url: q => 'https://vk.com/video?q=' + encodeURIComponent(q) },
  { name: 'RuTube', free: 'бесплатно', kinds: ['rutube'], note: 'официальные каналы', url: q => 'https://rutube.ru/search/?query=' + encodeURIComponent(q) },
  { name: 'YouTube', free: 'бесплатно', kinds: ['youtube', 'youtube_channel'], note: 'трейлеры и каналы правообладателей', url: q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) },
  { name: 'Иви', free: 'есть бесплатный раздел', kinds: ['ivi'], note: 'поиск по названию', url: q => 'https://www.ivi.ru/search/?q=' + encodeURIComponent(q) },
  { name: 'Wink', free: 'есть бесплатный раздел', kinds: ['wink'], note: 'поиск по названию', url: q => 'https://wink.ru/search?query=' + encodeURIComponent(q) },
  { name: 'Okko', free: 'есть бесплатный раздел', kinds: ['okko'], note: 'поиск по названию', url: q => 'https://okko.tv/search/' + encodeURIComponent(q) },
  { name: 'Кинопоиск', free: 'по подписке', kinds: ['kinopoisk_hd', 'kinopoisk'], note: 'поиск по названию', url: q => 'https://www.kinopoisk.ru/index.php?kp_query=' + encodeURIComponent(q) },
  { name: 'Crunchyroll', free: 'по подписке', kinds: ['crunchyroll'], note: 'поиск по названию', url: q => 'https://www.crunchyroll.com/search?q=' + encodeURIComponent(q) },
];
const VIDEO_KINDS = { pv: 'Трейлеры', op: 'Опенинги', ed: 'Эндинги', episode_preview: 'Превью серий', op_ed_clip: 'Клипы', cm: 'Ролики', character_trailer: 'Персонажи', other: 'Другое' };

const CARD = 'id russian name kind score status episodes episodesAired airedOn{year date} poster{mainUrl main2xUrl originalUrl}';
let PAGE = 30;
const APP_VERSION = '1.0.0';
const SNAPS = new Map(); // id → короткая запись о тайтле (для контекстного меню)

// ================= API =================
// После ⟳ у вкладки её запросы идут мимо кэша сервера (только пока открыта именно эта вкладка)
let freshTok = -1;
const freshHdr = () => freshTok === navToken ? { 'X-Fresh': '1' } : {};
async function gql(query) {
  const r = await fetch('/api/gql', { method: 'POST', headers: { 'Content-Type': 'application/json', ...freshHdr() }, body: JSON.stringify({ query: '{ ' + query + ' }' }) });
  let j;
  try { j = await r.json(); } catch { throw new Error('Сервер Shikimori ответил непонятно (' + r.status + ')'); }
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
async function rest(path) {
  const r = await fetch('/api/rest?p=' + encodeURIComponent(path), { headers: freshHdr() });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Ошибка сети');
  return j;
}
function animes(args, fields = CARD, alias = '') {
  const parts = Object.entries({ rating: '!rx', ...args })
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => k === 'order' ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`);
  return `${alias ? alias + ': ' : ''}animes(${parts.join(', ')}) { ${fields} }`;
}
function snap(a) {
  const s = {
    id: +a.id, russian: a.russian || '', name: a.name || '', kind: a.kind || '',
    score: +a.score || 0, status: a.status || '', episodes: +a.episodes || 0,
    episodesAired: +(a.episodesAired ?? a.episodes_aired) || 0,
    year: a.airedOn?.year || (a.aired_on ? +String(a.aired_on).slice(0, 4) : 0) || +a.year || 0,
    date: a.airedOn?.date || a.aired_on || a.date || '',
    poster: a.poster?.main2xUrl || a.poster?.mainUrl || a.image?.original || (typeof a.poster === 'string' ? a.poster : '') || '',
    posterHi: a.poster?.originalUrl || '',
    duration: +a.duration || 0,
  };
  if (a.genres) s.genres = a.genres.filter(g => g.kind !== 'demographic').map(g => g.russian);
  if (a.description !== undefined) s.desc = cleanBB(a.description);
  return s;
}
async function fillPosters(list) {
  const ids = [...new Set(list.map(a => a.id))];
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(animes({ ids: ids.slice(i, i + 50).join(','), limit: 50, rating: '' }, 'id poster { mainUrl main2xUrl originalUrl }'));
    d.animes.forEach(a => { map[a.id] = a.poster; });
  }
  list.forEach(a => { const p = map[a.id]; if (p) { a.poster = p.main2xUrl || p.mainUrl; a.posterHi = p.originalUrl || ''; } });
  return list;
}
const cleanBB = t => String(t || '').replace(/\[\/?[^\]]+\]/g, '').trim();
const title = a => a.russian || a.name || 'Без названия';
function epsText(a) {
  if (a.status === 'ongoing') return `${a.episodesAired || 0} из ${a.episodes || '?'} эп.`;
  if (a.status === 'anons') return a.date ? 'с ' + new Date(a.date).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : 'скоро';
  if (a.episodes > 1) return `${a.episodes} эп.`;
  return '';
}
const metaLine = a => [KIND[a.kind], a.year || '', epsText(a)].filter(Boolean).join(' · ');

// ================= состояние =================
const DEFAULTS = {
  createdAt: Date.now(),
  list: {}, marks: {}, watchLog: [], history: [], progress: {}, collections: [], notifications: [],
  subs: {}, subsDub: {}, subsDel: {}, notes: {}, streams: [], searchHistory: [], randomSeen: [], myComments: [], myReviews: [], shikiRates: {}, opinions: {}, releaseWatch: null, finishedLog: [],
  onlineDubs: {}, watchSrc: {},
  myTab: { name: 'Моя вкладка', filter: null },
  library: { folders: [], links: {} },
  settings: {
    theme: 'dark', accent: ACCENTS[0], autoNext: true, skipLen: 85, notify: true, notifyLists: ['watching', 'planned', 'on_hold'],
    notifyOne: true, notifyPremieres: true, notifyFinished: true, view: 'cards', homeTab: 'latest', bookmarksTab: 'watching', timeFormat: 'dh', compactNav: false, snow: true, lite: 'auto',
    nickname: 'Зритель', status: '', about: '', scale: '5', avatar: '', cover: '', volume: 1, speed: 1, fit: 'contain', externalPlayer: false, hints: {},
  },
};
let S = structuredClone(DEFAULTS);

// Синхронизация состояния между окнами (главное + окна плеера). Каждое окно говорит серверу, от какой
// версии оно отталкивалось (BASE), — сервер сливает его изменения с изменениями других окон (state.py).
const WIN = uid();
let BASE = null;
let changeSeq = 0, savedSeq = 0;
// Новые поля из DEFAULTS + сохранённые; settings/library/myTab — тот же объект, на него ссылаются страницы
function adoptState(j) {
  const fresh = { ...structuredClone(DEFAULTS), ...j };
  for (const k of ['settings', 'library', 'myTab']) {
    const merged = { ...DEFAULTS[k], ...(j[k] || {}) };
    if (S[k] && typeof S[k] === 'object') {
      Object.keys(S[k]).forEach(x => { if (!(x in merged)) delete S[k][x]; });
      fresh[k] = Object.assign(S[k], merged);
    } else fresh[k] = merged;
  }
  Object.keys(S).forEach(k => { if (!(k in fresh)) delete S[k]; });
  Object.assign(S, fresh);
}
async function loadState() {
  try {
    const j = await (await fetch('/api/state?win=' + WIN)).json();
    BASE = j._rev || null;
    delete j._rev;
    S = structuredClone(DEFAULTS);
    adoptState(j);
    if (!j.opinions) migrateOpinions();
    if (!j.createdAt) save();
  } catch { /* первый запуск */ }
}
const stateBody = () => JSON.stringify({ ...S, _base: BASE, _win: WIN });
async function pushState() {
  const seq = changeSeq;
  const r = await fetch('/api/state', { method: 'POST', body: stateBody() });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Не удалось сохранить');
  savedSeq = Math.max(savedSeq, seq);
  if (!j.state) BASE = j.rev;  // сервер записал ровно то, что мы прислали
  else if (changeSeq === seq) { BASE = j.rev; adoptState(j.state); updateBadge(); }  // взяли слитый результат
  else BASE = j.mine;  // пока шёл ответ, тут поменяли ещё — сольём в следующий раз
  return j;
}
// сохранения идут строго по очереди: иначе два запроса с одной базовой версией мешали бы друг другу
let saveChain = Promise.resolve();
const saveNow = () => (saveChain = saveChain.then(pushState, pushState));
const saveLater = debounce(() => saveNow().catch(() => {}), 400);
function save() { changeSeq++; saveLater(); }
addEventListener('pagehide', () => navigator.sendBeacon('/api/state', new Blob([stateBody()], { type: 'application/json' })));
// Вернулись в окно — подтягиваем то, что за это время сохранили другие окна (например, плеер)
async function refreshState() {
  if (!BASE || changeSeq !== savedSeq) return;  // свои изменения ещё не ушли — не трогаем
  try {
    const j = await (await fetch('/api/state?win=' + WIN)).json();
    if (!j._rev || j._rev === BASE || changeSeq !== savedSeq) return;
    BASE = j._rev;
    delete j._rev;
    adoptState(j);
    updateBadge();
    // перерисовываем экран, только если это ничему не мешает: не плеер, нет окна и никто не печатает
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (!player && $('#modal').hidden && !typing && !location.hash.startsWith('#/settings')) route();
  } catch { /* сервер перезапускается */ }
}
addEventListener('focus', refreshState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState(); });

const stripEmpty = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== 0));
function entryOf(a) {
  const id = +a.id;
  if (!S.list[id]) S.list[id] = { status: '', ep: 0, score: 0, fav: false, added: Date.now(), anime: snap(a) };
  else S.list[id].anime = { ...S.list[id].anime, ...stripEmpty(snap(a)) };
  return S.list[id];
}
function commit(id) {
  const e = S.list[id];
  if (e) {
    e.updated = Date.now();
    if (!e.status && !e.fav && !e.ep && !e.score) delete S.list[id];
  }
  save();
  queuePush(id);
}

// ---- синхронизация закладок, оценок и серий со списком на Shikimori (право user_rates) ----
// Правило простое: побеждает то, что изменили позже — в Animax или на сайте.
const FROM_SHIKI = { planned: 'planned', watching: 'watching', rewatching: 'watching', completed: 'completed', on_hold: 'on_hold', dropped: 'dropped' };
const canSync = () => S.settings.shikiSync !== false && AUTH?.logged && (AUTH.scope || '').includes('user_rates');
const pushQueue = new Set();
let syncing = false;
const pushLater = debounce(() => flushPush(), 1500);
function queuePush(id) {
  if (syncing || !canSync()) return;
  pushQueue.add(+id);
  pushLater();
}
const postJson = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) }).then(async r => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 404) throw new Error(j.error || (j.errors && [].concat(j.errors).join(', ')) || 'Shikimori ответил ' + r.status);
  return j;
});
async function flushPush() {
  await authStatus();
  if (!canSync()) return;
  for (const id of [...pushQueue]) {
    pushQueue.delete(id);
    const e = S.list[id], rid = S.shikiRates[id];
    try {
      if (!e?.status) {  // убрали из списков — убираем и на сайте
        if (rid) { await postJson('/api/shiki/rate/delete', { rate_id: rid }); delete S.shikiRates[id]; }
        continue;
      }
      const j = await postJson('/api/shiki/rate', { target_id: id, status: e.status, score: Math.round((e.score || 0) * 2), episodes: e.ep || 0, rate_id: rid });
      if (j.id) S.shikiRates[id] = j.id;
    } catch { pushQueue.add(id); setTimeout(pushLater, 60000); break; }  // нет сети — повторим через минуту
  }
  save();
}
async function syncShikimori(manual = false) {
  await authStatus();
  if (!canSync() || syncing) return manual ? toast('Синхронизация выключена или нет входа с правом user_rates') : undefined;
  syncing = true;
  let pulled = 0;
  try {
    const rates = await fetch('/api/shiki/rates').then(r => r.json());
    if (rates.error) throw new Error(rates.error);
    const remote = new Map(rates.filter(r => r.target_type === 'Anime').map(r => [+r.target_id, r]));
    const last = S.settings.shikiSyncAt || 0;
    // тайтлы, которых нет в Animax, — сначала подтягиваем карточки
    const missing = [...remote.keys()].filter(id => !S.list[id]);
    for (let i = 0; i < missing.length; i += 50) {
      const d = await gql(animes({ ids: missing.slice(i, i + 50).join(','), limit: 50, rating: '' }, CARD));
      d.animes.forEach(a => entryOf(a));
    }
    for (const [id, r] of remote) {
      S.shikiRates[id] = r.id;
      const e = S.list[id];
      if (!e) continue;
      const rt = Date.parse(r.updated_at) || 0;
      if (e.status && (e.updated || 0) > rt) { pushQueue.add(id); continue; }  // в Animax новее
      const st = FROM_SHIKI[r.status] || 'planned';
      if (e.status !== st) e.statusAt = rt;
      e.status = st;
      e.score = r.score ? r.score / 2 : 0;
      if (r.score && !e.scoredAt) e.scoredAt = rt;
      e.ep = r.episodes || 0;
      e.updated = rt;
      pulled++;
    }
    // есть в Animax, нет на сайте: новое — отправляем, удалённое на сайте после прошлой синхронизации — убираем
    for (const [id, e] of Object.entries(S.list)) {
      if (!e.status || remote.has(+id)) continue;
      if (S.shikiRates[id] && (e.updated || 0) <= last) {
        e.status = '';
        delete S.shikiRates[id];
        if (!e.fav && !e.ep && !e.score) delete S.list[id];
      } else pushQueue.add(+id);
    }
    S.settings.shikiSyncAt = Date.now();
    save();
    if (manual) toast(`Синхронизировано: ${remote.size} на Shikimori, отправляю изменений: ${pushQueue.size}`);
  } catch (err) { if (manual) toast('Не удалось синхронизировать: ' + err.message); }
  finally { syncing = false; }
  if (pushQueue.size) flushPush();
  return pulled;
}
function setStatus(a, status) {
  const was = S.list[a.id]?.status || '';
  if (status === was) return;
  const e = entryOf(a);
  e.status = status;
  if (status) e.statusAt = Date.now();
  commit(a.id);
  toast(status ? `Добавлено в список «${LIST_NAME[status]}»` : `Удалено из списка «${LIST_NAME[was]}»`, 'ok');
}
function toggleFav(a) {
  const e = entryOf(a);
  e.fav = !e.fav;
  commit(a.id);
  toast(e.fav ? 'Добавлено в избранное' : 'Удалено из избранного');
  return e.fav;
}
// Отметки серий
const marksOf = id => S.marks[id] || {};
function setMark(a, n, on) {
  const id = +a.id;
  const m = S.marks[id] ??= {};
  if (on) {
    if (!m[n]) S.watchLog.push({ at: Date.now(), id, ep: n });
    m[n] = Date.now();
  } else delete m[n];
  if (!Object.keys(m).length) delete S.marks[id];
  syncEp(a);
}
function syncEp(a) {
  const e = entryOf(a);
  const count = Object.keys(marksOf(a.id)).length;
  e.ep = count;
  const total = a.episodes || 0;
  if (count && (!e.status || e.status === 'planned')) { e.status = 'watching'; e.statusAt = Date.now(); }
  if (total && count >= total && a.status === 'released' && e.status !== 'completed') {
    e.status = 'completed'; e.statusAt = Date.now();
    toast('Все серии просмотрены — тайтл перенесён в «Просмотрено»');
  }
  if (S.watchLog.length > 5000) S.watchLog = S.watchLog.slice(-5000);
  commit(a.id);
}

function applyTheme() {
  const t = S.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.settings.theme;
  const root = document.documentElement;
  root.dataset.theme = t;
  const accent = S.settings.accent || ACCENTS[0];
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent2', ACCENT_PAIRS[accent] || accentPair(accent));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f2f4fa' : '#07080d');
  document.body.classList.toggle('compact-nav', !!S.settings.compactNav);
  snowfall();
}

// kind: '' — обычное, 'ok' — успех, 'err' — ошибка. Клик по сообщению закрывает его.
function toast(text, kind = /^(Не удалось|Не получ|Ошибка|Не отправ)/.test(text) ? 'err' : '') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = text;
  const hide = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
  t.onclick = hide;
  box.append(t);
  while (box.children.length > 4) box.firstElementChild.remove();  // не больше четырёх сразу
  setTimeout(hide, kind === 'err' ? 6000 : 3500);
}
// уведомление на рабочем столе (тост Windows через сервер; оказывается даже если окно свернуто)
// уведомление Windows; href — экран Animax, который откроется по клику на него
const desktop = (title, body, href = '#/notifications') => {
  try { fetch('/api/notify', { method: 'POST', body: JSON.stringify({ title, body, href }) }).catch(() => {}); } catch { /* не критично */ }
};
function copy(text, msg = 'Скопировано') {
  navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Не удалось скопировать'));
}
const shikiUrl = id => `https://shikimori.io/animes/${id}`;
