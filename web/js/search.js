'use strict';
// Animax — поиск, фильтр каталога, поиск по озвучкам.

// ================= Поиск =================
const searchInput = $('#search'), suggestBox = $('#suggest');
let suggestSel = -1;
function hideSuggest() { suggestBox.hidden = true; suggestSel = -1; }
function rememberSearch(text) {
  S.searchHistory = [text, ...S.searchHistory.filter(x => x.toLowerCase() !== text.toLowerCase())].slice(0, 20);
  save();
}
const runSuggest = debounce(async text => {
  if (text.length < 2) {
    if (!text && S.searchHistory.length && document.activeElement === searchInput) {
      suggestBox.innerHTML = S.searchHistory.slice(0, 7).map(h => `<a href="#/search?q=${encodeURIComponent(h)}"><span class="muted">🕘</span><div class="s-t">${esc(h)}</div></a>`).join('')
        + '<a class="s-all" href="#/search">Вся история поиска</a>';
      suggestBox.hidden = false;
    } else hideSuggest();
    return;
  }
  try {
    const d = await gql(animes({ search: text, limit: 6 }));
    if (searchInput.value.trim() !== text) return;
    suggestBox.innerHTML = d.animes.map(snap).map(a => `<a href="#/anime/${a.id}" data-q="${esc(text)}"><img src="${img(a.poster, 100)}" alt="">
      <div><div class="s-t">${esc(title(a))}</div><div class="s-m">${esc(a.name)} · ${esc(metaLine(a))}</div></div></a>`).join('')
      + `<a class="s-all" href="#/search?q=${encodeURIComponent(text)}">Все результаты →</a>`;
    suggestBox.hidden = false;
    suggestSel = -1;
  } catch { hideSuggest(); }
}, 280);
searchInput.addEventListener('input', () => runSuggest(searchInput.value.trim()));
searchInput.addEventListener('focus', () => runSuggest(searchInput.value.trim()));
searchInput.addEventListener('keydown', e => {
  const items = $$('a', suggestBox);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    suggestSel = (suggestSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('sel', i === suggestSel));
  } else if (e.key === 'Enter') {
    const v = searchInput.value.trim();
    if (suggestSel >= 0 && items[suggestSel]) go(items[suggestSel].getAttribute('href'));
    else if (v) go('#/search?q=' + encodeURIComponent(v));
    if (v) rememberSearch(v);
    searchInput.blur();
    hideSuggest();
  } else if (e.key === 'Escape') { hideSuggest(); searchInput.blur(); }
});
suggestBox.addEventListener('click', e => {
  const a = e.target.closest('a[data-q]');
  if (a) rememberSearch(a.dataset.q);
  hideSuggest();
  searchInput.value = '';
});
document.addEventListener('mousedown', e => { if (!e.target.closest('.search')) hideSuggest(); });

async function pageSearch(view, q, _, alive) {
  const text = q.get('q') || '';
  if (!text) {
    view.innerHTML = `<h1 class="page-title">Поиск</h1>
      <div class="sec-head" style="margin-top:0"><h2>История поиска</h2>${S.searchHistory.length ? '<button class="link" id="clr">Очистить все</button>' : ''}</div>
      <div class="list" style="max-width:640px">${S.searchHistory.map(h => `<a class="folder" href="#/search?q=${encodeURIComponent(h)}"><span>🕘</span><span class="p">${esc(h)}</span></a>`).join('') || '<div class="muted">Пока пусто. Начни вводить название в строке сверху.</div>'}</div>`;
    $('#clr')?.addEventListener('click', () => { S.searchHistory = []; save(); route(); });
    searchInput.focus();
    return;
  }
  view.innerHTML = `<h1 class="page-title">Поиск: «${esc(text)}»</h1><div id="fr"></div><div id="sr"></div>`;
  let first = true;
  pager($('#sr'), async page => {
    const d = await gql(animes({ search: text, limit: PAGE, page }, fieldsFor() + (page === 1 ? ' franchise' : '')));
    if (first && d.animes[0]?.franchise) { first = false; franchiseBlock(d.animes[0], alive); }
    return { items: d.animes.map(snap), done: d.animes.length < PAGE };
  }, a => item(a), alive);
  setTimeout(() => {
    const sr = $('#sr');
    if (alive() && sr && sr.querySelector('.empty')) sr.insertAdjacentHTML('beforeend', `<div style="text-align:center"><a class="btn" href="#/filter">Открыть фильтр</a></div>
      <p class="muted" style="text-align:center">Попробуй написать название по-английски или латиницей (например, «Sousou no Frieren»).</p>`);
  }, 2500);
}
async function franchiseBlock(a, alive) {
  try {
    const d = await gql(animes({ ids: String(a.id), limit: 1, rating: '' }, `chronology { ${CARD} }`));
    const list = (d.animes[0]?.chronology || []).map(snap);
    if (!alive() || list.length < 2) return;
    $('#fr').innerHTML = `<div class="franchise-card"><div class="stack">${list.slice(0, 3).map(x => `<img src="${img(x.poster)}" alt="">`).join('')}</div>
      <div style="flex:1"><div class="muted">Франшиза</div><h3 style="margin:2px 0">${esc(title(snap(a)))}</h3><div class="muted">${plural(list.length, 'тайтл', 'тайтла', 'тайтлов')} во франшизе</div></div>
      <a class="btn primary" href="#/anime/${a.id}/related">Перейти</a></div>`;
  } catch { /* блок франшизы необязателен */ }
}

