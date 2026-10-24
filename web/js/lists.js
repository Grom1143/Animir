'use strict';
// Animax — закладки, история, коллекции (свои и Shikimori).

// ================= Закладки =================
const BM_TABS = [['collections', 'Коллекции'], ['history', 'История'], ['favorites', 'Избранное'], ...LISTS];
const BM_SORT = { added_desc: 'По добавлению: сначала новые', added_asc: 'По добавлению: сначала старые', year_desc: 'По году: сначала новые', year_asc: 'По году: сначала старые', name_asc: 'По алфавиту: А–Я', name_desc: 'По алфавиту: Я–А', rating_desc: 'По рейтингу: по убыванию', rating_asc: 'По рейтингу: по возрастанию', my_desc: 'По моей оценке' };
function sortEntries(arr, how) {
  const t = e => e.statusAt || e.added || 0;
  const by = {
    added_desc: (a, b) => t(b) - t(a), added_asc: (a, b) => t(a) - t(b),
    year_desc: (a, b) => (b.anime.year || 0) - (a.anime.year || 0), year_asc: (a, b) => (a.anime.year || 9999) - (b.anime.year || 9999),
    name_asc: (a, b) => title(a.anime).localeCompare(title(b.anime)), name_desc: (a, b) => title(b.anime).localeCompare(title(a.anime)),
    rating_desc: (a, b) => b.anime.score - a.anime.score, rating_asc: (a, b) => a.anime.score - b.anime.score,
    my_desc: (a, b) => (b.score || 0) - (a.score || 0) || t(b) - t(a),
  };
  return arr.sort(by[how] || by.added_desc);
}
function pageBookmarks(view, q) {
  const tab = BM_TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : S.settings.bookmarksTab;
  const sort = BM_SORT[q.get('sort')] ? q.get('sort') : 'added_desc';
  const flt = q.get('flt') || 'all';
  const all = Object.values(S.list);
  const count = k => k === 'favorites' ? all.filter(e => e.fav).length : k === 'history' ? S.history.length : k === 'collections' ? S.collections.length : all.filter(e => e.status === k).length;
  const link = o => '#/bookmarks?' + new URLSearchParams({ tab, sort, flt, ...o });
  view.innerHTML = `<h1 class="page-title">Закладки</h1>
    <div class="tabs">${BM_TABS.map(([k, n]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/bookmarks?tab=${k}">${n}<small>${count(k)}</small></a>`).join('')}</div>
    <div id="bm"></div>`;
  const box = $('#bm');
  if (tab === 'collections') { box.innerHTML = collectionsGrid(); bindCollections(box); return; }
  if (tab === 'history') { renderHistory(box); return; }
  let items = all.filter(e => tab === 'favorites' ? e.fav : e.status === tab);
  if (flt === 'anons') items = items.filter(e => e.anime.status === 'anons');
  if (flt === 'noanons') items = items.filter(e => e.anime.status !== 'anons');
  const qtext = (q.get('q') || '').toLowerCase();
  if (qtext) items = items.filter(e => (title(e.anime) + ' ' + e.anime.name).toLowerCase().includes(qtext));
  items = sortEntries(items, sort);
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <b>${plural(items.length, 'тайтл', 'тайтла', 'тайтлов')}</b>
      <input class="input" id="bq" placeholder="Поиск в списке" value="${esc(q.get('q') || '')}" style="width:220px;height:34px">
      <span style="flex:1"></span>
      <select class="select" id="bs">${Object.entries(BM_SORT).map(([k, n]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="select" id="bf">${[['all', 'Все'], ['anons', 'Только анонсы'], ['noanons', 'Исключить анонсы']].map(([k, n]) => `<option value="${k}" ${k === flt ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="icon-btn" id="br" title="Открыть случайный из списка">🔀</button></div>
    ${hint('bookmarks', 'Правый клик по карточке — быстрые действия: статус, избранное, коллекция.')}
    ${items.length ? `<div class="${gridClass()}">${items.map(e => {
      const total = e.anime.episodes || e.anime.episodesAired;
      // из «Смотрю» сразу на список серий
      const href = tab === 'watching' ? `#/anime/${e.anime.id}/episodes` : undefined;
      return isList() ? lrow(e.anime, { href, extra: `просмотрено ${e.ep || 0}/${total || '?'}${e.score ? ' · моя оценка ' + scoreText(e.score) : ''}` })
        : card(e.anime, { href, noMark: tab !== 'favorites', badge: `${e.ep || 0}/${total || '?'}`, bar: total ? Math.min(100, (e.ep || 0) / total * 100) : null, meta: e.score ? 'Моя оценка: ' + scoreText(e.score) : metaLine(e.anime) });
    }).join('')}</div>`
      : emptyHtml(tab === 'favorites' ? '♡' : '▤', 'Здесь пока ничего нет', tab === 'favorites' ? 'Нажми «♡ В избранное» на странице тайтла.' : `Добавляй тайтлы в «${LIST_NAME[tab]}» — кнопкой статуса на странице аниме или правым кликом по карточке.`)}`;
  $('#bs').onchange = e => go(link({ sort: e.target.value }));
  $('#bf').onchange = e => go(link({ flt: e.target.value }));
  $('#bq').oninput = debounce(e => {
    const h = link({ q: e.target.value });
    history.replaceState({ d: navDepth() }, '', h);
    lastHash = location.hash;  // это тот же экран, а не переход
    pageBookmarks(view, new URLSearchParams(h.split('?')[1]));
    const i = $('#bq');
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }, 300);
  $('#br').onclick = () => { if (items.length) go('#/anime/' + shuffle(items).anime.id); };
}

