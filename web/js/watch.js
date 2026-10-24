'use strict';
// Animax — серии, онлайн-источники, выбор озвучки, ссылки на видеопотоки.

// ================= Серии тайтла =================
// Серия может «играть» из файла в медиатеке или из сохранённой ссылки на поток.
// ================= Онлайн-источники (AniLiberty, Kodik) =================
// Каталог озвучек и серий берётся у источников через сервер (как в Anixart).
// Выбор озвучки запоминается («запоминать вариант и источник») в S.onlineDubs.
const onlineDubsCache = new Map(); // animeId -> { at, p } — p: промис со списком озвучек

// Первый поиск озвучек тайтла занимает несколько секунд, поэтому страница тайтла запускает его заранее,
// а одновременные запросы (страница серий, проверка подписок) ждут один и тот же ответ.
function onlineDubs(a) {
  const hit = onlineDubsCache.get(+a.id);
  if (hit && Date.now() - hit.at < 300000) return hit.p;
  const p = fetch('/api/online?p=' + a.id).then(r => r.json()).then(r => (r && r.dubs) || []).catch(() => null);
  onlineDubsCache.set(+a.id, { at: Date.now(), p: p.then(d => d || []) });
  p.then(d => { if (!d) onlineDubsCache.delete(+a.id); });  // не было связи — в следующий раз спросим снова
  return onlineDubsCache.get(+a.id).p;
}
const dubsReady = id => !!onlineDubsCache.get(+id);

// ================= популярность озвучек =================
// Порядок по образцу Anixart: сначала известные студии (по популярности),
// затем остальные — их расставляем по количеству серий (больше эпизодов = выше).
const onlineHref = (animeId, dubKey, ep) =>
  `#/watch?o=${animeId}&d=${encodeURIComponent(dubKey)}&e=${ep}`;
const DUB_RANK = new Map(Object.entries({
  // 1..30 — список пользователя
  'дублированный': 1, 'дубляж': 1,
  'anilibria': 2, 'анилибрия': 2,
  'aniliberty': 2, 'анилиберти': 2,
  'animevost': 4, 'анимевост': 4,
  'anidub': 5, 'анидуб': 5,
  'субтитры': 6, // «Субтитры», «Субтитры | CR» и любые *субтитры*
  'onwave': 7, 'онвейв': 7,
  'dreamcast': 8, 'дримкаст': 8,
  'реанимедиа': 9, 'reanimedia': 9,
  'fumodub': 10, 'фумодаб': 10,
  'jamclub': 11, 'джамклаб': 11,
  'animaunt': 12,
  'свдубль': 13, 'svdubl': 13, 'свдубляж': 13,
  'sovetromantica': 14, 'советромантики': 14,
  'shiza': 15, 'шиза': 15,
  'animedia': 16,
  'onibaku': 17, 'онибаку': 17,
  'anistar': 18, 'анистар': 18,
  'кладбищетоповых': 19,
  'anijoy': 20, 'аниджой': 20,
  'nmt': 21, 'нмт': 21,
  'forcemedia': 23, 'форсмедиа': 23,
  'aniplague': 24, 'аниплег': 24,
  'anibaza': 25, 'анибаза': 25,
  'lostlife': 26,
  'foxwave': 27, 'фоксвейв': 27,
  'anilot': 28, 'анилот': 28,
  'nextvoice': 29, 'некствойс': 29,
  'anitime': 30, 'анитайм': 30,
  // добавил от себя — тоже часто встречаются (31+)
  'studioband': 31, 'студиобенд': 31,
  'kansai': 32, 'кансай': 32,
  'amazingdubbing': 33, 'амейзинг': 33,
  'animego': 34,
  'crunchyroll': 35,
  'wakanim': 36,
  'wowandubs': 37, 'вован': 37
}));
const dubNorm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const dubRank = label => {
  const n = dubNorm(label);
  for (const [k, r] of DUB_RANK) if (n.startsWith(k)) return r;
  return 999;
};
// «AniLiberty · AniLiberty» не показываем дважды
const dubName = d => d && d.src && d.src !== d.label ? `${d.src} · ${d.label}` : (d?.label || d?.src || '');
// Та же нормализация имени студии, что и на сервере (sources.py): «AniDUB Online 18+» → «anidub»
const DUB_QUAL = /(online|онлайн|site|сайт|studio|студия|project|проект|tv|тв|hd|ru|old|старая|старое|official|официальный|channel|канал|subtitles|сабы|субтитры|plus|плюс|kodik|libria|cr|18)$/;
function dubKey(label) {
  let s = String(label || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]/g, '');
  let changed = true;
  while (changed) {
    changed = false;
    const m = s.match(DUB_QUAL);
    if (m && s.length - m[0].length >= 4) { s = s.slice(0, -m[0].length); changed = true; }
  }
  return s.startsWith('aniliberty') ? 'anilibria' + s.slice(10) : s;
}

