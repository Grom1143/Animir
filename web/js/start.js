'use strict';
// Animax — снег зимой и запуск приложения.

// ================= Снег зимой =================
let snowRaf = 0;
function snowfall() {
  const c = $('#snow');
  const m = new Date().getMonth();
  const on = S.settings.snow && !LITE && (m === 11 || m <= 1);
  cancelAnimationFrame(snowRaf);
  c.hidden = !on;
  if (!on) return;
  const g = c.getContext('2d');
  const flakes = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, s: 0.15 + Math.random() * 0.35, w: Math.random() * 6 }));
  const tick = t => {
    c.width = c.clientWidth; c.height = c.clientHeight;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,.75)';
    flakes.forEach(f => {
      f.y += f.s / c.height * 2;
      if (f.y > 1) { f.y = -0.05; f.x = Math.random(); }
      const x = f.x * c.width + Math.sin(t / 900 + f.w) * 4;
      g.beginPath(); g.arc(x, f.y * c.height, f.r, 0, 7); g.fill();
    });
    snowRaf = requestAnimationFrame(tick);
  };
  snowRaf = requestAnimationFrame(tick);
}

// ================= запуск =================
// адрес экрана → страница (route() в router.js перебирает по порядку)
const routes = [
  [/^\/$/, pageHome], [/^\/discover$/, pageDiscover], [/^\/popular$/, pagePopular], [/^\/now$/, pageNow], [/^\/recs$/, pageRecs],
  [/^\/search$/, pageSearch], [/^\/filter$/, pageFilter], [/^\/results$/, pageResults], [/^\/dubs$/, pageDubs],
  [/^\/anime\/(\d+)$/, pageAnime], [/^\/anime\/(\d+)\/episodes$/, pageEpisodes], [/^\/anime\/(\d+)\/watch$/, pagePlay], [/^\/anime\/(\d+)\/videos$/, pageVideos],
  [/^\/anime\/(\d+)\/related$/, pageRelated], [/^\/anime\/(\d+)\/comments$/, pageComments], [/^\/anime\/(\d+)\/collections$/, pageAnimeCollections],
  [/^\/schedule$/, pageSchedule], [/^\/releases$/, pageReleases], [/^\/bookmarks$/, pageBookmarks],
  [/^\/collections$/, pageCollections], [/^\/scoll\/(\d+)$/, pageShikiColl], [/^\/collection\/(\w+)$/, pageCollection], [/^\/collection\/(\w+)\/edit$/, pageCollectionEdit],
  [/^\/library$/, pageLibrary], [/^\/folder$/, pageFolder], [/^\/watch$/, pageWatch],
  [/^\/notifications$/, pageNotifications], [/^\/profile$/, pageProfile], [/^\/rate$/, pageRate], [/^\/settings$/, pageSettings],
];
$('#random-btn').onclick = randomAnime;
// Выход: сервер закроет окно и выключится сам. Крестик окна закрывает только окно.
$('#quit-btn').onclick = async () => {
  if (!await confirmBox('Закрыть Animax полностью?', 'Выйти')) return;
  await saveNow().catch(() => {});
  fetch('/api/quit', { method: 'POST' }).catch(() => {});
};
$('#back-btn').onclick = () => goBack();
$('#filter-btn').onclick = () => go('#/filter');
$('#stream-btn').onclick = () => streamDialog();
$('#keys-btn').onclick = () => keysHelp();

