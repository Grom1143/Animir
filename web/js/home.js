'use strict';
// Animax — Главная, Обзор, рекомендации, популярное, случайное.

// ================= Главная =================
function currentSeason(d = new Date()) {
  const m = d.getMonth() + 1;
  let y = d.getFullYear();
  const s = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall';
  if (m === 12) y++;
  return `${s}_${y}`;
}
const HOME_TABS = {
  mytab: ['Моя вкладка', null, 'Персонально настроенный раздел'],
  latest: ['Последнее', { status: 'ongoing,latest', order: 'aired_on' }, 'Недавно вышедшие и выходящие сейчас'],
  // эти три — бывшие «Релизы»: с датами, тумблером «Следить» и фильтром аниме/донхуа (4-й элемент — режим releasesList)
  ongoing: ['Онгоинги', null, 'Сериалы, которые выходят сейчас', 'ongoing'],
  anons: ['Анонсы', null, 'Будущие релизы и новинки', 'anons'],
  released: ['Завершённые', null, 'Недавно вышедшие полностью', 'finished'],
  movies: ['Фильмы', { kind: 'movie', order: 'popularity' }, 'Полнометражные фильмы'],
  ova: ['OVA', { kind: 'ova,special,tv_special', order: 'popularity' }, 'Специальные и дополнительные эпизоды'],
};
const tabName = k => k === 'mytab' ? S.myTab.name : HOME_TABS[k][0];

async function pageHome(view, q, _, alive) {
  const tab = HOME_TABS[q.get('tab')] ? q.get('tab') : S.settings.homeTab in HOME_TABS ? S.settings.homeTab : 'latest';
  view.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:18px">
      <div class="tabs" style="margin:0;flex:1">${Object.keys(HOME_TABS).map(k => `<a class="tab ${k === tab ? 'on' : ''}" data-tab="${k}" href="#/?tab=${k}" title="${HOME_TABS[k][2]}">${esc(tabName(k))}${k === S.settings.homeTab ? ' <small>★</small>' : ''}</a>`).join('')}</div>
      <button class="icon-btn" id="tab-set" title="Настройка вкладок">☰</button>
    </div>
    ${hint('tabs', 'Правый клик по названию вкладки — сделать её вкладкой по умолчанию или настроить «Мою вкладку».')}
    <div id="home-grid"></div>`;
  const tabMenu = (x, y, k) => {
    const items = [['★', 'Назначить по умолчанию', () => { S.settings.homeTab = k; save(); toast(`«${tabName(k)}» будет открываться при запуске`); route(); }]];
    if (k === 'mytab') {
      items.push(['✎', 'Переименовать', renameMyTab], ['⚲', 'Настроить вкладку', () => go('#/filter?target=mytab&' + filterToQuery(S.myTab.filter || {}))]);
    }
    ctx.innerHTML = `<div class="ch"><b>${esc(tabName(k))}</b><span>${HOME_TABS[k][2]}</span></div>` + items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${t}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false;
    ctx.style.left = Math.min(x, innerWidth - 260) + 'px';
    ctx.style.top = y + 'px';
  };
  $$('[data-tab]', view).forEach(t => t.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(e.clientX, e.clientY, t.dataset.tab); }));
  $('#tab-set').onclick = async () => {
    const r = $('#tab-set').getBoundingClientRect();
    const items = [
      ['★', 'Изменить вкладку по умолчанию', async () => {
        const [k] = (await picker('Вкладка по умолчанию', Object.keys(HOME_TABS).map(k => ({ v: k, label: tabName(k) })), [S.settings.homeTab], { multi: false, note: 'Выбранная вкладка будет открываться при запуске Animax.' })) || [];
        if (k) { S.settings.homeTab = k; save(); route(); }
      }],
      ['⚲', 'Настроить мою вкладку', () => go('#/filter?target=mytab&' + filterToQuery(S.myTab.filter || {}))],
      ['✎', 'Переименовать мою вкладку', renameMyTab],
    ];
    ctx.innerHTML = items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${t}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false;
    ctx.style.left = (r.right - 260) + 'px';
    ctx.style.top = (r.bottom + 6) + 'px';
  };

  const box = $('#home-grid');
  if (tab === 'mytab') {
    const f = S.myTab.filter;
    if (!f) {
      box.innerHTML = `<div class="empty"><span class="ic">✦</span><b>Это твоя вкладка</b><br>Настрой её под себя: выбери жанры, годы, тип и всё, что хочешь видеть на главной.<br><br>
        <a class="btn primary" href="#/filter?target=mytab">Настроить</a></div>`;
      return;
    }
    box.innerHTML = `<div class="fsum">⚲ ${esc(filterSummary(f) || 'Без условий')} <a class="linkbtn" href="#/filter?target=mytab&${filterToQuery(f)}">Изменить</a></div>`;
    pager(box, catalogPage(filterArgs(f), filterLocal(f)), a => item(a), alive);
    return;
  }
  const rl = HOME_TABS[tab][3];
  if (rl) {
    const kind = RL_KINDS[q.get('k')] ? q.get('k') : 'all';
    box.innerHTML = `<div class="tabs rl-kinds">${Object.entries(RL_KINDS).map(([k, n]) => `<a class="tab ${k === kind ? 'on' : ''}" href="#/?tab=${tab}&k=${k}">${n}</a>`).join('')}</div>
      ${hint('releases', 'Включи «Следить» у анонса — Animax сообщит, когда начнётся показ, а потом о новых сериях. Донхуа (китайская анимация) определяется по названиям приблизительно.')}
      <div id="rl"><div class="loading">Загрузка…</div></div>`;
    return releasesList($('#rl'), rl, kind, alive);
  }
  pager(box, catalogPage(HOME_TABS[tab][1]), a => item(a), alive);
}
async function renameMyTab() {
  const b = modal(`<h3>Название вкладки</h3><input class="input" id="tn" maxlength="24" style="width:100%" value="${esc(S.myTab.name)}">
    <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn primary" data-ok>Сохранить</button></div>`);
  $('#tn', b).select();
  b.querySelector('[data-c]').onclick = closeModal;
  b.querySelector('[data-ok]').onclick = () => { S.myTab.name = $('#tn', b).value.trim() || 'Моя вкладка'; save(); closeModal(); route(); };
}