// ================= История =================
function continueItems() {
  return S.history.filter(h => { const p = S.progress[h.file]; return p && !p.done; }).slice(0, 12);
}
const histHref = h => {
  if (h.stream) return '#/watch?s=' + h.stream;
  // онлайн-серия (ключ прогресса «o:<тайтл>:<озвучка>:<серия>») — прямо на эту серию с той же озвучкой
  const m = /^o:(\d+):(.+):(\d+)$/.exec(h.file || '');
  if (m) return '#/watch?' + new URLSearchParams({ o: m[1], d: m[2], e: m[3] }).toString();
  return '#/watch?f=' + encodeURIComponent(h.file);
};
function historyCard(h) {
  const p = S.progress[h.file] || {};
  const a = h.anime || { id: 0, russian: h.name, poster: '' };
  if (a.id) SNAPS.set(a.id, a);
  return `<a class="card" href="${histHref(h)}" ${a.id ? `data-aid="${a.id}" data-hist="${esc(h.file)}"` : ''}><div class="poster"><img loading="lazy" src="${img(a.poster)}" alt="">
    ${h.ep != null ? `<span class="eps">${h.ep} серия</span>` : ''}<div class="bar"><i style="width:${p.d ? p.t / p.d * 100 : 0}%"></i></div></div>
    <div class="t">${esc(a.id ? title(a) : h.name)}</div><div class="m">${p.d ? `${fmtTime(p.t)} из ${fmtTime(p.d)}` : ''}</div></a>`;
}
function renderHistory(box) {
  box.innerHTML = S.history.length ? `<div style="display:flex;gap:10px;margin-bottom:14px"><b style="flex:1">${plural(S.history.length, 'запись', 'записи', 'записей')}</b><button class="btn sm" id="clr">Очистить историю</button></div>
    <div class="list">${S.history.map(h => {
      const p = S.progress[h.file] || {};
      const a = h.anime || { id: 0, poster: '' };
      const html = wideCard(a.id ? a : { ...a, russian: h.name }, `${h.ep != null ? '✓ серия ' + h.ep + ' · ' : ''}${p.done ? 'просмотрено' : p.d ? `${fmtTime(p.t)} из ${fmtTime(p.d)}` : ''} · 🕘 ${ago(h.at)}<br><span class="muted">${esc([h.dub, h.name].filter(Boolean).join(' · '))}</span>`, histHref(h));
      return a.id ? html.replace('class="wide-card"', `class="wide-card" data-hist="${esc(h.file)}"`) : html;
    }).join('')}</div>` : emptyHtml('↺', 'История пуста', 'Начни что-нибудь смотреть — серия обязательно здесь сохранится.');
  $('#clr', box)?.addEventListener('click', async () => { if (await confirmBox('Очистить историю просмотров?', 'Очистить')) { S.history = []; save(); route(); } });
}

