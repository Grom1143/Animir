'use strict';
// Animax — медиатека и встроенный плеер.

// ================= Медиатека =================
let libCache = null;
async function libraryFiles(force = false) {
  if (!libCache || force) libCache = await (await fetch('/api/library')).json();
  return libCache;
}
// Номер серии из имени файла: «[Group] Title - 05 [1080p]», «S01E05», «Серия 5», «05»…
function epNum(name) {
  const s = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ');
  const m = s.match(/(?:^|[^a-zа-я])(?:e|ep|episode|серия|эп)\s*(\d{1,4})/i)
    || s.match(/\s-\s*(\d{1,4})(?:v\d)?(?:\s|$)/i)
    || s.match(/(?:^|\D)(\d{1,4})(?:v\d)?\s*$/i);
  if (m) return +m[1];
  const all = [...s.matchAll(/(?:^|\D)(\d{1,4})(?!\d|p\b)/gi)].map(x => +x[1]).filter(n => n < 1900 || n > 2100);
  return all.length ? all[all.length - 1] : null;
}
function episodeRow(f) {
  const p = S.progress[f.path];
  const n = epNum(f.name);
  const pct = p?.d ? Math.min(100, p.t / p.d * 100) : 0;
  return `<div class="ep ${p?.done ? 'done' : ''}" data-play="${esc(f.path)}"><div class="n">${p?.done ? '✓' : n ?? '▶'}</div>
    <div class="b"><div class="t">${esc(f.name)}</div>
    <div class="m">${n != null ? `${n}-я серия · ` : ''}${f.ext.slice(1).toUpperCase()} · ${f.size >= 2 ** 30 ? (f.size / 2 ** 30).toFixed(1) + ' ГБ' : Math.max(1, Math.round(f.size / 2 ** 20)) + ' МБ'}${p?.d ? ` · ${p.done ? 'просмотрено целиком' : 'просмотрено до ' + fmtTime(p.t)}` : ''}${f.sub ? ' · есть субтитры' : ''}</div>
    ${pct && !p.done ? `<div class="pr"><i style="width:${pct}%"></i></div>` : ''}</div></div>`;
}
function bindEpisodeRows(root) {
  $$('[data-play]', root).forEach(el => el.onclick = () => watchOpen('#/watch?f=' + encodeURIComponent(el.dataset.play)));
  $$('[data-href]', root).forEach(el => {
    if (el.onclick) return;
    const h = el.dataset.href;
    el.onclick = () => h.startsWith('#/watch') ? watchOpen(h) : go(h);
  });
}
const folderTitle = dir => dir.split(/[\\/]/).filter(Boolean).pop();
const guessQuery = dir => folderTitle(dir).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ').replace(/\b(1080p|720p|480p|2160p|bdrip|webrip|web-dl|hevc|x264|x265|tv|season|сезон)\b/gi, ' ').replace(/\s+/g, ' ').trim();