// ================= Обзор =================
async function pageDiscover(view, q, _, alive) {
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  const d = await gql([
    animes({ status: 'ongoing', order: 'popularity', limit: 7 }, CARD + ' description screenshots { originalUrl }', 'hero'),
    animes({ status: 'ongoing', order: 'popularity', limit: 16, page: 2 }, CARD, 'now'),
    animes({ season: currentSeason(), order: 'ranked', limit: 16 }, CARD, 'season'),
  ].join(' '));
  if (!alive()) return;
  const hero = d.hero;
  const cont = continueItems();
  view.innerHTML = `
    <section class="hero" id="hero"><div class="bg"></div><div class="in"></div>
      <div class="dots">${hero.map((_, i) => `<button data-i="${i}"></button>`).join('')}</div></section>
    <div class="tiles">
      <a class="tile" href="#/popular"><b>🏆</b>Популярное</a>
      <a class="tile" href="#/schedule"><b>▦</b>Расписание</a>
      <a class="tile" href="#/collections"><b>▣</b>Коллекции</a>
      <a class="tile" id="t-rand"><b>🎲</b>Случайное</a>
      <a class="tile" href="#/recs"><b>✦</b>Рекомендации</a>
      <a class="tile" href="#/now"><b>👁</b>Смотрят сейчас</a>
      ${SYS?.online === false ? '' : '<a class="tile" href="#/dubs"><b>🎙</b>Озвучки</a>'}
      <a class="tile" href="#/filter"><b>⚲</b>Фильтр</a>
      <a class="tile" href="#/library"><b>▶</b>Медиатека</a>
    </div>
    ${cont.length ? `<div class="sec-head"><h2>Продолжить просмотр</h2><a class="link" href="#/bookmarks?tab=history">История</a></div>
      <div class="row">${cont.map(historyCard).join('')}</div>` : ''}
    <div class="sec-head"><h2>Рекомендации</h2><span class="sub">На основе твоих оценок</span><a class="link" href="#/recs">Показать все</a></div>
    <div id="recs"><div class="loading">Подбираю…</div></div>
    <div class="sec-head"><h2>Смотрят сейчас</h2><a class="link" href="#/now">Показать все</a></div>
    <div class="row">${d.now.map(snap).map(a => card(a)).join('')}</div>
    <div class="sec-head"><h2>Лучшее этого сезона</h2><a class="link" href="#/results?${(([s, y]) => `season=${s}&from=${y}&to=${y}`)(currentSeason().split('_'))}&order=ranked">Показать все</a></div>
    <div class="row">${d.season.map(snap).map(a => card(a)).join('')}</div>
    ${S.collections.length ? `<div class="sec-head"><h2>Мои коллекции</h2><a class="link" href="#/collections">Показать все</a></div>
      <div class="grid colls">${S.collections.slice(0, 3).map(collCard).join('')}</div>` : ''}`;

  let i = 0;
  const show = n => {
    i = (n + hero.length) % hero.length;
    const a = hero[i], s = snap(a);
    SNAPS.set(s.id, s);
    $('#hero .bg').style.backgroundImage = `url("${img(a.screenshots?.[0]?.originalUrl || s.poster)}")`;
    $('#hero .in').innerHTML = `<img ${pimg(s, 180)} alt=""><div>
      <div class="chip">Интересное · сейчас выходит</div>
      <h1>${esc(title(s))}</h1>
      <div class="meta">★ ${s.score || '—'} · ${esc(metaLine(s))}</div>
      <p>${esc(s.desc)}</p>
      <a class="btn primary" href="#/anime/${s.id}">Подробнее</a></div>`;
    $$('#hero .dots button').forEach((b, k) => b.classList.toggle('on', k === i));
  };
  $$('#hero .dots button').forEach(b => b.onclick = () => { show(+b.dataset.i); clearInterval(timer); });
  show(0);
  // в лёгком режиме баннер не листается сам — меньше перерисовок
  const timer = LITE ? 0 : setInterval(() => { if (!alive() || !$('#hero')) return clearInterval(timer); show(i + 1); }, 8000);
  $('#t-rand').onclick = randomAnime;

  try {
    const recs = await recommendations(16);
    if (!alive()) return;
    $('#recs').innerHTML = recs === null
      ? `<div class="hint"><span>✦</span><div>Оценивай просмотренное — чем честнее оценки, тем точнее подборка. Нужно хотя бы 2 тайтла с оценкой ${likedText()} или мнением «👍 Положительный». <a class="linkbtn" href="#/rate">Оценить просмотренное</a></div></div>`
      : `<div class="row">${recs.map(a => card(a)).join('')}</div>`;
  } catch (err) { $('#recs').innerHTML = `<div class="muted">Не удалось подобрать: ${esc(err.message)}</div>`; }
}
// Рекомендации: похожие на тайтлы с оценкой 4–5 ★, которых ещё нет в закладках
// Насколько мне понравился тайтл, от −3 до +3: оценка (0.5–5 ★, т.е. 1–10 → −2.5…+2) + моё мнение о нём.
// Положительное добавляет, отрицательное заметно убавляет, нейтральное не влияет. «Брошено» — минус.
const TONE_W = { pos: 1, neu: 0, neg: -1.5 };
function tastes() {
  const m = new Map();
  const add = (anime, w) => {
    const t = m.get(anime.id) || { anime, w: 0, tone: 0 };
    t.w += w;
    m.set(anime.id, t);
    return t;
  };
  Object.values(S.list).forEach(e => {
    if (e.score) add(e.anime, e.score - 3);
    if (e.status === 'dropped') add(e.anime, -1);
  });
  Object.values(S.opinions).forEach(o => { add(o.anime, 0).tone = TONE_W[o.tone] * 1.5; });
  m.forEach(t => { t.w = Math.max(-3, Math.min(3, t.w + t.tone)); });
  return [...m.values()].filter(t => t.w);
}
// Рекомендации: похожие на то, что понравилось (с весом), минус похожие на то, что не понравилось,
// плюс поправка по жанрам. Уже добавленное в закладки не предлагаем.
// Список считается один раз и хранится, пока не поменяются оценки и мнения.
let recsCache = null;
const RECS_GENRE_TOP = 400;
async function rankedRecs() {
  const all = tastes();
  const key = JSON.stringify(all.map(t => [t.anime.id, t.w]));
  if (recsCache?.key === key) return recsCache;
  const liked = all.filter(t => t.w > 0).sort((a, b) => b.w - a.w).slice(0, 25);
  const disliked = all.filter(t => t.w < 0).sort((a, b) => a.w - b.w).slice(0, 10);
  if (liked.length < 2) return null;
  const cand = new Map(), mine = new Set(all.map(t => t.anime.id));
  const addSimilar = async (src, w, why) => {
    const sim = await rest(`/api/animes/${src.id}/similar`).catch(() => []);
    sim.forEach((a, i) => {
      if (S.list[a.id]?.status || mine.has(a.id)) return;
      const c = cand.get(a.id) || { a: snap(a), w: 0, why: null, best: 0 };
      const part = w * Math.max(3, 20 - i) * (w < 0 ? 0.8 : 1);
      c.w += part;
      if (part > c.best) { c.best = part; c.why = why; }
      cand.set(a.id, c);
    });
  };
  // запросы отправляем сразу пачкой: сервер сам держит паузы для Shikimori, а ожидание ответов
  // идёт параллельно (по одному было больше минуты). Порядок весов от этого не зависит.
  await Promise.all([...liked, ...disliked].map(t => addSimilar(t.anime, t.w, t.anime)));
  // второй шаг: похожее на лучших кандидатов — с меньшим весом, чтобы список не кончался быстро
  const first = [...cand.values()].filter(c => c.w > 0).sort((x, y) => y.w - x.w).slice(0, 12);
  await Promise.all(first.map(c => addSimilar(c.a, 0.4, c.why)));
  // жанры: что нравится — плюс, что нет — минус. Уточняем только верх списка (RECS_GENRE_TOP):
  // кандидатов тысячи, а жанры приходят по 50 за запрос.
  const genreW = {};
  all.forEach(t => (t.anime.genres || []).forEach(g => { genreW[g] = (genreW[g] || 0) + t.w; }));
  const pool = [...cand.values()].filter(c => c.w > 0).sort((x, y) => y.w - x.w);
  const head = pool.slice(0, RECS_GENRE_TOP), ids = head.map(c => c.a.id);
  const parts = [];
  for (let i = 0; i < ids.length; i += 50) parts.push(ids.slice(i, i + 50));
  await Promise.all(parts.map(async part => {
    const d = await gql(animes({ ids: part.join(','), limit: 50, rating: '' }, 'id genres { russian kind }'));
    d.animes.forEach(x => {
      const c = cand.get(+x.id);
      if (!c) return;
      c.a.genres = x.genres.filter(g => g.kind !== 'demographic').map(g => g.russian);
      c.w += c.a.genres.reduce((n, g) => n + (genreW[g] || 0), 0) * 3;
    });
  }));
  const named = c => { if (c.why) c.a.why = title(c.why); return c.a; };
  const list = [...head.filter(c => c.w > 0).sort((x, y) => y.w - x.w), ...pool.slice(RECS_GENRE_TOP)].map(named);
  recsCache = { key, list, genreW };
  return recsCache;
}
async function recommendations(limit = 60) {
  const r = await rankedRecs();
  return r && fillPosters(r.list.slice(0, limit));
}
// Лента для страницы рекомендаций: сначала подборка по похожим, когда она кончится — лучшие тайтлы
// любимых жанров (по одному жанру, по рейтингу), без уже показанного и того, что есть в закладках.
async function recsFeed(r) {
  const all = await genres();
  const top = Object.entries(r.genreW).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1])
    .map(([n]) => all.find(g => g.russian === n)).filter(Boolean).slice(0, 6);
  const shown = new Set();
  let gi = 0, gpage = 1;
  return async page => {
    const from = (page - 1) * PAGE;
    if (from < r.list.length) {
      const items = await fillPosters(r.list.slice(from, from + PAGE));
      items.forEach(a => shown.add(a.id));
      return { items, done: false };
    }
    while (gi < top.length) {
      const g = top[gi];
      const d = await gql(animes({ genre: g.id, order: 'ranked', kind: 'tv,movie,ona,ova', limit: PAGE, page: gpage }, fieldsFor()));
      if (d.animes.length < PAGE) { gi++; gpage = 1; } else gpage++;
      const items = d.animes.map(snap).filter(a => !shown.has(a.id) && !S.list[a.id]?.status);
      items.forEach(a => { shown.add(a.id); a.genreWhy = g.russian; });
      if (items.length) return { items, done: false };
    }
    return { items: [], done: true };
  };
}
const recMeta = a => a.why ? { meta: 'Похоже на «' + a.why + '»' } : a.genreWhy ? { meta: 'Любимый жанр: ' + a.genreWhy } : undefined;
async function pageRecs(view, q, _, alive) {
  view.innerHTML = '<h1 class="page-title">Рекомендации</h1><div class="loading">Подбираю…</div>';
  const r = await rankedRecs();
  if (!alive()) return;
  view.innerHTML = `<h1 class="page-title">Рекомендации</h1>
    ${hint('recs3', 'Подборка строится по твоим оценкам и мнениям о тайтлах: похожее на то, что понравилось, выше; похожее на то, что не понравилось (низкая оценка, «Брошено», мнение 👎), ниже. Когда похожие закончатся, дальше идут лучшие тайтлы твоих любимых жанров. Под каждым тайтлом — что о нём думают зрители по отзывам на Shikimori.')}
    ${r === null ? emptyHtml('✦', 'Пока мало данных', 'Поставь ' + likedText() + ' или мнение «👍 Положительный» хотя бы двум тайтлам — и здесь появятся рекомендации.<br><br><a class="btn primary" href="#/rate">Оценить просмотренное</a>')
      : `<div class="tabs" id="rc-sort"><a class="tab on" data-s="me">По моему вкусу</a><a class="tab" data-s="people">Советуют зрители</a></div><div id="rc-box"></div>`}`;
  if (!r) return;
  const viewers = viewersOnCards(alive);
  const feed = await recsFeed(r);
  if (!alive()) return;
  pager($('#rc-box'), async page => { const res = await feed(page); viewers(res.items); return res; }, a => item(a, recMeta(a)), alive);
  $('#rc-box').firstChild.id = 'rc-grid';
}
// Мнения зрителей под рекомендациями: доля положительных отзывов на Shikimori.
// Отзывы читаются по одному тайтлу (Shikimori просит не чаще 5 запросов в секунду), поэтому догружаются постепенно.
// Возвращает функцию: передай ей новые карточки — подпишем и их.
function viewersOnCards(alive) {
  const stat = new Map(), order = [], queue = [];
  let running = false;
  const grid = () => $('#rc-grid');
  const sortBy = mode => {
    const ids = mode === 'people'
      ? [...order].sort((x, y) => (stat.get(y)?.rank ?? -1) - (stat.get(x)?.rank ?? -1))
      : order;
    ids.forEach(id => { const el = $(`[data-aid="${id}"]`, grid()); if (el) grid().append(el); });
  };
  $$('#rc-sort .tab').forEach(t => t.onclick = () => {
    $$('#rc-sort .tab').forEach(x => x.classList.toggle('on', x === t));
    sortBy(t.dataset.s);
  });
  async function run() {
    if (running) return;
    running = true;
    while (queue.length && alive()) {
      const id = queue.shift();
      const c = await fetch('/api/reviews?id=' + id).then(r => r.json()).then(j => j.counts).catch(() => null);
      if (!alive() || !grid()) break;  // пока ждали ответ, ушли со страницы
      if (!c?.all) continue;
      const share = Math.round(c.positive / c.all * 100);
      // мало отзывов — доверяем меньше: тянем долю к 50 %
      stat.set(id, { rank: (c.positive + 2) / (c.all + 4) });
      const el = $(`[data-aid="${id}"] .m`, grid());
      if (el) el.insertAdjacentHTML('afterend', `<div class="viewers-line" title="Отзывы на Shikimori: 👍 ${c.positive} · 😐 ${c.neutral} · 👎 ${c.negative}">
        <i style="--p:${share}%"></i><span>👍 ${share}% из ${plural(c.all, 'отзыва', 'отзывов', 'отзывов')}</span></div>`);
      if ($('#rc-sort .tab.on')?.dataset.s === 'people') sortBy('people');
    }
    running = false;
  }
  return items => {
    items.forEach(a => { order.push(a.id); queue.push(a.id); });
    setTimeout(run);
  };
}
async function pagePopular(view, q, _, alive) {
  const tabs = { all: ['За всё время', { order: 'popularity' }], ongoing: ['Онгоинги', { status: 'ongoing', order: 'popularity' }], season: ['Этот сезон', { season: currentSeason(), order: 'popularity' }], top: ['Лучшее по оценке', { order: 'ranked' }], movies: ['Фильмы', { kind: 'movie', order: 'popularity' }] };
  const tab = tabs[q.get('tab')] ? q.get('tab') : 'all';
  view.innerHTML = `<h1 class="page-title">Популярное</h1>
    <div class="tabs">${Object.entries(tabs).map(([k, [n]]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/popular?tab=${k}">${n}</a>`).join('')}</div><div id="pl"></div>`;
  pager($('#pl'), async page => {
    const d = await gql(animes({ ...tabs[tab][1], limit: PAGE, page }, CARD + ' description'));
    return { items: d.animes.map(snap), done: d.animes.length < PAGE };
  }, (a, i) => lrow(a, { rank: i + 1 }), alive, 'lgrid');
}
async function pageNow(view, q, _, alive) {
  view.innerHTML = `<h1 class="page-title">Смотрят сейчас</h1><p class="muted" style="margin-top:-10px">Самые популярные из того, что выходит прямо сейчас</p><div id="nl"></div>`;
  pager($('#nl'), catalogPage({ status: 'ongoing', order: 'popularity' }), a => item(a), alive);
}
// Случайный тайтл. Берём у Shikimori сразу пачку из 50 случайных и выдаём по одному — так быстро и без повторов.
// Пропускаем то, что уже просмотрено или брошено, и то, что выпадало недавно.
const randomPool = [];
let randomBusy = false;
async function refillRandom() {
  const seen = new Set(S.randomSeen || []);
  const skip = id => seen.has(id) || ['completed', 'dropped'].includes(S.list[id]?.status);
  for (let tries = 0; tries < 3 && randomPool.length < 5; tries++) {
    const d = await gql(animes({ order: 'random', score: 7, kind: 'tv,movie,ona,ova', status: 'released,ongoing', limit: 50 }, 'id'));
    d.animes.map(a => +a.id).filter(id => !skip(id) && !randomPool.includes(id)).forEach(id => randomPool.push(id));
  }
}
async function randomAnime() {
  if (randomBusy) return;
  randomBusy = true;
  try {
    if (randomPool.length < 5) await refillRandom();
    const id = randomPool.shift();
    if (!id) { toast('Не нашлось ничего нового — попробуй ещё раз'); return; }
    S.randomSeen = [id, ...(S.randomSeen || []).filter(x => x !== id)].slice(0, 300);
    save();
    const h = `#/anime/${id}?random=1`;
    // «Другой случайный» со страницы случайного тайтла заменяет её, чтобы «Назад» не листал все выпавшие
    if (parseHash().q.get('random') === '1') { history.replaceState({ d: navDepth() }, '', h); route(); }
    else go(h);
    if (randomPool.length < 5) refillRandom().catch(() => {});  // подкачиваем заранее
  } catch (err) { toast('Ошибка: ' + err.message); }
  finally { randomBusy = false; }
}
