'use strict';
// Animax — переходы между экранами и «Назад».

// ================= роутер =================
let navToken = 0;
// таблица экранов (routes) — в start.js: её строки ссылаются на страницы из файлов ниже
function parseHash() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { path: path || '/', q: new URLSearchParams(qs || '') };
}
// Прокрутка: тот же экран перерисовывается (отметил серию, поставил оценку) — остаёмся на месте;
// «Назад/Вперёд» — возвращаемся туда, где были (позиция лежит в history.state.y); новый экран — сверху.
let lastHash = null, fromHistory = false;
async function route() {
  const { path, q } = parseHash();
  const tok = ++navToken;
  const alive = () => tok === navToken;
  const same = location.hash === lastHash;
  const y = same ? $('#view').scrollTop : fromHistory ? history.state?.y || 0 : 0;
  fromHistory = false;
  lastHash = location.hash;
  closePlayer();
  if (!same) document.title = 'Animax';  // пока новый экран грузится, не показываем имя прошлого
  closeModal();
  hideCtx();
  hideSuggest();
  const sect = path.split('/')[1] || 'home';
  const navMap = { collection: 'collections', scoll: 'collections', folder: 'library', watch: 'library', popular: 'discover', now: 'discover', rate: 'profile' };
  const navKey = sect === 'bookmarks' && q.get('tab') === 'history' ? 'history' : navMap[sect] || sect;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey));
  const old = $('#view');
  const view = old.cloneNode(false); // новый элемент — сбрасываем обработчики прокрутки прошлой страницы
  old.replaceWith(view);
  rememberScroll(view);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    try {
      const page = fn(view, q, m.slice(1), alive);
      if (alive()) { addRefresh(view); keepScroll(view, y, alive); }  // вкладки обычно рисуются сразу, а данные догружаются
      await page;
      if (alive()) { addRefresh(view); keepScroll(view, y, alive); pageDone(view); }
    } catch (err) {
      if (alive()) { view.innerHTML = ''; view.append(errBlock(err)); }
    }
    return;
  }
  history.replaceState({ d: navDepth() }, '', '#/');
  route();
}
// Позиция прокрутки экрана — в его запись истории (после того как прокрутка остановилась)
function rememberScroll(view) {
  view.addEventListener('scroll', debounce(() => {
    if (view.isConnected && location.hash === lastHash) history.replaceState({ ...(history.state || {}), y: Math.round(view.scrollTop) }, '');
  }, 250), { passive: true });
  // крутит сам — больше не возвращаем его на сохранённое место
  ['wheel', 'pointerdown', 'touchstart'].forEach(ev => view.addEventListener(ev, () => { view.keepStop = true; }, { passive: true }));
}
// Возвращаемся на позицию y. Страницы догружают карточки постепенно (pager), поэтому пробуем
// несколько раз, пока содержимого не хватит, — но не дольше 4 секунд.
// keepWant — сколько ещё не хватает до цели: pager видит его и догружает страницы, пока содержимого не хватит.
function keepScroll(view, y, alive) {
  if (!y) return;
  clearTimeout(view.keepT);
  const until = Date.now() + 6000;
  const tick = () => {
    if (!alive() || view.keepStop) { view.keepWant = 0; return; }
    view.scrollTop = y;
    view.keepWant = Math.max(0, y - view.scrollTop);
    if (view.keepWant > 2 && Date.now() < until) view.keepT = setTimeout(tick, 120);
    else view.keepWant = 0;
  };
  tick();
}
// Экран нарисован: заголовок окна («Animax · Закладки») и клавиатура для кликабельных строк
function pageDone(view) {
  const h = $('h1', view)?.cloneNode(true);
  h?.querySelectorAll('span, small, button').forEach(x => x.remove());
  const name = h?.textContent.trim().replace(/\s+/g, ' ').slice(0, 70);
  if (!player) document.title = name ? 'Animax · ' + name : 'Animax';
  $$('.ep[data-href], .ep[data-play], .ep[data-pick], .video, .shots-row img, .wide-card[data-id]', view).forEach(el => { if (el.tabIndex < 0) el.tabIndex = 0; });
}
// ⟳ в конце строки вкладок: заново загружает только открытую вкладку, свежими данными
function addRefresh(view) {
  const tabs = $('.tabs', view);
  if (!tabs || $('.tab-refresh', view) || location.hash.startsWith('#/settings')) return;
  const b = document.createElement('button');
  b.className = 'icon-btn tab-refresh';
  b.title = 'Обновить эту вкладку';
  b.textContent = '⟳';
  b.onclick = e => {
    e.stopPropagation();
    freshTok = navToken + 1;  // следующий route() получит именно этот номер
    recsCache = null;
    ongoingCache = null;
    route();
  };
  const set = $('#tab-set', view);  // на главной рядом уже есть ☰ — ставим перед ним
  if (set) set.before(b); else tabs.append(b);
}
// hashchange приходит от «Назад/Вперёд» (Alt+←, кнопки мыши) — тогда восстанавливаем прокрутку
addEventListener('hashchange', () => { fromHistory = true; route(); });
// «Назад» должен идти по экранам шаг за шагом: серии → тайтл → откуда пришёл. Поэтому тайтл,
// его страницы (серии, просмотр) и плеер считаются разными экранами; внутри одного экрана
// (вкладки, фильтры, поиск, выбор озвучки/источника, соседняя серия в плеере) — заменяют запись.
const screenKey = h => {
  const path = (h.replace(/^#/, '') || '/').split('?')[0] || '/';
  if (path.startsWith('/watch')) return '/watch';
  const m = path.match(/^\/anime\/\d+\/(watch|episodes)(\/|$)/);
  if (m) return m[1];
  return path.replace(/^(\/anime\/\d+)\/.*$/, '$1');
};
// В history.state храним глубину: 0 — первый экран. Так «назад» знает, есть ли куда возвращаться внутри Animax.
const navDepth = () => history.state?.d || 0;
function go(h) {
  if (location.hash === h) return route();
  if (screenKey(h) === screenKey(location.hash)) history.replaceState({ d: navDepth() }, '', h);
  else {
    // запоминаем, где был этот экран, — «Назад» вернёт сюда же
    history.replaceState({ ...(history.state || {}), y: Math.round($('#view').scrollTop) }, '');
    history.pushState({ d: navDepth() + 1 }, '', h);
  }
  route();
}
// Шаг назад; если назад некуда (Animax открыли сразу на этом экране) — на запасной экран
function goBack(fallback = '#/') {
  if (navDepth() > 0) history.back();
  else { history.replaceState({ d: 0 }, '', fallback); route(); }
}

// Просмотр открывается отдельным окном приложения (Edge --app), главное окно остаётся на месте.
// Не получилось (сервер недоступен, Edge не найден) — открываем внутри этого окна, как раньше.
async function watchOpen(h) {
  try {
    const r = await fetch('/api/open-window', { method: 'POST', body: JSON.stringify({ url: h + (h.includes('?') ? '&' : '?') + 'w=1' }) });
    if ((await r.json()).ok === true) { toast('Просмотр открыт в отдельном окне'); return true; }
  } catch { /* открываем здесь */ }
  go(h);
  return false;
}
// флаг «мы — отдельное окно просмотра» (метка w=1, которую watchOpen дописывает к адресу)
const PLAYER_WINDOW = (() => {
  const q = new URLSearchParams((location.hash.split('?')[1] || '').split('#')[0]);
  return q.get('w') === '1';
})();
const withW = h => PLAYER_WINDOW ? h + (h.includes('?') ? '&' : '?') + 'w=1' : h;
// «Назад» в отдельном окне = закрыть окно; не вышло — возвращаемся внутри него
function closeOrBack(fallback) {
  if (PLAYER_WINDOW) {
    try { window.close(); } catch { /* запретили — вернёмся внутри окна */ }
    setTimeout(() => { if (!window.closed) goBack(fallback); }, 150);
    return;
  }
  goBack(fallback);
}

// Ссылки без адреса: иначе при наведении внизу окна всплывает «127.0.0.1:8790/#/...», как на сайте.
// При первом наведении переносим href в data-go, а переход делаем сами.
// Без href ссылка выпала бы из обхода клавишей Tab — поэтому ставим ей tabindex.
document.addEventListener('pointerover', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.hasAttribute('download') || /^(blob|data):/.test(a.href)) return;
  a.dataset.go = a.getAttribute('href');
  if (a.target === '_blank') a.dataset.ext = '1';
  a.removeAttribute('href');
  if (!a.hasAttribute('tabindex')) a.tabIndex = 0;
}, true);
// Все ссылки — один обработчик: внутренние идут через go() (в историю попадает «глубина»),
// просмотр — отдельным окном, Shikimori — в обычном браузере, остальное — новым окном.
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = e.target.closest?.('a[href], a[data-go]');
  if (!a || a.hasAttribute('download')) return;
  const h = a.dataset.go || a.getAttribute('href') || '';
  if (!h || /^(blob|data|javascript):/i.test(h)) return;
  e.preventDefault();
  if (h.startsWith('#')) {
    if (h.startsWith('#/watch') && !PLAYER_WINDOW) { watchOpen(h); return; }
    go(h);
  }
  else if (h.startsWith(SHIKI_URL)) openInBrowser(h);
  else if (/^https?:/i.test(h)) window.open(h, '_blank');
});
// Enter / пробел на «ссылке» без href и на кликабельных строках (серии, ролики) — как клик
document.addEventListener('keydown', e => {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented || e.repeat) return;
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.tabIndex < 0 || /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  if (el.matches('a[data-go]:not([href]), .ep, .video, .shots-row img, .wide-card[data-id], .card, .lrow, .tile')) { e.preventDefault(); el.click(); }
});
// Ссылки на Shikimori открываем в обычном браузере: там ты уже вошёл в аккаунт, а у окна Animax свой профиль
const SHIKI_URL = 'https://shikimori.io/';
// Клик по уведомлению Windows: Animax.pyw кладёт экран на сервер, главное окно забирает его и переходит
async function checkGoto() {
  if (PLAYER_WINDOW) return;
  try {
    const { hash } = await fetch('/api/goto').then(r => r.json());
    if (hash) go(hash);
  } catch { /* сервер перезапускается — спросим позже */ }
}
const openInBrowser = url => fetch('/api/open-url', { method: 'POST', body: JSON.stringify({ url }) })
  .then(r => { if (!r.ok) window.open(url, '_blank'); }).catch(() => window.open(url, '_blank'));