async function sourcesFor(s, dubKey = null) {
  const files = await libraryFiles().catch(() => []);
  const mine = files.filter(f => S.library.links[f.dir]?.id === s.id);
  const byEp = new Map();
  const loose = [];
  mine.forEach(f => {
    const n = epNum(f.name);
    if (n == null) loose.push(f);
    else (byEp.get(n) || byEp.set(n, []).get(n)).push({ type: 'file', f, key: f.path, href: '#/watch?f=' + encodeURIComponent(f.path) });
  });
  S.streams.filter(x => x.anime?.id === s.id).forEach(x => {
    if (x.ep == null) loose.push({ stream: x });
    else (byEp.get(x.ep) || byEp.set(x.ep, []).get(x.ep)).push({ type: 'stream', x, key: x.url, href: '#/watch?s=' + x.id });
  });
  if (dubKey) {
    const dubs = await onlineDubs(s);
    const dub = dubs.find(x => x.key === dubKey);
    if (dub) for (let n = 1; n <= (dub.count || 0); n++)
      (byEp.get(n) || byEp.set(n, []).get(n)).push({ type: 'online', dub, key: `o:${s.id}:${dubKey}:${n}`, href: onlineHref(s.id, dubKey, n) });
  }
  return { byEp, loose, files: mine, dirs: [...new Set(files.map(f => f.dir))] };
}