// Окно «Горячие клавиши» (клавиша ? или кнопка ⌨ сверху)
// клавиши — массивом: «или», «/» — связки между ними, «~текст» — действие мышью (без рамки клавиши)
const KEYS_HELP = [
  ['Везде', [[['Ctrl+K', 'или', '/'], 'Поиск'], [['Alt+←', '|', 'Alt+→'], 'Назад / вперёд'], [['F5'], 'Обновить экран'],
    [['Esc'], 'Закрыть окно или меню'], [['Home'], 'Наверх страницы'], [['?'], 'Это окно'], [['~Правый клик по карточке'], 'Быстрые действия']]],
  ['Плеер', [[['Пробел', 'или', 'K'], 'Пауза / продолжить'], [['←', '|', '→'], '−10 / +10 секунд'], [['↑', '|', '↓'], 'Громкость'],
    [['S'], 'Пропустить опенинг'], [['Shift+N', '|', 'Shift+P'], 'Следующая / предыдущая серия'], [['F'], 'Полный экран'],
    [['M'], 'Без звука'], [['C'], 'Субтитры'], [['[', '|', ']'], 'Медленнее / быстрее'],
    [['~Удержать кнопку мыши'], 'Ускорение 2×'], [['~Двойной клик по краю'], '−10 / +10 секунд']]],
];
const keyHtml = k => k === 'или' || k === '|' ? `<i>${k === '|' ? '/' : k}</i>` : k.startsWith('~') ? `<em>${esc(k.slice(1))}</em>` : `<kbd>${esc(k)}</kbd>`;
function keysHelp() {
  const b = modal(`<h3>Горячие клавиши</h3><div class="keys-cols">${KEYS_HELP.map(([head, rows]) => `<div class="keys-sec"><h4>${head}</h4>
    ${rows.map(([keys, d]) => `<div class="keys-row"><span>${keys.map(keyHtml).join(' ')}</span><b>${esc(d)}</b></div>`).join('')}</div>`).join('')}</div>
    <p class="muted" style="font-size:12px">Русская раскладка тоже работает: Л = K, А = F и так далее.</p>
    <div class="row-btns"><button class="btn primary" data-c>Понятно</button></div>`, 'keys');
  $('[data-c]', b).onclick = closeModal;
}

// «Наверх»: кнопка появляется, когда ушёл далеко вниз
const toTop = $('#to-top');
document.addEventListener('scroll', e => {
  if (e.target?.id !== 'view') return;
  const far = e.target.scrollTop > 1200;
  if (toTop.hidden === far) { toTop.hidden = !far; document.body.classList.toggle('has-top', far); }
}, { capture: true, passive: true });
const scrollTopNow = () => $('#view').scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches || LITE ? 'auto' : 'smooth' });
toTop.onclick = scrollTopNow;
// пропал интернет — честно говорим, почему ничего не грузится
addEventListener('offline', () => toast('Нет подключения к интернету — каталог и озвучки не загрузятся', 'err'));
addEventListener('online', () => toast('Интернет снова есть', 'ok'));

document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey && (e.key === 'k' || e.key === 'л')) || (e.key === '/' && !typing)) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (!typing && !player && $('#modal').hidden) {
    if (e.key === '?' || (e.key === ',' && e.shiftKey)) { e.preventDefault(); keysHelp(); }
    if (e.key === 'Home' && !e.ctrlKey) { e.preventDefault(); scrollTopNow(); }
  }
  if (e.key === 'F5') { e.preventDefault(); ANIME_CACHE.clear(); route(); }
  // Сочетания браузера: печать, сохранение страницы, исходный код, поиск, история, загрузки, инструменты разработчика
  const k = e.key.toLowerCase();
  if (e.key === 'F12' || e.key === 'F3' || e.key === 'F7' || (e.ctrlKey && e.shiftKey && 'ijc'.includes(k))
    || (e.ctrlKey && !e.shiftKey && 'psufghjdnr'.includes(k) && k.length === 1)) e.preventDefault();
  if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); hideCtx(); }
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

// Лёгкий режим: «Как у компьютера» — по памяти и ядрам (ответ сервера), иначе как выбрано в настройках
let SYS = null;
async function initLite() {
  SYS ??= await fetch('/api/sys').then(r => r.json()).catch(() => ({}));
  const m = S.settings.lite || 'auto';
  LITE = m === 'on' || (m === 'auto' && !!SYS.low_end);
  PAGE = LITE ? 20 : 30;  // меньше карточек за раз — меньше памяти и картинок
  document.documentElement.classList.toggle('lite', LITE);
}

(async () => {
  await loadState();
  await initLite();
  applyTheme();
  updateBadge();
  await route();
  $('#splash').classList.add('hide');
  setTimeout(() => $('#splash').remove(), 400);
  // Окно плеера ничего не проверяет в фоне: это делает главное окно. Иначе каждое открытое окно
  // находило бы те же новые серии и уведомления приходили бы по два-три раза.
  if (PLAYER_WINDOW) return;
  checkGoto();
  setInterval(checkGoto, 1500);
  checkNewEpisodes(true);
  setInterval(checkNewEpisodes, 30 * 60 * 1000);
  checkReplies();
  setInterval(checkReplies, 10 * 60 * 1000);
  syncShikimori();
  setInterval(syncShikimori, 15 * 60 * 1000);
})();