async function pageLibrary(view, q, _, alive) {
  view.innerHTML = '<div class="loading">Сканирую папки…</div>';
  const files = await libraryFiles(true);
  if (!alive()) return;
  const groups = new Map();
  files.forEach(f => { if (!groups.has(f.dir)) groups.set(f.dir, []); groups.get(f.dir).push(f); });
  view.innerHTML = `<h1 class="page-title">Медиатека</h1>
    <p class="muted" style="max-width:780px;margin-top:-6px">Папки с сериями на этом компьютере или в сети (например, <code>\\\\NAS\\Аниме</code>) — видео играет прямо оттуда, копировать ничего не нужно. Есть домашний медиасервер? Жми 🔗 сверху и открывай поток по ссылке.</p>
    <div class="list" style="max-width:780px">${S.library.folders.map((f, i) => `<div class="folder"><span class="p">📁 ${esc(f)}</span><button class="btn sm" data-rmf="${i}">Убрать</button></div>`).join('')}</div>
    <div class="actions" style="margin-bottom:10px"><button class="btn primary" id="pick">＋ Добавить папку</button>
      <input class="input" id="manual" placeholder="или вставь путь: D:\\Аниме или \\\\NAS\\Аниме" style="width:360px"><button class="btn" id="add-manual">Добавить</button>
      <button class="btn" id="rescan">⟳ Обновить</button></div>
    ${groups.size ? `<div class="sec-head"><h2>Папки с видео</h2><span class="sub">${groups.size}</span></div><div class="grid">${[...groups].map(([dir, fs]) => {
      const l = S.library.links[dir];
      const watched = fs.filter(f => S.progress[f.path]?.done).length;
      return `<a class="card" href="#/folder?dir=${encodeURIComponent(dir)}"><div class="poster">
        ${l ? `<img loading="lazy" src="${img(l.poster)}" alt="">` : '<div style="display:grid;place-items:center;height:100%;font-size:46px">📁</div>'}
        <span class="eps">${watched}/${fs.length}</span><div class="bar"><i style="width:${watched / fs.length * 100}%"></i></div></div>
        <div class="t">${esc(l ? title(l) : folderTitle(dir))}</div><div class="m">${l ? esc(folderTitle(dir)) : 'Не привязано к тайтлу'}</div></a>`;
    }).join('')}</div>` : S.library.folders.length ? emptyHtml('📁', 'Видео не найдено', 'Поддерживаются MP4, MKV, WEBM, AVI, MOV, TS.') : ''}
    ${S.streams.length ? `<div class="sec-head"><h2>Сохранённые ссылки</h2><span class="sub">${S.streams.length}</span></div>
      <div class="eps-list">${S.streams.map(x => `<div class="ep" data-href="#/watch?s=${x.id}"><div class="n">🔗</div><div class="b"><div class="t">${esc(x.title || (x.anime ? title(x.anime) + (x.ep ? ' — серия ' + x.ep : '') : x.url))}</div>
        <div class="m">${esc(x.url)}</div></div><button class="btn sm" data-rms="${x.id}">✕</button></div>`).join('')}</div>` : ''}`;

  const addFolder = p => {
    p = p.trim().replace(/[\\/]+$/, '');
    if (!p) return;
    if (S.library.folders.includes(p)) { toast('Эта папка уже в медиатеке'); return; }
    S.library.folders.push(p);
    saveNow().catch(() => toast('Не удалось сохранить папку')).finally(route);
  };
  $('#pick').onclick = async () => {
    toast('Выбери папку в открывшемся окне');
    const r = await (await fetch('/api/pick-folder', { method: 'POST' })).json();
    if (r.path) addFolder(r.path.replace(/\//g, '\\'));
  };
  $('#add-manual').onclick = () => addFolder($('#manual').value);
  $('#manual').onkeydown = e => { if (e.key === 'Enter') addFolder(e.target.value); };
  $('#rescan').onclick = route;
  $$('[data-rmf]', view).forEach(b => b.onclick = async () => {
    const f = S.library.folders[+b.dataset.rmf];
    if (!await confirmBox(`Убрать папку из медиатеки?<br><small class="muted">${esc(f)}<br>Сами файлы останутся на диске.</small>`, 'Убрать')) return;
    S.library.folders = S.library.folders.filter(x => x !== f);
    saveNow().catch(() => {}).finally(route);
  });
  $$('[data-rms]', view).forEach(b => b.onclick = e => { e.stopPropagation(); S.streams = S.streams.filter(x => x.id !== b.dataset.rms); save(); route(); });
  bindEpisodeRows(view);
}

async function pageFolder(view, q, _, alive) {
  const dir = q.get('dir');
  if (!dir) { history.replaceState(history.state, '', '#/library'); return route(); }  // ссылка без папки
  const files = (await libraryFiles()).filter(f => f.dir === dir);
  if (!alive()) return;
  const l = S.library.links[dir];
  view.innerHTML = `
    <div style="display:flex;gap:22px;align-items:flex-start;margin-bottom:22px">
      ${l ? `<a href="#/anime/${l.id}"><img src="${img(l.poster)}" style="width:150px;border-radius:12px" alt=""></a>` : ''}
      <div><h1 class="page-title" style="margin-bottom:6px">${esc(l ? title(l) : folderTitle(dir))}</h1>
        <div class="muted" style="margin-bottom:14px">📁 ${esc(dir)} · ${plural(files.length, 'файл', 'файла', 'файлов')}</div>
        <div class="actions">${l ? `<a class="btn" href="#/anime/${l.id}/episodes">Серии тайтла</a><button class="btn" id="unlink">Отвязать</button>` : ''}
          <button class="btn ${l ? '' : 'primary'}" id="link">${l ? 'Привязать к другому' : 'Привязать к тайтлу'}</button>
          ${files.length ? `<button class="btn primary" id="cont">▶ ${files.some(f => S.progress[f.path]) ? 'Продолжить' : 'Смотреть'}</button>` : ''}</div></div>
    </div>
    <div class="eps-list">${files.map(episodeRow).join('') || emptyHtml('📁', 'Видео не найдено')}</div>`;
  bindEpisodeRows(view);
  $('#unlink')?.addEventListener('click', () => { delete S.library.links[dir]; save(); route(); });
  $('#link').onclick = () => linkPicker(dir);
  $('#cont')?.addEventListener('click', () => {
    const next = files.find(f => !S.progress[f.path]?.done) || files[0];
    watchOpen('#/watch?f=' + encodeURIComponent(next.path));
  });
}
function linkPicker(dir) {
  const box = modal(`<h3>К какому аниме относится папка?</h3>
    <input class="input" id="lq" style="width:100%" value="${esc(guessQuery(dir))}" placeholder="Название аниме">
    <div class="pick-list" id="lres"><div class="loading">Ищу…</div></div>`);
  const search = debounce(async text => {
    if (!text) return;
    try {
      const d = await gql(animes({ search: text, limit: 8 }));
      const list = d.animes.map(snap);
      $('#lres', box).innerHTML = list.map(a => `<div class="wide-card" data-id="${a.id}"><img src="${img(a.poster)}" alt="">
        <div class="wc-b"><div class="t">${esc(title(a))}</div><div class="m">${esc(a.name)} · ${esc(metaLine(a))}</div></div></div>`).join('') || '<div class="muted">Ничего не нашлось — попробуй другое название (можно латиницей).</div>';
      $$('[data-id]', box).forEach(el => el.onclick = () => {
        S.library.links[dir] = list.find(a => a.id === +el.dataset.id);
        save();
        closeModal();
        toast('Папка привязана');
        route();
      });
    } catch (err) { $('#lres', box).innerHTML = `<div class="muted">Ошибка: ${esc(err.message)}</div>`; }
  }, 350);
  $('#lq', box).oninput = e => search(e.target.value.trim());
  $('#lq', box).focus();
  search(guessQuery(dir));
}

// ================= Плеер =================
let player = null;
function closePlayer() {
  if (!player) return;
  player.destroy();
  player = null;
}
// Источник для плеера: { key, url, name, dir?, sub?, path?, anime, ep }
async function pageWatch(view, q, _, alive) {
  let cur, list = [];
  if (q.get('o')) {
    // серия из онлайн-источника: /watch?o=<shikimori-id>&d=<озвучка>&e=<номер>
    const a = await loadAnime(q.get('o'));
    if (!alive()) return;
    const s = snap(a);
    // d не задан — подставляем запомненную озвучку этого тайтла, иначе первую доступную;
    // label озвучки пригодится и для заголовка, и для истории просмотра
    const dubs = await onlineDubs(s);
    const dub = dubs.find(x => x.key === ((q.get('d') || (S.onlineDubs || {})[s.id] || '').split('#')[0]));
    const d = dub ? dub.key : (dubs[0]?.key || '');
    const e = Math.max(1, +q.get('e') || 1);
    if (!d) { view.innerHTML = emptyHtml('📺', 'Озвучка не выбрана', 'Открой страницу серий и выбери онлайн-озвучку.'); return; }
    let r = null;
    try { r = await fetch(`/api/online/stream?p=${a.id}&d=${encodeURIComponent(d)}&e=${e}`).then(x => x.json()); } catch { r = null; }
    if (!r || r.error) { view.innerHTML = emptyHtml('📺', 'Онлайн-источник недоступен', esc((r && r.error) || 'Попробуй другую озвучку или зайди позже.')) + '<div style="text-align:center"><a class="btn" href="#/anime/' + a.id + '/episodes">К списку серий</a></div>'; return; }
    if (!alive()) return;
    const hp = n => '#/watch?' + new URLSearchParams({ o: a.id, d, e: n }).toString();
    cur = {
      key: `o:${a.id}:${d}:${e}`, url: r.url, name: `${r.site}${r.quality ? ' · ' + r.quality + 'p' : ''}`,
      anime: s, ep: e, hls: /\.m3u8(\?|$)/i.test(r.url), embed: r.mode === 'embed', site: r.site,
      dub: dub ? dub.label : '',
      href: hp(e), q: r.quality || null, quals: (r.qualities || []).map(x => ({ q: +x.q, url: x.url })).filter(x => x.q),
    };
    for (let n = 1; n <= (r.count || 1); n++)
      list.push({ key: `o:${a.id}:${d}:${n}`, href: hp(n), name: 'Серия ' + n, ep: n, anime: s });
  } else if (q.get('s')) {
    const x = S.streams.find(y => y.id === q.get('s'));
    if (!x) { view.innerHTML = emptyHtml('🔗', 'Ссылка не найдена'); return; }
    cur = streamSource(x);
  } else {
    const files = await libraryFiles();
    if (!alive()) return;
    const f = files.find(x => x.path === q.get('f'));
    if (!f) { view.innerHTML = emptyHtml('📁', 'Файл не найден', 'Возможно, его переместили или папку убрали из медиатеки.') + '<div style="text-align:center"><a class="btn" href="#/library">В медиатеку</a></div>'; return; }
    cur = fileSource(f);
  }
  // Плейлист: все источники тайтла по порядку серий, иначе — файлы той же папки
  // (для онлайн-ветки список по выбранной озвучке уже собран выше)
  if (cur.anime && !q.get('o')) {
    const src = await sourcesFor(cur.anime);
    list = [...src.byEp.keys()].sort((a, b) => a - b).map(n => src.byEp.get(n)[0]).map(x => x.type === 'file' ? fileSource(x.f) : streamSource(x.x));
    if (!list.some(x => x.key === cur.key)) list = [cur];
  } else if (cur.dir) {
    list = (await libraryFiles()).filter(x => x.dir === cur.dir).map(fileSource);
  } else if (!q.get('o')) list = [cur]; // для онлайн-ветки плейлист уже собран по озвучке
  if (!alive()) return;
  if (S.settings.externalPlayer && cur.path) {
    fetch('/api/open-external', { method: 'POST', body: JSON.stringify({ path: cur.path }) });
    view.innerHTML = emptyHtml('▶', 'Открыто в системном плеере', 'Встроенный плеер можно вернуть в настройках воспроизведения.');
    return;
  }
  view.innerHTML = '';
  player = createPlayer(cur, list);
  const who = cur.anime ? title(cur.anime) : cur.dir ? folderTitle(cur.dir) : cur.name;
  document.title = `Animax · ${who}${cur.ep != null ? ' — серия ' + cur.ep : ''}`;
}
function fileSource(f) {
  const link = S.library.links[f.dir] || null;
  return { key: f.path, path: f.path, url: '/media?path=' + encodeURIComponent(f.path), name: f.name, dir: f.dir, sub: f.sub, anime: link, ep: epNum(f.name), href: '#/watch?f=' + encodeURIComponent(f.path) };
}
function streamSource(x) {
  return { key: x.url, url: x.url, name: x.title || (x.anime ? title(x.anime) + (x.ep ? ` — серия ${x.ep}` : '') : x.url), anime: x.anime, ep: x.ep, stream: x.id, href: '#/watch?s=' + x.id, hls: /\.m3u8(\?|$)/i.test(x.url), embed: streamMode(x) === 'embed', site: x.site || siteName(x.url) };
}

// Плеер сайта в рамке (iframe). Прогресс внутри чужого плеера не виден — поэтому есть кнопка «Просмотрено».
function createEmbedPlayer(cur, list) {
  const link = cur.anime;
  const src = embedUrl(cur.url);
  const idx = list.findIndex(x => x.key === cur.key);
  const prev = list[idx - 1], next = list[idx + 1];
  const root = document.createElement('div');
  root.className = 'player-page embed';
  const back = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    closeOrBack(link ? `#/anime/${link.id}/episodes` : '#/library');
  };
  if (!safeEmbed(src)) {
    root.innerHTML = `<div class="pl-center"><div class="msg"><h3 style="margin-top:0">Эту ссылку нельзя встроить</h3>
      <p class="muted">Во встроенный плеер открываются только внешние адреса https://.</p><button class="btn" id="eb">Назад</button></div></div>`;
    document.body.append(root);
    $('#eb', root).onclick = back;
    return { destroy() { root.remove(); } };
  }
  const marked = () => link && cur.ep != null && !!marksOf(link.id)[cur.ep];
  const yt = youtubeId(cur.url);
  root.innerHTML = `
    <div class="pl-top">
      <button class="pl-btn" id="e-back" title="Назад (Esc)">←</button>
      <div style="flex:1;min-width:0"><div class="t">${esc(link ? title(link) : 'Видео по ссылке')}</div>
        <div class="m">${cur.ep != null ? 'Серия ' + cur.ep + ' · ' : ''}${cur.dub ? esc(cur.dub) + ' · ' : ''}плеер сайта «${esc(cur.site)}»</div></div>
      ${prev ? '<button class="pl-btn txt" id="e-prev" title="Предыдущая серия">⏮ Пред.</button>' : ''}
      ${link && cur.ep != null ? `<button class="pl-btn txt" id="e-mark">${marked() ? '✓ Просмотрено' : '○ Отметить просмотренной'}</button>` : ''}
      ${next ? '<button class="pl-btn txt" id="e-next" title="Следующая серия">След. ⏭</button>' : ''}
      <button class="pl-btn" id="e-ext" title="Открыть в браузере">↗</button>
    </div>
    ${yt ? `<div class="pl-center"><div class="msg"><h3 style="margin-top:0">Ролик открыт на YouTube</h3>
      <p class="muted">Он в отдельном окне. Здесь можно отметить серию просмотренной или перейти к следующей.</p>
      <button class="btn" id="e-yt">Открыть снова ↗</button></div></div>`
    : `<iframe src="${esc(src)}" title="${esc(cur.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"></iframe>`}`;
  document.body.append(root);
  if (yt) { window.open(ytWatch(yt), '_blank'); $('#e-yt', root).onclick = () => window.open(ytWatch(yt), '_blank'); }
  // в историю — сразу при открытии
  S.history = [{ file: cur.key, stream: cur.stream, name: cur.name, dub: cur.dub || null, ep: cur.ep, anime: link || null, at: Date.now() }, ...S.history.filter(h => h.file !== cur.key)].slice(0, 300);
  save();
  $('#e-back', root).onclick = back;
  $('#e-prev', root)?.addEventListener('click', () => go(withW(prev.href)));
  $('#e-next', root)?.addEventListener('click', () => go(withW(next.href)));
  $('#e-ext', root).onclick = () => window.open(cur.url, '_blank');
  $('#e-mark', root)?.addEventListener('click', e => {
    const on = !marked();
    setMark(link, cur.ep, on);
    S.progress[cur.key] = { ...(S.progress[cur.key] || {}), done: on, at: Date.now() };
    save();
    e.currentTarget.textContent = on ? '✓ Просмотрено' : '○ Отметить просмотренной';
    if (on && next) toast('Отмечено. Следующая серия — кнопка «След. ⏭»');
  });
  const keys = e => {
    if (!$('#modal').hidden) return;
    if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); back(); }
  };
  document.addEventListener('keydown', keys, true);
  return {
    destroy() {
      document.removeEventListener('keydown', keys, true);
      const f = $('iframe', root);
      if (f) f.src = 'about:blank';
      root.remove();
    },
  };
}