async function pageEpisodes(view, q, [id], alive) {
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  const a = await loadAnime(id);
  if (!alive()) return;
  if (['music', 'pv', 'cm'].includes(a.kind)) { location.replace(`#/anime/${id}/watch`); return; }
  const s = snap(a);
  const marks = marksOf(s.id);
  if (!dubsReady(s.id)) slowLoading(view, 'Ищу онлайн-озвучки: Anixart, AniLiberty, Kodik…', alive);
  const dubs = await onlineDubs(s);
  if (!alive()) return;
  const dubSel = S.onlineDubs[s.id] && dubs.some(x => x.key === S.onlineDubs[s.id]) ? S.onlineDubs[s.id] : '';
  // Открытие сразу: если озвучка ещё не выбрана, серии строятся по первой доступной
  const actdub = dubSel || (dubs[0] && dubs[0].key) || '';
  const src = await sourcesFor(s, actdub);
  if (!alive()) return;
  const desc = q.get('sort') === 'desc';
  const only = q.get('only') || 'all';
  const maxSrc = Math.max(0, ...src.byEp.keys());
  const total = Math.max(a.episodes || 0, a.status === 'ongoing' ? a.episodesAired : 0, maxSrc, a.status === 'released' && !a.episodes ? 1 : 0);
  let nums = Array.from({ length: total }, (_, i) => i + 1);
  if (a.status === 'ongoing') nums = nums.filter(n => n <= Math.max(a.episodesAired, maxSrc));
  if (only === 'src') nums = nums.filter(n => src.byEp.has(n));
  if (only === 'new') nums = nums.filter(n => !marks[n]);
  if (desc) nums.reverse();
  const base = `#/anime/${id}/episodes`;
  const qs = (o = {}) => base + '?' + new URLSearchParams({
    ...(desc ? { sort: 'desc' } : {}), ...(only !== 'all' ? { only } : {}),
    ...(actdub && !('dub' in o) ? { dub: actdub } : {}), ...o,
  }).toString().replace(/\bdub=&/, '').replace(/[?&]dub=$/, '');
  const dubHref = k => base + '?' + new URLSearchParams({ ...(desc ? { sort: 'desc' } : {}), ...(only !== 'all' ? { only } : {}), ...(k ? { dub: k } : {}) }).toString();

  view.innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px"><a href="#/anime/${id}"><img src="${img(s.poster)}" style="width:60px;border-radius:8px" alt=""></a>
      <div style="flex:1"><h1 class="page-title" style="margin:0">${esc(title(a))}</h1><div class="muted">Выбери серию · просмотрено ${Object.keys(marks).length} из ${a.episodes || a.episodesAired || '?'}</div></div>
      <button class="icon-btn" id="ep-more" title="Ещё">⋮</button></div>
    ${hint('episodes', 'Кружок слева — отметка «просмотрено». Серии играют из твоих файлов (привяжи папку ниже), из сохранённых ссылок или онлайн из озвучек ниже (AniLiberty, Kodik). Если у серии нет источника, её всё равно можно отметить.')}
    <div class="ep-tools">
      <div class="tabs" style="margin:0"><a class="tab ${only === 'all' ? 'on' : ''}" href="${qs({ only: '' }).replace('only=&', '').replace(/[?&]only=$/, '')}">Все</a>
        <a class="tab ${only === 'src' ? 'on' : ''}" href="${qs({ only: 'src' })}">С источником</a><a class="tab ${only === 'new' ? 'on' : ''}" href="${qs({ only: 'new' })}">Непросмотренные</a></div>
      <a class="btn sm" href="${desc ? qs({ sort: '' }).replace(/sort=&?/, '') : qs({ sort: 'desc' })}">${desc ? '↓ С конца' : '↑ С начала'}</a>
      <button class="btn sm" id="add-link">🔗 Добавить ссылку на серию</button>
    </div>
    ${dubs.length ? `<div class="sec-head" style="margin:16px 0 8px"><h2>Онлайн-озвучки</h2><span class="sub">${dubs.length}</span></div>
      <div class="tabs" style="margin-bottom:6px;flex-wrap:wrap">${dubs.map(d => `<a class="tab ${d.key === dubSel ? 'on' : ''}" data-dub="${esc(d.key === dubSel ? '' : d.key)}" href="${dubHref(d.key === dubSel ? '' : d.key)}">${esc(dubName(d))}${d.type === 'subtitles' ? ' · субтитры' : ''} (${d.count})</a>`).join('')}</div>
      ${dubs[0] && !dubSel ? `<div class="muted" style="margin:0 0 14px">Серии открываются с первой озвучки (${esc(dubs[0].src)} · ${esc(dubs[0].label)}) — кликни любую. Выбор другой озвучки запоминается.</div>` : ''}` : ''}
    <div class="eps-list">${nums.map(n => episodeItem(n, src.byEp.get(n) || [], marks[n], a)).join('') || emptyHtml('📺', a.status === 'anons' ? 'Тайтл ещё не вышел' : 'Серий нет', a.status === 'anons' && a.airedOn?.date ? 'Выход: ' + fmtDate(a.airedOn.date) : '')}</div>
    ${src.loose.length ? `<div class="section"><h3>Файлы без номера серии</h3><div class="eps-list">${src.loose.map(x => x.stream ? streamRow(x.stream) : episodeRow(x)).join('')}</div></div>` : ''}
    <div class="section"><h3>Папки с сериями</h3><div class="list" id="dirs"></div></div>`;

  const dirsBox = $('#dirs');
  const linked = Object.keys(S.library.links).filter(d => S.library.links[d].id === s.id);
  dirsBox.innerHTML = linked.map(d => `<div class="folder"><span class="p">📁 ${esc(d)}</span><button class="btn sm" data-unlink="${esc(d)}">Отвязать</button></div>`).join('')
    + src.dirs.filter(d => !linked.includes(d)).map(d => `<div class="folder"><span class="p muted" title="${esc(d)}">📁 ${esc(d)}</span>${S.library.links[d] ? `<span class="muted">→ ${esc(title(S.library.links[d]))}</span>` : ''}<button class="btn sm" data-link="${esc(d)}">Привязать</button></div>`).join('')
    + (src.dirs.length ? '' : `<div class="muted">В медиатеке пока нет папок. <a class="linkbtn" href="#/library">Добавить папку</a></div>`);
  $$('[data-link]', dirsBox).forEach(b => b.onclick = () => { S.library.links[b.dataset.link] = s; save(); toast('Папка привязана'); route(); });
  $$('[data-unlink]', dirsBox).forEach(b => b.onclick = () => { delete S.library.links[b.dataset.unlink]; save(); route(); });
  $('#add-link').onclick = () => streamDialog({ anime: s, ep: nums.find(n => !marks[n]) || null });
  $$('.ep', view).forEach(el => {
    el.onclick = e => {
      if (e.target.closest('.chk')) {
        const n = +el.dataset.n;
        setMark(s, n, !marksOf(s.id)[n]);
        route();
        return;
      }
      if (el.dataset.href) watchOpen(el.dataset.href);
      else if (el.dataset.play) watchOpen('#/watch?f=' + encodeURIComponent(el.dataset.play));
      else toast('У этой серии нет источника — привяжи папку или добавь ссылку');
    };
  });
  $('#ep-more').onclick = () => {
    const r = $('#ep-more').getBoundingClientRect();
    const items = [
      ['✓', 'Все серии просмотрены', () => { for (let n = 1; n <= (a.episodes || a.episodesAired); n++) if (!marksOf(s.id)[n]) setMark(s, n, true); route(); }],
      ['✕', 'Удалить все отметки', async () => { if (await confirmBox('Удалить все отметки о просмотре?', 'Удалить')) { delete S.marks[s.id]; syncEp(s); route(); } }],
      ['📁', 'Медиатека', () => go('#/library')],
      ['🌐', 'Где смотреть официально', () => watchWhereDialog(s, (a.externalLinks || []).filter(l => LEGAL_LINKS[l.kind]))],
    ];
    ctx.innerHTML = items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${t}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false;
    ctx.style.left = (r.right - 250) + 'px';
    ctx.style.top = (r.bottom + 6) + 'px';
  };
  // выбор онлайн-озвучки (запоминается, как «Запоминать вариант и источник» в Anixart)
  $$('[data-dub]', view).forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.dub;
    if (k) S.onlineDubs[s.id] = k;
    else delete S.onlineDubs[s.id];
    save();
  }));
}
// ================= Просмотр: источник -> озвучка -> серия =================
// Мастер просмотра в духе Anixart: сначала источник (файлы/ссылки/онлайн),
// затем озвучка выбранного онлайн-источника, затем список серий.
async function pagePlay(view, q, [id], alive) {
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  const a = await loadAnime(id);
  if (!alive()) return;
  const s = snap(a);
  const marks = marksOf(s.id);
  const src0 = await sourcesFor(s); // локальные файлы и ссылки (без онлайн)
  // Клипы, трейлеры и реклама — не сериалы: онлайн-озвучек у них не бывает,
  // не ждём медленные источники и сразу показываем официальный ролик.
  const clip = ['music', 'pv', 'cm'].includes(a.kind);
  if (!clip && !dubsReady(s.id)) slowLoading(view, 'Ищу онлайн-озвучки: Anixart, AniLiberty, Kodik…', alive);
  const dubs = clip ? [] : await onlineDubs(s);
  if (!alive()) return;

  // подсчёт локальных источников по сериям
  let nFiles = 0, nLinks = 0;
  for (const [, arr] of src0.byEp) {
    if (arr.some(x => x.type === 'file')) nFiles++;
    if (arr.some(x => x.type === 'stream')) nLinks++;
  }
  nFiles += src0.loose.filter(x => !x.stream).length;
  nLinks += src0.loose.filter(x => x.stream).length;

  // шаг 1 — озвучка (по названию), шаг 2 — источник (если у озвучки их несколько).
  // одна и та же озвучка бывает в нескольких источниках — группируем по label
  const dubGroups = [];
  const seenGrp = new Map();
  for (const d of dubs) {
    const label = (d.label || '').trim();
    const lk = label.toLowerCase();
    let g = seenGrp.get(lk);
    if (!g) { g = { label, entries: [] }; seenGrp.set(lk, g); dubGroups.push(g); }
    g.entries.push(d);
  }
  dubGroups.sort((x, y) => dubRank(x.label) - dubRank(y.label)
    || Math.max(...y.entries.map(e => e.count || 1)) - Math.max(...x.entries.map(e => e.count || 1))
    || x.label.localeCompare(y.label, 'ru'));

  const rememberedKey = (S.onlineDubs || {})[s.id];
  const rememberedGroup = rememberedKey ? dubGroups.find(g => g.entries.some(e => e.key === rememberedKey)) : null;
  const rememberedSrc = (S.watchSrc ||= {})[s.id];
  // reset=1 — явное «Выбрать другую озвучку»: запомненный выбор игнорируем
  const reset = q.get('reset') === '1';
  const modeSel = reset ? '' : ['local', 'links'].includes(q.get('mode')) ? q.get('mode')
    : ['local', 'links'].includes(rememberedSrc || '') ? rememberedSrc : '';

  // выбор озвучки и источника; одна озвучка в одном источнике — сразу к сериям
  let gSel = '', keySel = null, singleAuto = false;
  if (!reset && q.get('g') && dubGroups.some(g => g.label === q.get('g'))) {
    gSel = q.get('g');
  } else if (!reset && rememberedGroup && !modeSel) {
    gSel = rememberedGroup.label; // запомненная озвучка
  } else if (!modeSel && dubGroups.length === 1 && dubGroups[0].entries.length === 1) {
    gSel = dubGroups[0].label; // одна озвучка в одном источнике — без выбора
    singleAuto = true;
  }
  const groupObj = gSel ? (dubGroups.find(g => g.label === gSel) || null) : null;
  if (groupObj) {
    keySel = singleAuto && groupObj.entries[0]
      || groupObj.entries.find(e => e.key === rememberedKey)
      || groupObj.entries.find(e => e.key === q.get('s'))
      || (groupObj.entries.length === 1 ? groupObj.entries[0] : null);
  }

  const base = `#/anime/${id}/watch`;
  const grpHref = g => base + '?g=' + encodeURIComponent(g);
  const srcHref = (g, k) => base + '?g=' + encodeURIComponent(g) + '&s=' + encodeURIComponent(k);
  const srcIcon = n => ({ al: '📺', kdk: '📺', anx: '📡' }[n] || '📡');

  let body = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:16px"><a href="#/anime/${id}"><img src="${img(s.poster)}" style="width:60px;border-radius:8px" alt=""></a>
      <div style="flex:1"><h1 class="page-title" style="margin:0">${esc(title(a))}</h1><div class="muted">${clip
        ? `${esc({ music: 'Клип', pv: 'Трейлер', cm: 'Рекламный ролик' }[a.kind] || 'Клип')}${a.airedOn?.year ? ' · ' + a.airedOn.year : ''} · <a class="linkbtn" href="#/anime/${id}">к тайтлу</a>`
        : `Просмотрено ${Object.keys(marks).length} из ${a.episodes || a.episodesAired || '?'} · <a class="linkbtn" href="#/anime/${id}/episodes">страница серий</a>`}</div></div></div>
    ${clip ? '' : hint('play', 'Шаг 1 — выбери озвучку. Шаг 2 — источник (если у озвучки их несколько). Шаг 3 — серию. Выбор запоминается.')}`;

  if (!dubs.length && !nFiles && !nLinks) {
    const vids = (a.videos || []).filter(v => youtubeId(v.playerUrl) || youtubeId(v.url));
    // официальный ролик может быть только в externalLinks (у клипов videos часто пуст)
    const extYt = (a.externalLinks || [])
      .filter(l => l.kind === 'youtube' || l.kind === 'youtube_channel')
      .map(l => l.url);
    const vidId = vids[0] ? (youtubeId(vids[0].playerUrl) || youtubeId(vids[0].url)) : null;
    const officialYt = extYt[0] || (vidId ? ytWatch(vidId) : '');
    const ytSearch = 'https://www.youtube.com/results?search_query=' + encodeURIComponent([a.name, clip && a.kind === 'music' ? 'official music video' : ''].filter(Boolean).join(' '));
    body += emptyHtml(clip ? '🎵' : '📺', clip ? `Это ${{ music: 'клип', pv: 'трейлер', cm: 'рекламный ролик' }[a.kind]}, а не сериал` : 'Источников пока нет',
      (clip ? 'Озвучек у таких роликов не бывает — их выкладывают официально, чаще всего на YouTube.'
        : 'Привяжи папку с файлами, добавь ссылку или зайди позже — озвучки подтягиваются онлайн.')
      + `<div class="actions" style="justify-content:center;margin-top:16px">
          ${clip && officialYt ? `<a class="btn primary" href="${esc(officialYt)}" target="_blank" rel="noopener">▶ Смотреть на YouTube ↗</a>` : ''}
          ${vids.length ? `<a class="btn ${clip && officialYt ? '' : 'primary'}" href="#/anime/${id}/videos">▶ Официальные ролики (${vids.length})</a>` : ''}
          ${clip ? `<a class="btn ${officialYt ? '' : 'primary'}" href="${esc(ytSearch)}" target="_blank" rel="noopener">▶ Найти на YouTube ↗</a>` : ''}
          <button class="btn" id="where">🌐 Где смотреть официально</button></div>`);
    view.innerHTML = body;
    $('#where', view).onclick = () => watchWhereDialog(a, (a.externalLinks || []).filter(l => LEGAL_LINKS[l.kind]));
    return;
  }

  const seriesHtml = sel => {
    let h = '';
    for (let n = 1; n <= sel.count; n++) {
      const p = S.progress[`o:${s.id}:${sel.key}:${n}`];
      const mark = marks[n];
      h += `<div class="ep ${mark ? 'done' : ''}" data-n="${n}" data-href="${onlineHref(s.id, sel.key, n)}">
        <button class="chk" title="${mark ? 'Снять отметку' : 'Отметить просмотренной'}">✓</button><div class="n">${n}</div>
        <div class="b"><div class="t">Серия ${n}<span class="tag">${esc(dubName(sel).toUpperCase())}</span></div>
        <div class="m">${p?.done || mark ? 'Просмотрено целиком' : p?.t > 5 ? 'Просмотрено до ' + fmtTime(p.t) : 'Нажми, чтобы смотреть онлайн'}</div>
        ${p?.d && !p.done && !mark ? `<div class="pr"><i style="width:${Math.min(100, p.t / p.d * 100)}%"></i></div>` : ''}</div><span class="muted">▶</span></div>`;
    }
    return h;
  };

  if (keySel) { // выбрана конкретная озвучка — запоминаем её (последний выбор главнее локальных)
    S.onlineDubs[s.id] = keySel.key;
    delete S.watchSrc[s.id];
    save();
  }

  if (modeSel === 'local') {
    body += `<div class="sec-head"><h2>Серия</h2><span class="sub">${nFiles}</span></div>`;
    const nums = [...src0.byEp.keys()].filter(n => src0.byEp.get(n).some(x => x.type === 'file')).sort((x, y) => x - y);
    body += '<div class="eps-list">';
    for (const n of nums) {
      const entries = src0.byEp.get(n).filter(x => x.type === 'file');
      const firstFile = entries[0].f;
      const p = S.progress[entries[0].key];
      const mark = marks[n];
      body += `<div class="ep ${mark ? 'done' : ''}" data-n="${n}" data-href="${esc(entries[0].href)}">
        <button class="chk" title="${mark ? 'Снять отметку' : 'Отметить просмотренной'}">✓</button><div class="n">${n}</div>
        <div class="b"><div class="t">Серия ${n}${entries.map(x => `<span class="tag">${x.f.ext.slice(1).toUpperCase()}</span>`).join('')}</div>
        <div class="m">${esc(firstFile.name)}${p?.done || mark ? ' · просмотрено' : p?.t > 5 ? ' · до ' + fmtTime(p.t) : ''}</div></div><span class="muted">▶</span></div>`;
    }
    for (const x of src0.loose.filter(x => !x.stream)) {
      const f = x.f;
      body += `<div class="ep" data-href="${esc(f.path ? '#/watch?f=' + encodeURIComponent(f.path) : '')}"><div class="n">📁</div>
        <div class="b"><div class="t">${esc(f.name)}<span class="tag">${f.ext.slice(1).toUpperCase()}</span></div><div class="m">Файл без номера серии</div></div><span class="muted">▶</span></div>`;
    }
    body += '</div>';
  } else if (modeSel === 'links') {
    const nums = [...src0.byEp.keys()].filter(n => src0.byEp.get(n).some(x => x.type === 'stream')).sort((x, y) => x - y);
    body += '<div class="eps-list">';
    for (const n of nums) {
      const entries = src0.byEp.get(n).filter(x => x.type === 'stream');
      for (const en of entries) {
        const x = en.x;
        const p = S.progress[x.url];
        const mark = marks[n];
        body += `<div class="ep ${mark ? 'done' : ''}" data-n="${n}" data-href="${esc(en.href)}"><div class="n">${n}</div>
          <div class="b"><div class="t">${esc(x.title || `Серия ${n}`)}<span class="tag">${esc((x.site || siteName(x.url)).toUpperCase())}</span></div>
          <div class="m">${p?.done || mark ? 'Просмотрено целиком' : p?.t > 5 ? 'Просмотрено до ' + fmtTime(p.t) : esc(x.url).slice(0, 60)}</div></div><span class="muted">▶</span></div>`;
      }
    }
    for (const loose of src0.loose.filter(x => x.stream)) {
      const x = loose.stream;
      body += streamRow(x);
    }
    body += '</div>';
  } else if (groupObj && keySel) {
    const subK = `${s.id}:${keySel.key}`;
    const subbed = (S.subsDub || {})[subK];
    body += `<div class="sec-head"><h2>3 · Серия</h2><span class="sub">${keySel.count} эп.</span></div>
      <div style="margin:0 0 12px"><button class="btn sm ${subbed ? '' : 'primary'}" id="dub-sub">${subbed ? `🔔 Не следить за «${esc(keySel.label)}»` : `🔔 Следить за «${esc(keySel.label)}»`}</button>${subbed ? '<span class="muted" style="margin-left:10px">Сообщим о новых сериях этой озвучки</span>' : '<span class="muted" style="margin-left:10px">Уведомим на рабочем столе, когда выйдет новая</span>'}</div>`;
    body += '<div class="eps-list">' + seriesHtml(keySel) + '</div>';
  } else if (groupObj) {
    // шаг 2 — источник выбранной озвучки
    body += `<div class="sec-head"><h2>2 · Источник</h2><span class="sub">${groupObj.entries.length}</span></div>
      <div class="eps-list">
        ${groupObj.entries.map(d => `<div class="ep" data-pick="${esc(d.key)}"><div class="n">${srcIcon(d.key.split(':')[0])}</div><div class="b"><div class="t">${esc(d.src)}</div><div class="m">${d.count} ${plural(d.count, 'серия', 'серии', 'серий')}${d.type === 'subtitles' ? ' · субтитры' : ''}</div></div><span class="muted">▶</span></div>`).join('')}
      </div>`;
  } else {
    // шаг 1 — список озвучек
    if (dubGroups.length) body += `<div class="sec-head"><h2>1 · Озвучка</h2><span class="sub">${dubs.length}</span></div>
      <div class="tabs" style="margin-bottom:14px;flex-wrap:wrap">${dubGroups.map(g => {
        const cnt = Math.max(...g.entries.map(x => x.count));
        const subs = g.entries.every(x => x.type === 'subtitles') ? ' · субтитры' : '';
        return `<a class="tab" data-grp="${esc(g.label)}" href="${grpHref(g.label)}">${esc(g.label)} (${cnt})${subs}${g.entries.length > 1 ? ` · ${g.entries.length} ист.` : ''}</a>`;
      }).join('')}</div>`;
    if (nFiles || nLinks) body += `<div class="sec-head" ${dubGroups.length ? 'style="margin-top:14px"' : ''}><h2>${dubGroups.length ? 'Без озвучки' : 'Серия'}</h2><span class="sub">${(nFiles ? 1 : 0) + (nLinks ? 1 : 0)}</span></div>
      <div class="eps-list">
        ${nFiles ? `<div class="ep" data-pick="local"><div class="n">💻</div><div class="b"><div class="t">Локальные файлы</div><div class="m">${plural(nFiles, 'серия', 'серии', 'серий')} в медиатеке</div></div><span class="muted">▶</span></div>` : ''}
        ${nLinks ? `<div class="ep" data-pick="links"><div class="n">🔗</div><div class="b"><div class="t">Сохранённые ссылки</div><div class="m">${plural(nLinks, 'серия', 'серии', 'серий')}</div></div><span class="muted">▶</span></div>` : ''}
      </div>`;
  }
  // назад по цепочке: серия → шаг 1, шаг 2 → шаг 1, шаг 1 → тайтл
  if ((modeSel || (groupObj && keySel && !singleAuto) || (groupObj && !keySel))) body += `<div style="margin-top:18px"><a class="linkbtn" href="${base}?reset=1">← Выбрать другую озвучку</a></div>`;
  else body += `<div style="margin-top:18px"><a class="linkbtn" href="#/anime/${id}">← К тайтлу</a></div>`;
  view.innerHTML = body;

  $$('[data-pick]', view).forEach(el => el.onclick = e => {
    if (e.target.closest('.chk')) return;
    const k = el.dataset.pick;
    if (k === 'local' || k === 'links') {
      S.watchSrc[s.id] = k;
      delete S.onlineDubs[s.id];
      save();
      go(base + '?mode=' + k);
      return;
    }
    // выбрали источник конкретной озвучки — запоминаем её
    S.onlineDubs[s.id] = k;
    delete S.watchSrc[s.id];
    save();
    go(srcHref(gSel, k));
  });
  $$('.ep[data-href]', view).forEach(el => el.onclick = e => {
    if (e.target.closest('.chk')) {
      setMark(s, +el.dataset.n, !marksOf(s.id)[+el.dataset.n]);
      route();
      return;
    }
    watchOpen(el.dataset.href);
  });
  // подписка на выбранную озвучку: сообщать о новых сериях именно её источника
  const dubSubBtn = $('#dub-sub', view);
  if (dubSubBtn && keySel) dubSubBtn.onclick = () => {
    const subK = `${s.id}:${keySel.key}`;
    if (S.subsDub[subK]) {
      delete S.subsDub[subK];
      S.subsDel['subsDub:' + subK] = Date.now();
      toast(`Отписались: «${keySel.label}»`);
    } else {
      S.subsDub[subK] = {
        id: s.id, anime: s, dub: keySel.key, dubLabel: keySel.label,
        ep: keySel.count || 0, at: Date.now(),
      };
      delete S.subsDel['subsDub:' + subK];
      toast(`Следим за «${keySel.label}» — о новых сериях сообщим`);
    }
    save();
    route();
  };
}

function episodeItem(n, sources, mark, a) {
  const first = sources[0];
  const p = first ? S.progress[first.key] : null;
  const srcName = first ? (first.type === 'file' ? first.f.name
    : first.type === 'online' ? `онлайн: ${dubName(first.dub)}`
    : first.x.title || first.x.url) : null;
  const sub = p?.done || mark ? 'Просмотрено целиком' : p?.t > 5 ? 'Просмотрено до ' + fmtTime(p.t) : srcName || 'Нет источника';
  const tags = sources.map(x => {
    if (x.type === 'file') return `<span class="tag">${x.f.ext.slice(1).toUpperCase()}</span>${x.f.sub ? '<span class="tag">СУБ</span>' : ''}`;
    if (x.type === 'online') return `<span class="tag">${esc(dubName(x.dub).toUpperCase())}</span>`;
    return `<span class="tag">${streamMode(x.x) === 'embed' ? esc(x.x.site || siteName(x.x.url)).toUpperCase() : 'ССЫЛКА'}</span>`;
  }).join('');
  return `<div class="ep ${mark ? 'done' : ''} ${first ? '' : 'nofile'}" data-n="${n}" ${first ? `data-href="${esc(first.href)}"` : ''}>
    <button class="chk" title="${mark ? 'Снять отметку' : 'Отметить просмотренной'}">✓</button><div class="n">${n}</div>
    <div class="b"><div class="t">Серия ${n}${tags}</div><div class="m">${esc(sub)}</div>
    ${p?.d && !p.done && !mark ? `<div class="pr"><i style="width:${Math.min(100, p.t / p.d * 100)}%"></i></div>` : ''}</div>${first ? '<span class="muted">▶</span>' : ''}</div>`;
}
function streamRow(x) {
  const p = S.progress[x.url];
  return `<div class="ep" data-href="#/watch?s=${x.id}"><div class="n">🔗</div><div class="b"><div class="t">${esc(x.title || x.url)}</div>
    <div class="m">${p?.done ? 'Просмотрено целиком' : p?.t > 5 ? 'Просмотрено до ' + fmtTime(p.t) : esc(x.url)}</div></div></div>`;
}

// ================= Ссылки на видеопотоки =================
// Ссылка играет либо в нашем плеере (файл / HLS-поток), либо во встроенном плеере сайта (iframe).
const VIDEO_FILE = /\.(mp4|webm|m4v|mov|mkv|m3u8)(\?|#|$)/i;
const SITE_NAMES = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'rutube.ru': 'RUTUBE', 'vk.com': 'VK Видео', 'vkvideo.ru': 'VK Видео', 'vk.ru': 'VK Видео', 'ok.ru': 'Одноклассники', 'my.mail.ru': 'Mail.ru', 'dzen.ru': 'Дзен' };
function siteName(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m)\./, '');
    return SITE_NAMES[h] || SITE_NAMES[h.split('.').slice(-2).join('.')] || h;
  } catch { return 'сайт'; }
}
const streamMode = x => x.mode && x.mode !== 'auto' ? x.mode : VIDEO_FILE.test(x.url) ? 'direct' : 'embed';
// Обычную ссылку на страницу ролика превращаем в ссылку для встраивания (если сайт это поддерживает)
function embedUrl(url) {
  const yt = youtubeId(url);
  if (yt) return `https://www.youtube.com/embed/${yt}?autoplay=1&rel=0`;
  let m;
  if ((m = url.match(/rutube\.ru\/video\/(?:private\/)?([0-9a-f]{32})/i))) return `https://rutube.ru/play/embed/${m[1]}`;
  if ((m = url.match(/(?:vk\.com|vkvideo\.ru|vk\.ru)\/(?:.*[?&]z=)?video(-?\d+)_(\d+)/i))) return `https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}&autoplay=1`;
  if ((m = url.match(/ok\.ru\/video\/(\d+)/i))) return `https://ok.ru/videoembed/${m[1]}?autoplay=1`;
  return url;
}
// Во встроенный плеер пускаем только внешние https-адреса — не локальную сеть и не сам Animax
function safeEmbed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/i.test(u.hostname);
  } catch { return false; }
}