// ================= Коллекции =================
function collCard(c) {
  return `<a class="coll-card" href="#/collection/${c.id}"><div class="covers">${c.items.slice(0, 4).map(x => `<img loading="lazy" src="${img(x.poster, 160)}" alt="">`).join('')}</div>
    <div class="b"><div class="t">${esc(c.name)}</div><div class="m">${plural(c.items.length, 'тайтл', 'тайтла', 'тайтлов')} · ред. ${fmtWhen(c.updated || c.created)}</div></div></a>`;
}
function collectionsGrid(sort = 'updated', qtext = '') {
  let list = [...S.collections];
  if (qtext) list = list.filter(c => c.name.toLowerCase().includes(qtext.toLowerCase()));
  const by = { updated: (a, b) => (b.updated || 0) - (a.updated || 0), created: (a, b) => b.created - a.created, name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => b.items.length - a.items.length };
  list.sort(by[sort] || by.updated);
  return `<div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <a class="btn primary" href="#/collection/new/edit">＋ Создать коллекцию</a>
      <input class="input" id="cq" placeholder="Поиск моих коллекций" value="${esc(qtext)}" style="width:240px;height:34px"><span style="flex:1"></span>
      <select class="select" id="cs">${[['updated', 'Недавно изменённые'], ['created', 'Недавно созданные'], ['name', 'По названию'], ['size', 'По размеру']].map(([k, n]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div id="cg">${list.length ? `<div class="grid colls">${list.map(collCard).join('')}</div>` : emptyHtml('▣', qtext ? 'Не нашлось' : 'Коллекций пока нет', qtext ? '' : 'Собирай свои подборки: «Лучшее за лето», «Посоветовать другу»…')}</div>`;
}
function bindCollections(box) {
  const redraw = () => {
    const s = $('#cs', box).value, t = $('#cq', box).value;
    box.innerHTML = collectionsGrid(s, t);
    bindCollections(box);
    const i = $('#cq', box); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  };
  $('#cs', box).onchange = redraw;
  $('#cq', box).oninput = debounce(redraw, 250);
}
// ---- коллекции Shikimori: все (с поиском по названию, описанию, группам, тайтлам и автору) и мои ----
const SC_SORT = [['new', 'Новые'], ['votes', 'Лучшие по голосам'], ['size', 'Большие'], ['comments', 'Обсуждаемые']];
function shikiCollCard(c) {
  const covers = (c.preview || []).slice(0, 4);
  const bits = [c.up ? `👍 ${c.up}` : '', c.size ? plural(c.size, 'запись', 'записи', 'записей') : '', c.user?.nickname, c.created ? fmtDate(c.created) : ''].filter(Boolean);
  return `<a class="coll-card" href="#/scoll/${c.id}"><div class="covers">${covers.map(x => `<img loading="lazy" src="${img(x.poster, 160)}" alt="">`).join('')}</div>
    <div class="b"><div class="t">${esc(c.title)}${c.spoilers ? ' <span class="sc-tag">спойлеры</span>' : ''}</div><div class="m">${esc(bits.join(' · '))}</div>
    ${c.match ? `<div class="sc-match">${esc(c.match)}</div>` : ''}</div></a>`;
}
async function pageCollections(view, q, _, alive) {
  const tab = q.get('tab') === 'mine' ? 'mine' : 'all';
  view.innerHTML = `<h1 class="page-title">Коллекции</h1>
    <div class="tabs"><a class="tab ${tab === 'all' ? 'on' : ''}" href="#/collections">Все коллекции</a><a class="tab ${tab === 'mine' ? 'on' : ''}" href="#/collections?tab=mine">Мои</a></div>
    <div id="cb"></div>`;
  const box = $('#cb');
  if (tab === 'mine') return myCollections(box, alive);
  box.innerHTML = `<div class="sc-bar">
      <input class="input" id="scq" placeholder="Название, описание, тайтл или автор" value="${esc(q.get('q') || '')}">
      <select class="select" id="scs">${SC_SORT.map(([k, n]) => `<option value="${k}" ${k === (q.get('sort') || 'new') ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label class="sc-only"><span class="switch"><input type="checkbox" id="sca" ${q.get('anime') === '0' ? '' : 'checked'}><span></span></span>Только с аниме</label></div>
    <div class="muted sc-index" id="sci"></div><div id="scr"></div>`;
  let gen = 0;
  const run = () => {
    const g = ++gen, live = () => alive() && g === gen;
    const p = { q: $('#scq').value.trim(), sort: $('#scs').value, anime: $('#sca').checked ? '1' : '0' };
    history.replaceState({ d: navDepth() }, '', '#/collections?' + new URLSearchParams(p));
    $('#scr').innerHTML = '';
    pager($('#scr'), async page => {
      const r = await fetch('/api/colls?' + new URLSearchParams({ ...p, page }), { headers: freshHdr() }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      if (page === 1 && live()) indexLine(r.index);
      return { items: r.items, done: r.done };
    }, shikiCollCard, live, 'grid colls');
  };
  // пока индекс собирается, поиск идёт только по названиям — показываем, сколько описаний уже прочитано
  const indexLine = st => {
    const el = $('#sci');
    if (!el || !st) return;
    el.textContent = !st.listed ? 'Собираю список коллекций Shikimori… Пока поиск только по названию.'
      : st.done < st.total ? `Читаю описания коллекций: ${st.done} из ${st.total}. Поиск по описанию и тайтлам работает для уже прочитанных.` : '';
  };
  const poll = setInterval(async () => {
    if (!alive()) return clearInterval(poll);
    const st = await fetch('/api/colls/status').then(r => r.json()).catch(() => null);
    indexLine(st);
    if (st && st.listed && st.done >= st.total) clearInterval(poll);
  }, 15000);
  $('#scq').oninput = debounce(run, 350);
  $('#scs').onchange = run;
  $('#sca').onchange = run;
  run();
}
async function myCollections(box, alive) {
  const au = await authStatus();
  const nick = au?.user?.nickname;
  // сначала свои коллекции Animax, ниже — с Shikimori
  box.innerHTML = `<div class="sec-head"><h2>В Animax</h2><span class="sub">хранятся только в этой программе</span></div><div id="sc-local"></div>
    <div class="sec-head" style="margin-top:28px"><h2>На Shikimori</h2>${nick ? `<span class="sub">${esc(nick)}</span>` : ''}
      <button class="btn sm" id="sc-new" style="margin-left:auto">＋ Создать на Shikimori ↗</button></div>
    <div id="sc-mine">${nick ? '<div class="loading">Загрузка…</div>' : `<div class="hint"><span>🔑</span><div>Войди в Shikimori — здесь появятся твои коллекции оттуда. <a class="linkbtn" href="#/settings?s=account">Войти</a></div></div>`}</div>`;
  $('#sc-new').onclick = () => openInBrowser(SHIKI_URL + 'collections/new');
  $('#sc-local').innerHTML = collectionsGrid();
  bindCollections($('#sc-local'));
  if (!nick) return;
  try {
    const r = await fetch('/api/colls/user?nick=' + encodeURIComponent(nick), { headers: freshHdr() }).then(x => x.json());
    if (!alive()) return;
    if (r.error) throw new Error(r.error);
    const all = [...r.published, ...r.coauthored.map(c => ({ ...c, coauthor: true }))];
    $('#sc-mine').innerHTML = all.length ? `<div class="grid colls">${all.map(shikiCollCard).join('')}</div>`
      : emptyHtml('▣', 'На Shikimori коллекций пока нет', 'Создай её на сайте — она появится здесь. Черновики («Открытые») видны только на самом сайте.');
  } catch (err) { $('#sc-mine').innerHTML = `<div class="muted">Не удалось загрузить: ${esc(err.message)}</div>`; }
}
// Чужая (или своя) коллекция с Shikimori: описание, группы, тайтлы с подписями автора
async function pageShikiColl(view, q, [id], alive) {
  view.innerHTML = '<div class="loading">Загрузка коллекции…</div>';
  const c = await fetch('/api/coll?id=' + id, { headers: freshHdr() }).then(r => r.json());
  if (!alive()) return;
  if (c.error) { view.innerHTML = emptyHtml('▣', 'Не удалось открыть', esc(c.error)) + '<div style="text-align:center"><a class="btn" href="#/collections">К коллекциям</a></div>'; return; }
  // аниме подтягиваем из каталога, чтобы были постеры, оценки и отметки списков
  const ids = [...new Set(c.groups.flatMap(g => g.items.filter(e => e.kind === 'anime').map(e => e.id)))];
  const full = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(animes({ ids: ids.slice(i, i + 50).join(','), limit: 50, rating: '' }, CARD));
    d.animes.forEach(a => full.set(+a.id, snap(a)));
  }
  if (!alive()) return;
  const anime = ids.map(x => full.get(x)).filter(Boolean);
  const kindName = { manga: 'Манга', ranobe: 'Ранобэ', character: 'Персонаж', person: 'Человек' };
  const kindPath = { manga: 'mangas', ranobe: 'ranobe', character: 'characters', person: 'people' };
  const entry = e => {
    const note = e.text ? `<div class="sc-note">${esc(e.text)}</div>` : '';
    if (e.kind === 'anime' && full.get(e.id)) return `<div class="rl-item">${card(full.get(e.id))}${note}</div>`;
    return `<div class="rl-item"><a class="card" href="${SHIKI_URL}${kindPath[e.kind] || 'animes'}/${e.id}" target="_blank" rel="noopener">
      <div class="poster"><img loading="lazy" src="${img(e.poster)}" alt=""></div><div class="t">${esc(e.name)}</div><div class="m">${kindName[e.kind] || 'Аниме'} · Shikimori ↗</div></a>${note}</div>`;
  };
  const counts = LISTS.map(([k]) => [k, anime.filter(x => S.list[x.id]?.status === k).length]);
  const inLists = counts.reduce((n, [, v]) => n + v, 0);
  view.innerHTML = `<div class="coll-head"><div class="covers">${(anime.length ? anime : c.groups.flatMap(g => g.items)).slice(0, 4).map(x => `<img src="${img(x.poster)}" alt="">`).join('')}</div>
      <div><h1 class="page-title" style="margin-bottom:6px">${esc(c.title)}</h1>
        <div class="muted">${esc(c.user.nickname)} · создана ${fmtDate(c.created)}${c.changed && c.changed !== c.created ? ' · изм. ' + fmtDate(c.changed) : ''} · ${plural(c.size, 'запись', 'записи', 'записей')}${anime.length && anime.length !== c.size ? `, аниме ${anime.length}` : ''}</div>
        <div class="muted" style="margin-top:4px">👍 ${c.up} · 👎 ${c.down} · 💬 ${c.comments}${c.spoilers ? ' · <span class="sc-tag">спойлеры</span>' : ''}</div>
        ${c.desc ? `<p class="desc sc-desc">${esc(c.desc)}</p>` : ''}
        <div class="actions"><button class="btn" id="sh">Открыть на Shikimori ↗</button>
          ${anime.length ? '<button class="btn" id="rnd">🔀 Случайный тайтл</button><button class="btn" id="keep">⧉ Сохранить себе в Animax</button>' : ''}</div></div></div>
    ${anime.length ? `<div class="people" style="margin-bottom:22px"><div class="muted" style="margin-bottom:8px">Из аниме в твоих списках: <b style="color:var(--text)">${inLists}</b> из ${anime.length}</div>
      <div class="pbar">${counts.map(([k, n]) => `<i style="width:${n / anime.length * 100}%;background:${LIST_COLOR[k]}"></i>`).join('')}</div>
      <div class="plegend">${counts.map(([k, n]) => `<span style="--c:${LIST_COLOR[k]}">${LIST_NAME[k]}: <b>${n}</b></span>`).join('')}</div></div>` : ''}
    ${c.groups.filter(g => g.items.length).map(g => `${g.name || c.groups.length > 1 ? `<div class="sec-head"><h2>${esc(g.name || 'Без названия')}</h2><span class="sub">${g.items.length}</span></div>` : ''}
      <div class="grid">${g.items.map(entry).join('')}</div>`).join('')}`;
  $('#sh').onclick = () => openInBrowser(`${SHIKI_URL}collections/${c.id}`);
  $('#rnd')?.addEventListener('click', () => go('#/anime/' + shuffle(anime).id));
  $('#keep')?.addEventListener('click', () => {
    const was = S.collections.find(x => x.shiki === c.id);
    const local = { id: was?.id || uid(), shiki: c.id, name: c.title.slice(0, 60), desc: (c.desc || '').slice(0, 1000), items: anime, created: was?.created || Date.now(), updated: Date.now() };
    if (was) Object.assign(was, local); else S.collections.unshift(local);
    save();
    toast(was ? 'Копия в Animax обновлена' : 'Сохранено в «Мои → В Animax»');
  });
}
function collectionPicker(s) {
  const box = modal(`<h3>Добавить в коллекцию</h3>
    <div class="list">${S.collections.map(c => `<label class="folder"><input type="checkbox" data-c="${c.id}" ${c.items.some(x => x.id === s.id) ? 'checked' : ''}><span class="p">${esc(c.name)}</span><span class="muted">${c.items.length}</span></label>`).join('') || '<div class="muted">Коллекций пока нет</div>'}</div>
    <div class="row-btns" style="justify-content:space-between"><div style="display:flex;gap:8px"><input class="input" id="new-c" placeholder="Новая коллекция" maxlength="60"><button class="btn" id="add-c">Создать</button></div><button class="btn primary" id="ok">Готово</button></div>`);
  $$('[data-c]', box).forEach(ch => ch.onchange = () => {
    const c = S.collections.find(x => x.id === ch.dataset.c);
    c.items = ch.checked ? [...c.items.filter(x => x.id !== s.id), snap(s)] : c.items.filter(x => x.id !== s.id);
    c.updated = Date.now();
    save();
    toast(ch.checked ? `Добавлено в «${c.name}»` : `Убрано из «${c.name}»`);
  });
  $('#add-c').onclick = () => {
    const name = $('#new-c').value.trim();
    if (!name) return;
    S.collections.unshift({ id: uid(), name, desc: '', items: [snap(s)], created: Date.now(), updated: Date.now() });
    save();
    collectionPicker(s);
  };
  $('#ok').onclick = closeModal;
}
function pageCollection(view, q, [cid]) {
  const c = S.collections.find(x => x.id === cid);
  if (!c) { view.innerHTML = emptyHtml('▣', 'Коллекция не найдена', 'Возможно, её удалили.') + '<div style="text-align:center"><a class="btn" href="#/collections">К коллекциям</a></div>'; return; }
  const counts = LISTS.map(([k]) => [k, c.items.filter(x => S.list[x.id]?.status === k).length]);
  const inLists = counts.reduce((n, [, v]) => n + v, 0);
  view.innerHTML = `<div class="coll-head"><div class="covers">${c.items.slice(0, 4).map(x => `<img src="${img(x.poster)}" alt="">`).join('')}</div>
      <div><h1 class="page-title" style="margin-bottom:6px">${esc(c.name)}</h1>
        <div class="muted">Создана ${fmtDate(c.created)}${c.updated && c.updated !== c.created ? ' · ред. ' + fmtWhen(c.updated) : ''} · ${plural(c.items.length, 'тайтл', 'тайтла', 'тайтлов')}</div>
        ${c.desc ? `<p class="desc">${esc(c.desc)}</p>` : ''}
        <div class="actions"><a class="btn" href="#/collection/${c.id}/edit">✎ Редактировать</a><button class="btn" id="rnd" ${c.items.length ? '' : 'disabled'}>🔀 Открыть случайный</button>
          <button class="btn" id="cp">⧉ Скопировать список</button><button class="btn" id="del">🗑 Удалить</button></div></div></div>
    ${c.items.length ? `<div class="people" style="margin-bottom:22px"><div class="muted" style="margin-bottom:8px">Из них в твоих списках: <b style="color:var(--text)">${inLists}</b></div>
      <div class="pbar">${counts.map(([k, n]) => `<i style="width:${n / c.items.length * 100}%;background:${LIST_COLOR[k]}"></i>`).join('')}</div>
      <div class="plegend">${counts.map(([k, n]) => `<span style="--c:${LIST_COLOR[k]}">${LIST_NAME[k]}: <b>${n}</b></span>`).join('')}</div></div>
      <div class="${gridClass()}">${c.items.map(x => item(x)).join('')}</div>`
      : emptyHtml('▣', 'Коллекция пустая', 'Нажми «Редактировать», чтобы добавить тайтлы.')}`;
  $('#rnd').onclick = () => go('#/anime/' + shuffle(c.items).id);
  $('#cp').onclick = () => copy(`${c.name}\n\n` + c.items.map((x, i) => `${i + 1}. ${title(x)}${x.year ? ' (' + x.year + ')' : ''}`).join('\n'), 'Список скопирован');
  $('#del').onclick = async () => { if (await confirmBox(`Удалить коллекцию «${esc(c.name)}»?`, 'Удалить')) { S.collections = S.collections.filter(x => x !== c); save(); go('#/collections'); } };
}
function pageCollectionEdit(view, q, [cid]) {
  const isNew = cid === 'new';
  const orig = S.collections.find(x => x.id === cid);
  if (!isNew && !orig) { go('#/collections'); return; }
  const c = isNew ? { id: uid(), name: '', desc: '', items: [], created: Date.now() } : structuredClone(orig);
  const draw = () => {
    view.innerHTML = `<div style="display:flex;align-items:center;gap:10px;max-width:760px"><h1 class="page-title" style="margin:0;flex:1">${isNew ? 'Создание коллекции' : 'Редактирование'}</h1>
        <button class="btn" id="cancel">Отмена</button><button class="btn primary" id="ok">✓ Сохранить</button></div>
      <div style="max-width:760px;display:grid;gap:12px;margin-top:18px">
        <div><input class="input" id="cn" style="width:100%" maxlength="60" placeholder="Название коллекции" value="${esc(c.name)}"><div class="muted" style="font-size:12px;margin-top:4px"><span id="cnl">${c.name.length}</span>/60</div><div class="field-err" id="cne" hidden>Придумай название</div></div>
        <div><textarea class="input" id="cd" rows="3" maxlength="1000" placeholder="Описание">${esc(c.desc)}</textarea><div class="muted" style="font-size:12px"><span id="cdl">${c.desc.length}</span>/1000</div></div>
        <div style="display:flex;align-items:center;gap:10px"><b style="flex:1">Тайтлы: ${c.items.length}</b><button class="btn" id="add">＋ Добавить тайтл</button></div>
        <div class="drag-list" id="dl">${c.items.map((x, i) => `<div class="drag-item" draggable="true" data-i="${i}"><span class="hd" title="Перетащи, чтобы поменять порядок">⋮⋮</span><img src="${img(x.poster)}" alt=""><span class="t">${esc(title(x))}</span><span class="muted">${x.year || ''}</span><button class="btn sm" data-rm="${i}">✕</button></div>`).join('') || '<div class="muted">Пока пусто</div>'}</div>
      </div>`;
    $('#cn').oninput = e => { c.name = e.target.value; $('#cnl').textContent = c.name.length; };
    $('#cd').oninput = e => { c.desc = e.target.value; $('#cdl').textContent = c.desc.length; };
    $('#cancel').onclick = () => goBack();
    $('#ok').onclick = () => {
      if (!c.name.trim()) { $('#cne').hidden = false; $('#cn').focus(); return; }
      c.name = c.name.trim();
      c.updated = Date.now();
      if (isNew) S.collections.unshift(c); else Object.assign(orig, c);
      save();
      go('#/collection/' + c.id);
    };
    $('#add').onclick = async () => {
      const a = await animeSearchDialog('Добавить тайтл в коллекцию');
      if (a && !c.items.some(x => x.id === a.id)) c.items.push(a);
      draw();
    };
    $$('[data-rm]', view).forEach(b => b.onclick = () => { c.items.splice(+b.dataset.rm, 1); draw(); });
    // перетаскивание для смены порядка
    let from = null;
    $$('.drag-item', view).forEach(el => {
      el.ondragstart = () => { from = +el.dataset.i; };
      el.ondragover = e => { e.preventDefault(); el.classList.add('over'); };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = e => { e.preventDefault(); const to = +el.dataset.i; if (from != null && from !== to) { const [m] = c.items.splice(from, 1); c.items.splice(to, 0, m); } draw(); };
    });
  };
  draw();
}