// ================= Фильтр =================
// Фильтр хранится как объект и кладётся в адрес страницы — поэтому его можно скопировать ссылкой.
const F_KEYS = ['kind', 'genre', 'gmode', 'excl', 'studio', 'studioName', 'origin', 'from', 'to', 'season', 'status', 'duration', 'rating', 'score', 'order', 'dub', 'dubName'];
function filterFromQuery(q) {
  const f = {};
  F_KEYS.forEach(k => { const v = q.get(k); if (v) f[k] = v; });
  return f;
}
function filterToQuery(f) {
  const p = new URLSearchParams();
  F_KEYS.forEach(k => { if (f[k]) p.set(k, f[k]); });
  return p.toString();
}
function filterArgs(f) {
  const a = { order: f.order || 'popularity' };
  if (f.kind) a.kind = f.kind;
  if (f.status) a.status = f.status;
  if (f.genre) a.genre = f.genre.split(',').map(g => f.gmode === 'none' ? '!' + g : g).join(',');
  if (f.studio) a.studio = f.studio;
  if (f.origin) a.origin = f.origin;
  if (f.duration) a.duration = f.duration;
  if (f.rating) a.rating = f.rating;
  if (f.score) a.score = +f.score;
  const y0 = +f.from || 0, y1 = +f.to || 0;
  if (f.season) {
    const a0 = y0 || new Date().getFullYear() - 25, a1 = y1 || new Date().getFullYear() + 1;
    const list = [];
    for (let y = a1; y >= a0 && list.length < 40; y--) f.season.split(',').forEach(s => list.push(`${s}_${y}`));
    a.season = list.join(',');
  } else if (y0 || y1) a.season = `${y0 || 1917}_${y1 || new Date().getFullYear() + 3}`;
  return a;
}
// Чего нет в Shikimori — фильтруем у себя (исключить закладки)
function filterLocal(f) {
  if (!f.excl) return null;
  const ex = new Set(f.excl.split(','));
  return a => !(S.list[a.id]?.status && ex.has(S.list[a.id].status)) && !(ex.has('fav') && S.list[a.id]?.fav);
}
const F_ORDER = { popularity: 'По популярности', ranked: 'По рейтингу', aired_on: 'По дате выхода', id_desc: 'По дате добавления', name: 'По алфавиту', random: 'Случайно' };
const F_ORDER_NOTE = { popularity: 'Сначала самые популярные', ranked: 'Сначала с самой высокой оценкой', aired_on: 'Сначала самые новые', id_desc: 'Сначала недавно добавленные в базу', name: 'От А до Я (по оригинальному названию)', random: 'В случайном порядке' };
const F_KIND = { tv: 'ТВ-сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл', tv_special: 'ТВ-спешл', music: 'Клип' };
const F_STATUS = { released: 'Вышел', ongoing: 'Выходит', anons: 'Анонс' };
const F_DUR = { S: 'До 10 минут', D: 'До 30 минут', F: 'Более 30 минут' };
const F_RATING = { g: '0+', pg: '6+', pg_13: '13+', r: '16+', r_plus: '18+' };
const F_SEASON = { winter: 'Зима', spring: 'Весна', summer: 'Лето', fall: 'Осень' };
const F_EXCL = { ...LIST_NAME, fav: 'Избранное' };
const names = (map, csv) => (csv || '').split(',').filter(Boolean).map(k => map[k] || k).join(', ');
let GENRES = null;
async function genres() {
  if (!GENRES) {
    const d = await gql('genres(entryType: Anime) { id russian kind }');
    const hidden = new Set(['Хентай', 'Эротика', 'Яой', 'Юри']);
    GENRES = d.genres.filter(g => !hidden.has(g.russian)).sort((a, b) => a.kind.localeCompare(b.kind) || a.russian.localeCompare(b.russian));
  }
  return GENRES;
}
function filterSummary(f) {
  const g = GENRES && f.genre ? f.genre.split(',').map(id => GENRES.find(x => x.id === id)?.russian || id).join(', ') : f.genre ? 'жанры: ' + f.genre.split(',').length : '';
  return [
    f.kind && names(F_KIND, f.kind),
    g && (f.gmode === 'none' ? 'Кроме: ' + g : 'Жанры: ' + g),
    (f.from || f.to) && (f.from && f.to ? (f.from === f.to ? f.from + ' год' : `с ${f.from} по ${f.to}`) : f.from ? 'с ' + f.from : 'по ' + f.to),
    f.season && names(F_SEASON, f.season),
    f.status && names(F_STATUS, f.status),
    f.origin && names(ORIGIN, f.origin),
    f.studioName && 'Студия: ' + f.studioName,
    f.dubName && 'Озвучка: ' + f.dubName,
    f.duration && names(F_DUR, f.duration),
    f.rating && 'Возраст: ' + names(F_RATING, f.rating),
    f.score && 'Оценка от ' + f.score,
    f.excl && 'Без закладок: ' + names(F_EXCL, f.excl),
    f.order && f.order !== 'popularity' && F_ORDER[f.order],
  ].filter(Boolean).join(' · ');
}