function streamDialog({ anime = null, ep = null, url = '' } = {}) {
  let linked = anime;
  const b = modal(`<h3>Открыть ссылку на видео</h3>
    <p class="muted">Прямая ссылка на видео (<b>.mp4</b>, <b>.webm</b>, <b>.m3u8</b>) — например, со своего медиасервера — откроется в плеере Animax.
      Ссылка на страницу ролика RUTUBE, VK Видео, ОК… — во встроенном плеере сайта; ролики YouTube открываются на самом YouTube.</p>
    <input class="input" id="su" style="width:100%" placeholder="https://…" value="${esc(url)}">
    <select class="select" id="sm" style="width:100%;margin-top:10px">
      <option value="auto">Определить автоматически</option>
      <option value="direct">Видеофайл или HLS-поток — плеер Animax</option>
      <option value="embed">Страница или плеер сайта — встроить</option>
    </select>
    <div class="muted" id="sk" style="font-size:12px;margin-top:6px"></div>
    <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;margin-top:10px">
      <input class="input" id="st" placeholder="Название (необязательно)">
      <input class="input" id="se" type="number" min="1" placeholder="Серия" value="${ep ?? ''}"></div>
    <div class="folder" style="margin-top:10px"><span class="p" id="sa">${linked ? 'Тайтл: <b>' + esc(title(linked)) + '</b>' : '<span class="muted">Не привязано к тайтлу</span>'}</span><button class="btn sm" id="sl">${linked ? 'Изменить' : 'Привязать'}</button></div>
    <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn" data-save>Сохранить в серии</button><button class="btn primary" data-play>▶ Смотреть</button></div>`);
  $('#su', b).focus();
  const hintKind = () => {
    const u = $('#su', b).value.trim();
    if (!/^https?:\/\//i.test(u)) { $('#sk', b).textContent = ''; return; }
    const mode = streamMode({ url: u, mode: $('#sm', b).value });
    $('#sk', b).textContent = mode === 'direct' ? 'Будет играть в плеере Animax: запомнит место, отметит серию, горячие клавиши.'
      : `Будет встроен плеер сайта «${siteName(u)}». Место остановки запомнить не получится — серию можно отметить кнопкой.`;
  };
  $('#su', b).addEventListener('input', hintKind);
  $('#sm', b).onchange = hintKind;
  hintKind();
  $('#sl', b).onclick = async () => {
    const st = { u: $('#su', b).value, t: $('#st', b).value, e: $('#se', b).value };
    const picked = await animeSearchDialog('К какому аниме относится видео?');
    streamDialog({ anime: picked || linked, ep: st.e ? +st.e : null, url: st.u });
    if (st.t) $('#st').value = st.t;
  };
  const read = () => {
    const u = $('#su', b).value.trim();
    if (!/^https?:\/\//i.test(u)) { toast('Нужна ссылка, начинающаяся с http:// или https://'); return null; }
    const mode = streamMode({ url: u, mode: $('#sm', b).value });
    if (mode === 'embed' && !safeEmbed(embedUrl(u))) { toast('Встроить можно только внешнюю ссылку https://'); return null; }
    return { id: uid(), url: u, title: $('#st', b).value.trim(), ep: $('#se', b).value ? +$('#se', b).value : null, anime: linked ? snap(linked) : null, mode, site: mode === 'embed' ? siteName(u) : '', added: Date.now() };
  };
  b.querySelector('[data-c]').onclick = closeModal;
  b.querySelector('[data-save]').onclick = () => {
    const x = read();
    if (!x) return;
    S.streams = [x, ...S.streams.filter(y => !(y.url === x.url && y.anime?.id === x.anime?.id))];
    save();
    closeModal();
    toast('Ссылка сохранена' + (x.anime ? ' в серии тайтла' : ''));
    route();
  };
  b.querySelector('[data-play]').onclick = () => {
    const x = read();
    if (!x) return;
    S.streams = [x, ...S.streams.filter(y => y.url !== x.url)].slice(0, 500);
    save();
    closeModal();
    watchOpen('#/watch?s=' + x.id);
  };
}
function animeSearchDialog(head) {
  return new Promise(res => {
    const b = modal(`<h3>${head}</h3><input class="input" id="aq" style="width:100%" placeholder="Название аниме"><div class="pick-list" id="ar"></div>
      <div class="row-btns"><button class="btn" data-c>Отмена</button></div>`, '', () => res(null));
    const run = debounce(async t => {
      if (!t) return;
      try {
        const d = await gql(animes({ search: t, limit: 8 }));
        const list = d.animes.map(snap);
        $('#ar', b).innerHTML = list.map(a => `<div class="wide-card" data-id="${a.id}"><img src="${img(a.poster)}" alt=""><div class="wc-b"><div class="t">${esc(title(a))}</div><div class="m">${esc(a.name)} · ${esc(metaLine(a))}</div></div></div>`).join('') || '<div class="muted">Ничего не нашлось</div>';
        $$('[data-id]', b).forEach(el => el.onclick = () => { answerModal(); res(list.find(a => a.id === +el.dataset.id)); });
      } catch (err) { $('#ar', b).innerHTML = `<div class="muted">${esc(err.message)}</div>`; }
    }, 300);
    $('#aq', b).oninput = e => run(e.target.value.trim());
    $('#aq', b).focus();
    b.querySelector('[data-c]').onclick = () => { answerModal(); res(null); };
  });
}