function createPlayer(cur, list) {
  if (cur.embed) return createEmbedPlayer(cur, list);
  const link = cur.anime;
  const idx = list.findIndex(x => x.key === cur.key);
  const prev = list[idx - 1], next = list[idx + 1];
  const st = S.settings;
  const root = document.createElement('div');
  root.className = 'player-page';
  root.innerHTML = `
    <video preload="auto" autoplay class="fit-${st.fit}"></video>
    <div class="pl-zone l"></div><div class="pl-zone r"></div>
    <div class="pl-center" id="pl-center"></div>
    <div class="pl-osd" id="osd" style="opacity:0"></div>
    <div class="pl-ui">
      <div class="pl-top"><button class="pl-btn" id="pl-back" title="Назад (Esc)">←</button>
        <div style="flex:1;min-width:0"><div class="t">${esc(link ? title(link) : cur.dir ? folderTitle(cur.dir) : 'Видео по ссылке')}</div><div class="m">${cur.ep != null ? 'Серия ' + cur.ep + ' · ' : ''}${cur.dub ? esc(cur.dub) + ' · ' : ''}${esc(cur.name)}</div></div>
        <button class="pl-btn txt" id="b-speed" title="Скорость">⏱ ${st.speed === 1 ? 'Обычная' : st.speed + '×'} ▾</button>
        <button class="pl-btn txt" id="b-quality" title="Качество" hidden>⚙ Авто ▾</button>
        <button class="pl-btn txt${PLAYER_WINDOW ? ' on' : ''}" id="b-pin" title="Поверх всех окон">📌</button>
        <button class="pl-btn txt" id="b-fit" title="Масштаб">⤢ ${{ contain: 'Вписать', cover: 'Заполнить', fill: 'Растянуть' }[st.fit]}</button>
      </div>
      <div class="pl-bottom">
        <div class="pl-seek" id="seek"><div class="track"><div class="buf"></div><div class="cur"></div></div><div class="tip"></div></div>
        <div class="pl-row">
          <button class="pl-btn" id="b-prev" title="Предыдущая серия (Shift+P)" ${prev ? '' : 'disabled style="opacity:.3"'}>⏮</button>
          <button class="pl-btn" id="b-play" title="Пауза (Пробел)">⏸</button>
          <button class="pl-btn" id="b-next" title="Следующая серия (Shift+N)" ${next ? '' : 'disabled style="opacity:.3"'}>⏭</button>
          <button class="pl-btn txt" id="b-back10" title="−10 с (←)">−10</button>
          <button class="pl-btn txt" id="b-fwd10" title="+10 с (→)">+10</button>
          <span class="pl-time" id="time">0:00 / 0:00</span>
          <span class="pl-sp"></span>
          <button class="pl-btn txt" id="b-skip" title="Пропустить опенинг (S)">⏩ Опенинг +${fmtTime(st.skipLen)}</button>
          <button class="pl-btn" id="b-mute" title="Звук (M)">🔊</button><input class="pl-vol" id="vol" type="range" min="0" max="1" step="0.05">
          ${cur.sub ? '<button class="pl-btn txt" id="b-sub" title="Субтитры (C)">СУБ</button>' : ''}
          <button class="pl-btn" id="b-pip" title="Картинка в картинке">⧉</button>
          <button class="pl-btn" id="b-full" title="Полный экран (F)">⛶</button>
        </div>
      </div>
    </div>`;
  document.body.append(root);
  const v = $('video', root);
  // Качество: HLS-уровни либо отдельные дорожки, которые отдал сервер.
  // Переключение дорожки пересоздаёт источник, но сохраняет позицию и воспроизведение.
  const quals = (cur.quals || []).slice().sort((a, b) => (b.q || 0) - (a.q || 0));
  // В лёгком режиме держим меньший буфер и не тянем 1080p по умолчанию
  const hlsOpts = LITE ? { maxBufferLength: 20, maxMaxBufferLength: 40, maxBufferSize: 30 * 1000 * 1000 } : {};
  const newHls = () => new Hls(hlsOpts);
  const switchQuality = q => {
    const it = quals.find(x => +x.q === +q);
    if (!it || it.url === cur.url) return;
    const t = v.currentTime, wasPlaying = !v.paused;
    cur.q = +q;
    cur.url = it.url;
    const restore = () => {
      const seek = () => { try { if (isFinite(t) && v.duration) v.currentTime = t; } catch { /* ещё не готово */ } };
      seek();
      if (!isFinite(t) || !v.currentTime) setTimeout(seek, 300);
      if (wasPlaying) v.play().catch(() => {});
    };
    if (hls) {
      hls.destroy();
      hls = newHls();
      hls.loadSource(cur.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) showError(data.details); });
    } else v.src = cur.url;
    v.addEventListener('loadedmetadata', restore, { once: true });
    st.q = +q;  // выбор качества запоминается — применяется и к следующим сериям
    save();
    $('#b-quality', root).textContent = `⚙ ${q}p ▾`;
    osd(`Качество ${q}p`);
  };
  // Edge/Chromium рапортует canPlayType('mpegurl')='maybe', но HLS не играет —
  // поэтому при поддержке MSE всегда prefer hls.js, на Safari остаётся нативный путь
  let hls = null;
  if (cur.hls && window.Hls?.isSupported()) {
    hls = newHls();
    hls.loadSource(cur.url);
    hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (hls.levels.length > 1 || quals.length > 1) {
        if (LITE) {
          // авто-качество не выше 720p — меньше нагрузка на процессор и память
          const cap = hls.levels.map((l, i) => ({ h: l.height || 0, i })).filter(x => x.h && x.h <= 720).pop();
          if (cap) hls.autoLevelCapping = cap.i;
        } else if (hls.levels.length > 1 && st.q) {
          // применяем запомненное качество к уровню потока
          const i = hls.levels.findIndex(l => l.height === +st.q);
          if (i >= 0) hls.currentLevel = i;
        }
        $('#b-quality', root).hidden = false;
        $('#b-quality', root).textContent = LITE ? '⚙ до 720p ▾'
          : `⚙ ${(hls.levels.length > 1 && st.q && hls.levels.some(l => l.height === +st.q)) ? st.q + 'p' : cur.q ? cur.q + 'p' : 'Авто'} ▾`;
      }
    });
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) showError(data.details); });
  } else {
    // если пользователь ранее выбирал качество — стартуем с него (в лёгком режиме — не выше 720p)
    const saved = quals.find(x => +x.q === +st.q && (!LITE || +x.q <= 720))
      || (LITE ? quals.find(x => +x.q <= 720) : null);
    if (saved) { cur.q = +saved.q; cur.url = saved.url; }
    v.src = cur.url;
    if (quals.length > 1) {
      const q = $('#b-quality', root);
      q.hidden = false;
      q.textContent = `⚙ ${cur.q ? cur.q + 'p' : 'Авто'} ▾`;
    }
  }
  v.volume = st.volume ?? 1;
  v.playbackRate = st.speed || 1;
  if (cur.sub) {
    const tr = document.createElement('track');
    Object.assign(tr, { kind: 'subtitles', srclang: 'ru', label: 'Субтитры', src: '/sub?path=' + encodeURIComponent(cur.sub), default: true });
    v.append(tr);
  }

  let idleT, saveT = 0, nextT = null, marked = false, menu = null;
  const osd = text => { const o = $('#osd', root); o.textContent = text; o.style.opacity = 1; clearTimeout(o._t); o._t = setTimeout(() => o.style.opacity = 0, 900); };
  const wake = () => { root.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!v.paused && !menu) root.classList.add('idle'); }, 2500); };
  root.addEventListener('mousemove', wake);
  wake();

  const back = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    closeOrBack(link ? `#/anime/${link.id}/episodes` : cur.dir ? `#/folder?dir=${encodeURIComponent(cur.dir)}` : '#/library');
  };
  const playSrc = x => go(withW(x.href));
  const toggle = () => v.paused ? v.play().catch(() => {}) : v.pause();
  const seekBy = d => {
    if (!isFinite(v.duration)) return;  // поток ещё не загрузился
    v.currentTime = clamp(v.currentTime + d, 0, v.duration);
    osd((d > 0 ? '+' : '−') + Math.abs(d) + ' с');
  };
  const full = () => document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen();
  const closeMenu = () => { menu?.remove(); menu = null; };
  const openMenu = (btn, items, onPick) => {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'pl-menu';
    menu.innerHTML = items.map(([val, label, on]) => `<button data-v="${val}" class="${on ? 'on' : ''}">${label}</button>`).join('');
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.bottom = 'auto';
    menu.style.left = Math.min(r.left, innerWidth - 170) + 'px';
    root.append(menu);
    $$('button', menu).forEach(b => b.onclick = e => { e.stopPropagation(); onPick(b.dataset.v); closeMenu(); });
  };

  // Прогресс: каждые 5 секунд; на 90% серия считается просмотренной
  const store = (force = false) => {
    if (!v.duration || !isFinite(v.duration) || (!force && Date.now() - saveT < 5000)) return;
    saveT = Date.now();
    const done = v.currentTime / v.duration > 0.9 || v.ended;
    const p = S.progress[cur.key] = { t: v.currentTime, d: v.duration, done: done || S.progress[cur.key]?.done || false, at: Date.now() };
    S.history = [{ file: cur.key, stream: cur.stream || null, name: cur.name, dub: cur.dub || null, ep: cur.ep, anime: link || null, at: Date.now() }, ...S.history.filter(h => h.file !== cur.key)].slice(0, 300);
    if (p.done && !marked && link && cur.ep != null) { marked = true; setMark(link, cur.ep, true); }
    save();
  };

  function showError(details = '') {
    const c = $('#pl-center', root);
    c.innerHTML = `<div class="msg"><h3 style="margin-top:0">Не получается воспроизвести</h3>
      <p class="muted">${cur.path ? 'Скорее всего, видео или звук закодированы в формате, который встроенный плеер не понимает (например, MKV со звуком AC3/DTS или HEVC без кодека).' : 'Ссылка не открылась: сервер недоступен, ссылка устарела или сервер не разрешает воспроизведение из других программ (CORS).'}</p>
      ${details ? `<p class="muted" style="font-size:12px">${esc(details)}</p>` : ''}
      <div style="display:flex;gap:10px;justify-content:center">${cur.path ? '<button class="btn primary" id="ext">Открыть в системном плеере</button>' : ''}${next ? '<button class="btn" id="enext">Следующая серия</button>' : ''}<button class="btn" id="eb">Назад</button></div></div>`;
    $('#ext', root)?.addEventListener('click', () => fetch('/api/open-external', { method: 'POST', body: JSON.stringify({ path: cur.path }) }));
    $('#enext', root)?.addEventListener('click', () => playSrc(next));
    $('#eb', root).onclick = back;
  }

  v.addEventListener('loadedmetadata', () => {
    const p = S.progress[cur.key];
    if (p && !p.done && p.t > 10 && p.t < v.duration - 10) { v.currentTime = p.t; osd('Продолжаем с ' + fmtTime(p.t)); }
  });
  v.addEventListener('play', () => { $('#b-play', root).textContent = '⏸'; wake(); });
  v.addEventListener('pause', () => { $('#b-play', root).textContent = '▶'; root.classList.remove('idle'); store(true); });
  v.addEventListener('timeupdate', () => {
    const d = v.duration || 0;
    $('.cur', root).style.width = (d ? v.currentTime / d * 100 : 0) + '%';
    $('#time', root).textContent = `${fmtTime(v.currentTime)} / ${fmtTime(d)}`;
    if (v.buffered.length && d) $('.buf', root).style.width = (v.buffered.end(v.buffered.length - 1) / d * 100) + '%';
    store();
  });
  v.addEventListener('volumechange', () => {
    $('#b-mute', root).textContent = v.muted || !v.volume ? '🔇' : '🔊';
    $('#vol', root).value = v.muted ? 0 : v.volume;
    st.volume = v.volume;
  });
  v.addEventListener('ended', () => {
    store(true);
    if (!next || !st.autoNext) return;
    let left = 5;
    const c = $('#pl-center', root);
    c.innerHTML = `<div class="msg"><div class="muted">Следующая серия через <b id="cd">${left}</b> с</div><h3 style="margin:6px 0 14px">${esc(next.ep != null ? 'Серия ' + next.ep : next.name)}</h3>
      <div style="display:flex;gap:10px;justify-content:center"><button class="btn primary" id="nn">Смотреть сейчас</button><button class="btn" id="nc">Отмена</button></div></div>`;
    nextT = setInterval(() => { left--; const cd = $('#cd', root); if (cd) cd.textContent = left; if (left <= 0) { clearInterval(nextT); playSrc(next); } }, 1000);
    $('#nn', root).onclick = () => { clearInterval(nextT); playSrc(next); };
    $('#nc', root).onclick = () => { clearInterval(nextT); c.innerHTML = ''; };
  });
  v.addEventListener('error', () => showError(v.error?.message || ''));

  // Перемотка по полосе
  const seek = $('#seek', root);
  const posAt = e => { const r = seek.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
  let dragging = false;
  const seekTo = x => { if (isFinite(v.duration)) v.currentTime = x * v.duration; };
  seek.addEventListener('mousedown', e => { if (e.button === 0) { dragging = true; seekTo(posAt(e)); } });
  const up = () => { dragging = false; };
  addEventListener('mouseup', up);
  seek.addEventListener('mousemove', e => {
    const tip = $('.tip', seek), x = posAt(e);
    tip.textContent = fmtTime(x * (v.duration || 0));
    tip.style.left = x * 100 + '%';
    if (dragging) seekTo(x);
  });

  // Клик — пауза; двойной клик по краям — ±10 с, в центре — полный экран; удержание — ускорение 2×
  let clickT = null, holdT = null, holding = false, justHeld = false;
  const wave = (side, text) => { const w = document.createElement('div'); w.className = 'pl-wave ' + side; w.textContent = text; root.append(w); setTimeout(() => w.remove(), 700); };
  const onDown = () => {
    holdT = setTimeout(() => {
      holding = true;
      v.playbackRate = 2;
      const f = document.createElement('div'); f.className = 'pl-fast'; f.id = 'fast'; f.textContent = '2× ⏩'; root.append(f);
    }, 450);
  };
  // отпускание кнопки ловим на всём окне: иначе, отпустив её мимо видео, оставались бы на 2×
  const onUp = () => {
    clearTimeout(holdT);
    if (!holding) return;
    holding = false;
    justHeld = true;  // следующий click — конец удержания, а не пауза
    setTimeout(() => { justHeld = false; }, 0);
    v.playbackRate = st.speed || 1;
    $('#fast', root)?.remove();
  };
  addEventListener('mouseup', onUp);
  const clickZone = side => e => {
    if (justHeld) return;
    if (e.detail === 2) {
      clearTimeout(clickT);
      if (side === 'c') full(); else { seekBy(side === 'l' ? -10 : 10); wave(side, side === 'l' ? '« 10 с' : '10 с »'); }
      return;
    }
    clickT = setTimeout(toggle, 220);
  };
  [[v, 'c'], [$('.pl-zone.l', root), 'l'], [$('.pl-zone.r', root), 'r']].forEach(([el, side]) => {
    el.addEventListener('mousedown', e => { if (e.button === 0) onDown(); });
    el.addEventListener('click', clickZone(side));
  });

  $('#pl-back', root).onclick = back;
  $('#b-play', root).onclick = toggle;
  $('#b-prev', root).onclick = () => prev && playSrc(prev);
  $('#b-next', root).onclick = () => next && playSrc(next);
  $('#b-back10', root).onclick = () => seekBy(-10);
  $('#b-fwd10', root).onclick = () => seekBy(10);
  $('#b-skip', root).onclick = () => seekBy(st.skipLen);
  $('#b-mute', root).onclick = () => { v.muted = !v.muted; };
  $('#vol', root).oninput = e => { v.volume = +e.target.value; v.muted = false; };
  $('#vol', root).value = v.volume;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const setSpeed = r => { v.playbackRate = r; st.speed = r; save(); $('#b-speed', root).textContent = `⏱ ${r === 1 ? 'Обычная' : r + '×'} ▾`; osd('Скорость ' + (r === 1 ? 'обычная' : r + '×')); };
  $('#b-speed', root).onclick = e => openMenu(e.currentTarget, SPEEDS.map(r => [r, r === 1 ? 'Обычная' : r + '×', r === v.playbackRate]), x => setSpeed(+x));
  $('#b-quality', root).onclick = e => {
    if (hls && hls.levels && hls.levels.length > 1) {
      openMenu(e.currentTarget, [[-1, 'Авто', hls.currentLevel === -1 || hls.autoLevelEnabled], ...hls.levels.map((l, i) => [i, (l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + ' кбит/с'), !hls.autoLevelEnabled && hls.currentLevel === i]).reverse()],
        x => {
          hls.currentLevel = +x;
          const qtxt = +x < 0 ? 'Авто' : (hls.levels[+x].height || '') + 'p';
          if (+x >= 0 && hls.levels[+x].height) { st.q = hls.levels[+x].height; save(); }
          $('#b-quality', root).textContent = '⚙ ' + qtxt + ' ▾';
          osd('Качество ' + qtxt.toLowerCase());
        });
      return;
    }
    if (quals.length > 1) openMenu(e.currentTarget,
      quals.map(x => [x.q, `${x.q}p`, +x.q === +(cur.q || quals[0].q)]),
      x => switchQuality(+x));
  };
  const FITS = ['contain', 'cover', 'fill'], FIT_N = { contain: 'Вписать', cover: 'Заполнить', fill: 'Растянуть' };
  // 📌 Поверх всех окон (актуально для отдельного окна плеера)
  let pinned = PLAYER_WINDOW;
  $('#b-pin', root).onclick = () => {
    pinned = !pinned;
    $('#b-pin', root).classList.toggle('on', pinned);
    fetch('/api/pin-window', { method: 'POST', body: JSON.stringify({ on: pinned }) });
    osd(pinned ? 'Поверх всех окон' : 'Обычный режим');
  };
  $('#b-fit', root).onclick = e => {
    st.fit = FITS[(FITS.indexOf(st.fit) + 1) % FITS.length];
    v.className = 'fit-' + st.fit;
    e.currentTarget.textContent = '⤢ ' + FIT_N[st.fit];
    osd('Масштаб: ' + FIT_N[st.fit].toLowerCase());
    save();
  };
  const toggleSub = () => { const t = v.textTracks[0]; if (!t) return; t.mode = t.mode === 'showing' ? 'hidden' : 'showing'; osd(t.mode === 'showing' ? 'Субтитры включены' : 'Субтитры выключены'); };
  $('#b-sub', root)?.addEventListener('click', toggleSub);
  $('#b-pip', root).onclick = () => document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture().catch(() => {});
  $('#b-full', root).onclick = full;
  root.addEventListener('click', e => { if (menu && !e.target.closest('.pl-menu') && !e.target.closest('#b-quality') && !e.target.closest('#b-speed')) closeMenu(); });

  const keys = e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (!$('#modal').hidden) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && (k === 'n' || k === 'т')) { e.preventDefault(); if (next) playSrc(next); return; }
    if (e.shiftKey && (k === 'p' || k === 'з')) { e.preventDefault(); if (prev) playSrc(prev); return; }
    const vol = d => { v.volume = clamp(v.volume + d, 0, 1); v.muted = false; osd('Громкость ' + Math.round(v.volume * 100) + '%'); };
    const map = {
      ' ': toggle, k: toggle, л: toggle, f: full, а: full, m: () => v.muted = !v.muted, ь: () => v.muted = !v.muted,
      arrowleft: () => seekBy(-10), arrowright: () => seekBy(10), j: () => seekBy(-10), о: () => seekBy(-10), l: () => seekBy(10), д: () => seekBy(10),
      arrowup: () => vol(0.05), arrowdown: () => vol(-0.05),
      s: () => seekBy(st.skipLen), ы: () => seekBy(st.skipLen),
      c: toggleSub, с: toggleSub,
      '[': () => setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(v.playbackRate) - 1)] ?? 1), ']': () => setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v.playbackRate) + 1)] ?? 1),
      escape: () => { if (menu) closeMenu(); else if (!document.fullscreenElement) back(); },
    };
    if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); wake(); }
  };
  document.addEventListener('keydown', keys, true);

  return {
    destroy() {
      store(true);
      clearInterval(nextT);
      clearTimeout(idleT);
      document.removeEventListener('keydown', keys, true);
      removeEventListener('mouseup', up);
      removeEventListener('mouseup', onUp);
      clearTimeout(holdT);
      hls?.destroy();
      v.pause();
      v.removeAttribute('src');
      v.load();
      if (document.fullscreenElement) document.exitFullscreen();
      root.remove();
    },
  };
}