async function pageFilter(view, q, _, alive) {
  const target = q.get('target') || 'results';
  const f = filterFromQuery(q);
  const gs = await genres();
  if (!alive()) return;
  const field = (key, label, value, note = '') => `<button class="ffield ${value ? 'on' : ''}" data-f="${key}"><small>${label}</small><span>${esc(value || 'Неважно')}</span>${note ? `<span class="note">${note}</span>` : ''}</button>`;
  const draw = () => {
    const gnames = f.genre ? f.genre.split(',').map(id => gs.find(x => x.id === id)?.russian).filter(Boolean).join(', ') : '';
    view.innerHTML = `<div class="fpage">
      <div style="display:flex;align-items:center;gap:12px"><h1 class="page-title" style="margin:0;flex:1">${target === 'mytab' ? 'Настройка «' + esc(S.myTab.name) + '»' : 'Фильтр'}</h1>
        <button class="btn" id="f-link" title="Скопировать ссылку на фильтр">🔗 Ссылка</button></div>
      ${target === 'mytab' ? '<div class="hint" style="margin-top:14px"><span>💡</span><div>Выбери, что хочешь видеть на своей вкладке. Настройки хранятся только на этом компьютере.</div></div>' : '<div style="height:18px"></div>'}
      <div class="fgrid">
        ${field('kind', 'Тип', names(F_KIND, f.kind))}
        ${field('genre', 'Жанры', gnames && (f.gmode === 'none' ? 'Кроме: ' : '') + gnames)}
        ${field('status', 'Статус', names(F_STATUS, f.status))}
        ${field('years', 'Годы', f.from || f.to ? `${f.from || '…'} — ${f.to || '…'}` : '')}
        ${field('season', 'Сезон', names(F_SEASON, f.season))}
        ${field('origin', 'Первоисточник', names(ORIGIN, f.origin))}
        ${field('studio', 'Студия', f.studioName || '')}
        ${target === 'mytab' || SYS?.online === false ? '' : field('dub', 'Озвучка', f.dubName, 'Работает вместе с остальными фильтрами: тайтлы, где эта озвучка есть')}
        ${field('duration', 'Длительность эпизода', names(F_DUR, f.duration))}
        ${field('rating', 'Возрастное ограничение', names(F_RATING, f.rating))}
        ${field('score', 'Оценка Shikimori', f.score ? 'от ' + f.score : '')}
        ${field('excl', 'Исключить закладки', names(F_EXCL, f.excl), 'Уберёт из выдачи тайтлы из выбранных списков')}
        ${field('order', 'Сортировка', F_ORDER[f.order || 'popularity'], F_ORDER_NOTE[f.order || 'popularity'])}
      </div>
      ${f.genre && f.genre.split(',').length > 4 && f.gmode !== 'none' ? '<p class="field-err">Выбрано много жанров — нужны тайтлы со всеми сразу, поэтому результатов может не быть.</p>' : ''}
      <div class="fbar"><button class="btn" id="f-reset">Сбросить</button><button class="btn primary" id="f-apply">${target === 'mytab' ? 'Сохранить вкладку' : 'Применить'}</button></div></div>`;
    $$('[data-f]', view).forEach(b => b.onclick = () => edit(b.dataset.f));
    $('#f-link').onclick = () => copy(`${location.origin}/#/results?${filterToQuery(f)}`, 'Ссылка на фильтр скопирована');
    $('#f-reset').onclick = async () => { if (await confirmBox('Сбросить все фильтры?', 'Сбросить')) { Object.keys(f).forEach(k => delete f[k]); draw(); } };
    $('#f-apply').onclick = () => {
      if (target === 'mytab') { S.myTab.filter = { ...f }; save(); toast('Вкладка настроена'); go('#/?tab=mytab'); }
      else go('#/results?' + filterToQuery(f));
    };
  };
  // arr === null — окно закрыли без выбора: фильтр не трогаем
  const set = (k, arr) => { if (!arr) return; if (arr.length) f[k] = arr.join(','); else delete f[k]; draw(); };
  const opts = map => Object.entries(map).map(([v, label]) => ({ v, label }));
  const cur = k => (f[k] || '').split(',').filter(Boolean);
  async function edit(k) {
    if (k === 'kind') set(k, await picker('Тип', opts(F_KIND), cur(k)));
    else if (k === 'status') set(k, await picker('Статус', opts(F_STATUS), cur(k)));
    else if (k === 'season') set(k, await picker('Сезон', opts(F_SEASON), cur(k), { note: 'Вместе с «Годами» — сезоны в этих годах.' }));
    else if (k === 'origin') set(k, await picker('Первоисточник', opts(ORIGIN), cur(k), { search: true }));
    else if (k === 'duration') set(k, await picker('Длительность эпизода', opts(F_DUR), cur(k)));
    else if (k === 'rating') set(k, await picker('Возрастное ограничение', opts(F_RATING), cur(k)));
    else if (k === 'excl') set(k, await picker('Исключить закладки', opts(F_EXCL), cur(k), { note: 'Исключит из выдачи все тайтлы из выбранных списков.' }));
    else if (k === 'order') { const r = await picker('Сортировка', opts(F_ORDER), [f.order || 'popularity'], { multi: false }); if (!r) return; if (r[0]) f.order = r[0]; else delete f.order; draw(); }
    else if (k === 'score') { const r = await picker('Оценка Shikimori не ниже', [6, 7, 8, 9].map(n => ({ v: n, label: n + '+' })), cur(k), { multi: false }); if (r) set(k, r[0] ? [r[0]] : []); }
    else if (k === 'dub') dubPickerModal((tid2, label2) => {
      if (tid2) { f.dub = tid2; f.dubName = label2; } else { delete f.dub; delete f.dubName; }
      draw();
    }, true);
    else if (k === 'genre') genrePicker();
    else if (k === 'years') yearsPicker();
    else if (k === 'studio') studioPicker();
  }
  function genrePicker() {
    const sel = new Set(cur('genre'));
    let mode = f.gmode || 'all';
    const groups = { genre: 'Жанры', theme: 'Тематика', demographic: 'Аудитория' };
    const box = modal(`<h3>Фильтр по жанрам</h3>
      <div class="mode-chips"><button class="chip" data-m="all">Все выбранные</button><button class="chip" data-m="none">Без выбранных</button></div>
      <p class="muted" id="gm-note" style="margin:4px 0"></p>
      <input class="input" id="gq" placeholder="Поиск жанра" style="width:100%">
      <div class="checks" id="gl"></div>
      <div class="row-btns" style="justify-content:space-between"><button class="btn" data-all>Выбрать все</button><div style="display:flex;gap:10px"><button class="btn" data-r>Сбросить</button><button class="btn primary" data-ok>Выбрать</button></div></div>`);
    const notes = { all: 'Покажем тайтлы со всеми выбранными жанрами. Для точного результата выбирай 2–3 жанра.', none: 'Покажем только тайтлы без выбранных жанров.' };
    const drawMode = () => { $$('[data-m]', box).forEach(c => c.classList.toggle('on', c.dataset.m === mode)); $('#gm-note', box).textContent = notes[mode]; };
    const drawList = (qq = '') => {
      $('#gl', box).innerHTML = Object.entries(groups).map(([g, gname]) => {
        const items = gs.filter(x => x.kind === g && (!qq || x.russian.toLowerCase().includes(qq)));
        return items.length ? `<h5>${gname}</h5>` + items.map(x => `<label><input type="checkbox" value="${x.id}" ${sel.has(x.id) ? 'checked' : ''}>${esc(x.russian)}</label>`).join('') : '';
      }).join('');
      $$('input', $('#gl', box)).forEach(i => i.onchange = () => i.checked ? sel.add(i.value) : sel.delete(i.value));
    };
    $$('[data-m]', box).forEach(c => c.onclick = () => { mode = c.dataset.m; drawMode(); });
    $('#gq', box).oninput = e => drawList(e.target.value.trim().toLowerCase());
    box.querySelector('[data-all]').onclick = () => { gs.forEach(x => sel.add(x.id)); drawList($('#gq', box).value.trim().toLowerCase()); };
    box.querySelector('[data-r]').onclick = () => { closeModal(); delete f.gmode; set('genre', []); };
    box.querySelector('[data-ok]').onclick = () => { closeModal(); if (mode === 'none') f.gmode = 'none'; else delete f.gmode; set('genre', [...sel]); };
    drawMode();
    drawList();
  }
  function yearsPicker() {
    const box = modal(`<h3>Годы выхода</h3><div class="range2"><span>с</span><input class="input" type="number" id="y0" min="1917" max="2035" value="${esc(f.from || '')}" placeholder="1990">
      <span>по</span><input class="input" type="number" id="y1" min="1917" max="2035" value="${esc(f.to || '')}" placeholder="${new Date().getFullYear()}"></div>
      <div class="row-btns"><button class="btn" data-r>Сбросить</button><button class="btn primary" data-ok>Выбрать</button></div>`);
    box.querySelector('[data-r]').onclick = () => { closeModal(); delete f.from; delete f.to; draw(); };
    box.querySelector('[data-ok]').onclick = () => {
      let a = +$('#y0', box).value || 0, b = +$('#y1', box).value || 0;
      if (a && b && a > b) [a, b] = [b, a];
      a ? f.from = String(a) : delete f.from;
      b ? f.to = String(b) : delete f.to;
      closeModal();
      draw();
    };
  }
  async function studioPicker() {
    const box = modal('<h3>Студия</h3><div class="loading">Загрузка списка студий…</div>');
    try {
      const list = (await rest('/api/studios')).filter(s => s.name).sort((a, b) => a.name.localeCompare(b.name));
      if ($('#modal').hidden) return;
      const r = await picker('Студия', list.map(s => ({ v: s.id, label: s.filtered_name || s.name })), f.studio ? [f.studio] : [], { multi: false, search: true });
      if (!r) return;
      const [id] = r;
      if (id) { f.studio = id; f.studioName = list.find(s => String(s.id) === id)?.name || id; } else { delete f.studio; delete f.studioName; }
      draw();
    } catch (err) { box.innerHTML = `<h3>Студия</h3><p class="muted">Не удалось загрузить: ${esc(err.message)}</p>`; }
  }
  draw();
}

async function pageResults(view, q, _, alive) {
  const f = filterFromQuery(q);
  await genres().catch(() => {});
  if (!alive()) return;
  view.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h1 class="page-title" style="margin:0;flex:1">Фильтр</h1>
      <a class="btn" href="#/filter?${filterToQuery(f)}">⚲ Изменить</a><button class="icon-btn" id="r-more">⋮</button></div>
    <div class="fsum" style="margin-top:12px">⚲ ${esc(filterSummary(f) || 'Без условий — весь каталог')}</div><div id="rs"></div>`;
  $('#r-more').onclick = () => {
    const r = $('#r-more').getBoundingClientRect();
    const items = [
      ['🔗', 'Скопировать ссылку', () => copy(location.href, 'Ссылка на фильтр скопирована')],
      ['★', `Установить для «${S.myTab.name}»`, async () => {
        if (S.myTab.filter && !(await confirmBox(`«${esc(S.myTab.name)}» уже настроена.<br><small class="muted">Сейчас: ${esc(filterSummary(S.myTab.filter) || 'без условий')}<br>Будет: ${esc(filterSummary(f) || 'без условий')}</small>`, 'Заменить'))) return;
        S.myTab.filter = { ...f }; save(); toast('Готово — смотри на главной');
      }],
    ];
    ctx.innerHTML = items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${esc(t)}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false;
    ctx.style.left = (r.right - 260) + 'px';
    ctx.style.top = (r.bottom + 6) + 'px';
  };
  const loc = filterLocal(f);
  if (f.dub) {
    // озвучка в фильтре: выдача строится из каталога озвучек (Shikimori-условия
    // сервер пропускает на Shikimori-REST, у каждого тайтла проверяется озвучка)
    const name = new URLSearchParams();
    const args = filterArgs(f);
    ['kind', 'status', 'genre', 'score', 'duration', 'rating', 'season', 'order'].forEach(k => {
      if (args[k]) name.set(k, args[k]);
    });
    const base = `/api/dubs/find?tid=${encodeURIComponent(f.dub)}` + (name.toString() ? '&' + name.toString() : '');
    pager($('#rs'), async page => {
      const r = await fetch(`${base}&page=${page}`).then(x => x.json());
      if (r.error) throw new Error(r.error);
      const items = (r.items || []).map(a => snap({ ...a, image: { original: a.img } }));
      const done = r.candidates !== undefined ? r.candidates < 50 : items.length < 50;
      if (loc) return { items: items.filter(loc), done };
      return { items, done };
    }, a => item(a, { badge: f.dubName }), alive);
    return;
  }
  pager($('#rs'), catalogPage(filterArgs(f), loc), a => item(a), alive);
}

// ================= Поиск по озвучкам (как «Translations» в Anixart) =================
// Словарь озвучек берём у Kodik (3639 шт.), каталог тайтлов озвучки строит
// сервер (Shikimori-кандидаты + проверка озвучки у Kodik, см. /api/dubs*).
let DUBS_CACHE = null;
const DUB_TYPES = { voice: 'озвучка', subtitles: 'сабы' };
async function dubsAll() {
  if (!DUBS_CACHE) {
    try {
      const d = await fetch('/api/dubs').then(r => r.json());
      DUBS_CACHE = (d.dubs || []).map(x => ({ ...x, n: (d.counts || {})[x.id] || 0 }));
      DUBS_CACHE.sample = d.sample || 0;  // размер выборки скана (0 = счётчики ещё считаются)
      const groups = new Map();
      for (const d of DUBS_CACHE) {
        const b = dubBase(d.title);
        if (b.length === 1) {
          const k = d.type + '|' + b[0];
          (groups.get(k) || groups.set(k, []).get(k)).push(d);
        }
      }
      const drop = new Set();
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        const lead = [...arr].sort((x, y) => (y.n || 0) - (x.n || 0))[0];
        const base = lead.title.replace(new RegExp('\\b(?:' + [...DUB_JUNK].join('|') + ')\\s*$', 'i'), '').trim();
        if (base) lead.title = base.replace(/[.·,\s]+$/, '');
        for (const d of arr) if (d !== lead) drop.add(d);
      }
      DUBS_CACHE = DUBS_CACHE.filter(d => !drop.has(d));
      // сначала то, что реально озвучено (больше тайтлов), известные студии — раньше
      DUBS_CACHE.sort((x, y) => (y.n || 0) - (x.n || 0) || dubRank(x.title) - dubRank(y.title) || x.title.localeCompare(y.title));
    } catch { DUBS_CACHE = []; DUBS_CACHE.sample = 0; }
  }
  return DUBS_CACHE;
}
const dubChip = x => `<a class="chip" style="font-size:13px;padding:6px 14px" href="#/dubs?tid=${x.id}&label=${encodeURIComponent(x.title)}" title="${DUB_TYPES[x.type] || x.type}${x.n ? ' · ' + x.n + ' тайтлов' : ''}">${esc(x.title)}${x.n ? ` <span style="opacity:.6;font-weight:500">${x.n}</span>` : ''}</a>`;

// Дубли студий: Kodik держит несколько записей одной команды («AniLibria.TV»,
// «AniLibria.TV Old», «…18+»). Схлопываем: показываем запись с наибольшим
// счётчиком (под чистым названием), остальные полностью убираем из списков.
const DUB_JUNK = new Set(['tv', 'тв', 'ru', 'online', 'онлайн', 'old', 'старая', 'старое', 'hd', 'net', 'org', 'com']);
const dubBase = t => {
  const w = ((t || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) || [])
    .filter(x => !(/^\d+$/.test(x)));
  while (w.length > 1 && DUB_JUNK.has(w[w.length - 1])) w.pop();
  // AniLiberty и AniLibria — одна студия, в Kodik они записаны по-разному
  if (w[0] === 'aniliberty') w[0] = 'anilibria';
  return w;
};

// модальный выбор озвучки (для страницы фильтра). pick(tid, label)
function dubPickerModal(pick, clearable = false) {
  const box = modal(`<h3>Выбор озвучки</h3>
    <div class="mode-chips"><button class="chip" data-t="voice">Озвучки</button><button class="chip" data-t="subtitles">Субтитры</button><button class="chip" data-t="all">Все</button></div>
    <input class="input" id="dp-q" placeholder="Название озвучки — например, AniDUB" style="width:100%">
    <div class="checks" id="dp-list"></div>
    ${clearable ? '<div class="row-btns"><button class="btn" id="dp-r">Без озвучки</button></div>' : ''}`);
  let type = 'voice';
  dubsAll().then(list => {
    if ($('#modal').hidden) return;
    if (!list.length) { $('#dp-list', box).innerHTML = '<div class="muted" style="padding:8px">Не удалось загрузить список озвучек</div>'; return; }
    const draw = (qq = '') => {
      // по умолчанию — только то, что реально озвучено (есть счётчик > 0);
      // пока счётчики считаются — известные студии по DUB_RANK
      const hasCounts = (list.sample || 0) > 0;
      let pool = hasCounts ? list.filter(x => x.n > 0) : list.filter(x => dubRank(x.title) < 999);
      let rest = null;
      if (type !== 'all') pool = pool.filter(x => x.type === type);
      if (qq) pool = pool.filter(x => x.title.toLowerCase().includes(qq));
      if (qq && pool.length < 5) {
        rest = list.filter(x => (type === 'all' || x.type === type) && x.title.toLowerCase().includes(qq)
          && (hasCounts ? !x.n : dubRank(x.title) >= 999));
      }
      const row = x => `<button class="drow" data-tid="${x.id}" data-label="${esc(x.title)}"><span>${esc(x.title)}</span><small>${DUB_TYPES[x.type] || x.type}${x.n ? ' · ' + x.n + ' тайтлов' : ''}</small></button>`;
      $('#dp-list', box).innerHTML = (pool.slice(0, 60).map(row).join('')
        + (rest && rest.length ? `<h5 style="margin:10px 8px 4px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.8px">Остальное (пустые / каналы / одиночные)</h5>` + rest.slice(0, 60).map(row).join('') : ''))
        || (hasCounts ? '<div class="muted" style="padding:8px">Не нашлось — попробуй написать иначе</div>'
          : '<div class="muted" style="padding:8px">Не нашлось; подождём пару минут — сейчас подтягиваются счётчики тайтлов, после список станет точным</div>');
      $$('[data-tid]', $('#dp-list', box)).forEach(b => b.onclick = () => { closeModal(); pick(+b.dataset.tid, b.dataset.label); });
    };
    $('#dp-q', box).oninput = e => draw(e.target.value.trim().toLowerCase());
    $$('[data-t]', box).forEach(c => c.onclick = () => {
      type = c.dataset.t;
      $$('[data-t]', box).forEach(d => d.classList.toggle('on', d === c));
      draw($('#dp-q', box).value.trim().toLowerCase());
    });
    $$('[data-t]', box).find(c => c.dataset.t === 'voice').classList.add('on');
    if (clearable) $('#dp-r', box).onclick = () => { closeModal(); pick(0, ''); };
    draw();
  });
}

async function pageDubs(view, q, _, alive) {
  if (SYS?.online === false) {
    view.innerHTML = '<h1 class="page-title">Озвучки</h1>' + emptyHtml('🎙', 'В этой версии Animax онлайн-озвучек нет', 'Смотри свои файлы из «Медиатеки», ссылки на свой медиасервер (🔗) или официальные площадки — кнопка «Где смотреть» на странице тайтла.');
    return;
  }
  const tid = q.get('tid');
  const label = (q.get('label') || '').trim();
  if (!tid) {
    // витрина: словарь озвучек (известные сверху), поиск по подстроке
    view.innerHTML = `<h1 class="page-title">Озвучки</h1>
      <div class="muted" style="margin:6px 0 16px">Выбери студию — покажем тайтлы, где она озвучивала. Тайтл из выдачи открывается сразу на сериях выбранной озвучки, там же кнопка «🔔 Следить».</div>
      <div class="fsum" style="margin-bottom:10px"><span style="display:flex;gap:8px;align-items:center">⚲ <input class="input" id="d-q" placeholder="Найти озвучку…" style="width:240px">
      <select class="select" id="d-t" style="width:auto"><option value="voice">Озвучки</option><option value="subtitles">Субтитры</option><option value="all">Все</option></select></span></div>
      <label class="muted" style="display:flex;gap:8px;align-items:center;margin:0 0 16px;cursor:pointer"><input type="checkbox" id="d-all">
        <span id="d-all-t">Показать все записи (в том числе каналы, сабы и одиночные озвучки)</span></label>
      <div id="d-list" class="loading">Загрузка списка…</div>`;
    dubsAll().then(list => {
      const box = $('#d-list', view);
      if (!alive() || !box) return;
      box.classList.remove('loading');
      $('#d-all-t', view).textContent = `Показать все записи (${list.length} — включая каналы, сабы и одиночные озвучки)`;
      const hasCounts = (list.sample || 0) > 0;
      if (!hasCounts) box.insertAdjacentHTML('beforebegin',
        '<div class="muted" style="margin:0 0 12px">⏳ Считаем, сколько тайтлов у каждой озвучки — подсветим числа и уберём пустые через пару минут. Пока показаны известные студии.</div>');
      const draw = () => {
        const qq = ($('#d-q', view)?.value || '').trim().toLowerCase();
        const ty = $('#d-t', view)?.value || 'voice';
        const all = $('#d-all', view)?.checked;
        // по умолчанию — только реально озвученные (счётчик > 0); пока счётчики
        // считаются — известные студии по DUB_RANK
        const pool = all ? list : list.filter(x => hasCounts ? x.n > 0 : dubRank(x.title) < 999);
        const shown = pool.filter(x => (ty === 'all' || x.type === ty) && (!qq || x.title.toLowerCase().includes(qq))).slice(0, 400);
        let empty = '<span class="muted">Ничего не нашлось</span>';
        if (!shown.length && !all &&
            list.some(x => (ty === 'all' || x.type === ty) && (!qq || x.title.toLowerCase().includes(qq))))
          empty = `<span class="muted">${hasCounts ? 'Такие записи есть, но пустые/нишевые — включи «Показать все записи» ↑' : 'Такие записи есть, но в полном списке — включи «Показать все записи» ↑'}</span>`;
        box.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px">${shown.length ? shown.map(dubChip).join('') : empty}</div>
          ${shown.length && pool.length > shown.length ? `<div class="muted" style="margin-top:10px">Показаны первые ${shown.length} — уточни поиск или переключи тип.</div>` : ''}`;
      };
      $('#d-q', view).oninput = draw;
      $('#d-t', view).onchange = draw;
      $('#d-all', view).onchange = draw;
      draw();
    });
    return;
  }
  // каталог: тайтлы выбранной озвучки, с подгрузкой при прокрутке
  view.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h1 class="page-title" style="margin:0;flex:1">Озвучка: ${esc(label || '#' + tid)}<span class="muted" id="d-cnt" style="font-size:13px;font-weight:400"></span></h1>
      <a class="btn" href="#/dubs">⇠ Другая озвучка</a></div>
    <div class="fsum" style="margin:12px 0 16px"><span style="display:flex;gap:8px;align-items:center">⚲ <input class="input" id="d-q" placeholder="Название тайтла (необязательно)" style="width:280px" value="${esc(q.get('q') || '')}">
      <button class="btn primary" id="d-go">Показать</button></span></div>
    ${hint('dubcat', 'Выдача — самые популярные тайтлы Shikimori, у которых проверена эта озвучка. Прокрути вниз — подгрузим ещё страницу. Если ищешь конкретный тайтл — впиши его название выше: проверим точно его.')}
    <div id="d-box"></div>`;
  const href = a => `#/anime/${a.id}/watch?g=${encodeURIComponent(label)}`;
  const applyQ = () => go(`#/dubs?tid=${tid}&label=${encodeURIComponent(label)}&q=` + encodeURIComponent($('#d-q', view).value.trim()));
  $('#d-go', view).onclick = applyQ;
  $('#d-q', view).addEventListener('keydown', e => { if (e.key === 'Enter') applyQ(); });
  const sq = (q.get('q') || '').trim();
  const qs = `tid=${encodeURIComponent(tid)}` + (sq ? `&q=${encodeURIComponent(sq)}` : '');
  const oneShot = !!sq; // поиск по названию — одна порция, прокрутка не нужна
  dubsAll().then(list => {  // счётчик тайтлов в заголовке
    const d = list.find(x => String(x.id) === String(tid));
    if (alive() && d && $('#d-cnt', view)) $('#d-cnt', view).textContent = d.n ? ` · ${d.n} тайтлов в топе` : '';
  });
  pager($('#d-box', view), async page => {
    let r;
    try {
      r = await fetch(`/api/dubs/find?${qs}&page=${page}`).then(x => x.json());
    } catch (e) { r = { error: e.message }; }
    if (r.error) throw new Error(r.error);
    const items = (r.items || []).map(a => snap({ ...a, image: { original: a.img } }));
    return { items, done: oneShot || (r.candidates !== undefined ? r.candidates < 50 : items.length < 50) };
  }, a => item(a, { href: href(a), badge: label }), alive);
}
