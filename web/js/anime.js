'use strict';
// Animax — страница тайтла: описание, оценки, комментарии, отзывы.

// ================= Страница тайтла =================
const ANIME_FIELDS = `id russian name japanese english synonyms kind score status episodes episodesAired duration rating origin franchise
  airedOn { year month day date } releasedOn { date } nextEpisodeAt season descriptionHtml poster { mainUrl main2xUrl originalUrl }
  genres { id russian kind } studios { id name } screenshots { originalUrl x332Url }
  videos { url name kind playerUrl imageUrl } externalLinks { kind url }
  scoresStats { score count } statusesStats { status count } topic { id commentsCount }
  related { relationKind relationText anime { ${CARD} } }`;
const ANIME_CACHE = new Map();
async function loadAnime(id) {
  if (ANIME_CACHE.has(+id)) return ANIME_CACHE.get(+id);
  const d = await gql(animes({ ids: String(id), limit: 1, rating: '' }, ANIME_FIELDS));
  const a = d.animes[0];
  if (a) ANIME_CACHE.set(+id, a);
  return a;
}
function htmlText(h) {
  if (!h) return '';
  const d = new DOMParser().parseFromString(String(h).replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return d.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
// Уведомления по тайтлу: каждая серия, только последняя серия (тайтл вышел целиком) или не уведомлять.
// «Не уведомлять» нужно и для тайтлов из закладок — иначе они попадают в проверку по спискам.
const SUB_MODES = { each: '🔔 Каждая новая серия', final: '🏁 Только когда выйдет последняя серия', off: '🔕 Не уведомлять' };
const subMode = id => S.subs[id]?.mode || (S.subs[id] ? 'each' : null);
const subOn = id => !!S.subs[id] && subMode(id) !== 'off';
// Придут ли уведомления: своя подписка или тайтл в закладках из проверяемых списков (если не выключено)
const followOn = id => subOn(id) || S.settings.notifyLists.includes(S.list[id]?.status) && subMode(id) !== 'off';
// Что сейчас с уведомлениями по тайтлу — одно место для значка на странице тайтла, карточках и в меню.
// on: уведомления придут (значок яркий); иначе значок бледный, чтобы не отвлекал.
const NOTIFY_ON = new Set(['each', 'final', 'list', 'dub']);
function notifyState(a) {
  const id = +a.id, mode = subMode(id), e = S.list[id];
  const status = a.status || e?.anime?.status || S.subs[id]?.status;
  const dub = Object.values(S.subsDub || {}).find(x => +x.anime?.id === id);
  let st;
  if (mode === 'each') st = { k: 'each', i: '🔔', t: 'Уведомления: каждая новая серия' };
  else if (mode === 'final') st = { k: 'final', i: '🏁', t: 'Уведомления: только когда выйдет последняя серия' };
  else if (mode !== 'off' && status !== 'released' && S.settings.notifyLists.includes(e?.status))
    st = { k: 'list', i: '🔔', t: `Уведомления приходят сами: тайтл в закладках «${LIST_NAME[e.status]}»` };
  else if (dub) st = { k: 'dub', i: '🎙', t: `Следишь за озвучкой «${dub.dubLabel || 'озвучка'}»` };
  else if (mode === 'off') st = { k: 'off', i: '🔕', t: 'Уведомления по тайтлу отключены' };
  else st = { k: 'none', i: '🔔', t: 'Уведомлений нет — нажми, чтобы следить за сериями' };
  st.on = NOTIFY_ON.has(st.k);
  // вышедший целиком тайтл новых серий не даст — значок на карточке ему не нужен (кроме озвучки: её серии ещё выходят)
  st.badge = st.on && (st.k === 'dub' || status !== 'released');
  return st;
}
const notifyBadge = a => { const n = notifyState(a); return n.badge ? `<span class="nb nb-${n.k}" title="${esc(n.t)}">${n.i}</span>` : ''; };
// кнопка 🔔 на странице тайтла
function paintSub(a) {
  const n = notifyState(a);
  $$('#sub').forEach(b => { b.textContent = n.i; b.title = n.t; b.classList.toggle('on', n.on); b.classList.toggle('nf-dim', !n.on); });
}
function setSub(a, mode) {
  const inList = S.settings.notifyLists.includes(S.list[a.id]?.status);
  if (!mode || (mode === 'off' && !inList)) { delete S.subs[a.id]; S.subsDel['subs:' + a.id] = Date.now(); }
  else { S.subs[a.id] = { ...(S.subs[a.id] || snap(a)), ...stripEmpty(snap(a)), mode, at: S.subs[a.id]?.at || Date.now() }; delete S.subsDel['subs:' + a.id]; }
  save();
  refreshCards(a.id);  // значок уведомлений на карточках этого тайтла
}
// Маленькое меню выбора режима прямо у кнопки (вместо окна по центру).
// at — кнопка, под которой открыть, или точка { x, y }. Выбор → Promise с режимом; закрыли мимо — промис просто не сработает.
function subMenu(a, cur, at, note) {
  return new Promise(res => {
    ctx.innerHTML = (note ? `<div class="ch sub-note">${esc(note)}</div>` : '')
      + Object.entries(SUB_MODES).map(([k, n]) => `<button data-m="${k}" class="${k === cur ? 'on' : ''}"><i>${n.slice(0, 2)}</i>${esc(n.slice(3))}${k === cur ? '<em>✓</em>' : ''}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); res(b.dataset.m); });
    ctx.hidden = false;
    const r = ctx.getBoundingClientRect();
    const p = at instanceof Element ? (rc => ({ x: rc.left, y: rc.bottom + 6 }))(at.getBoundingClientRect()) : at;
    ctx.style.left = Math.max(8, Math.min(p.x, innerWidth - r.width - 8)) + 'px';
    ctx.style.top = Math.min(p.y, innerHeight - r.height - 8) + 'px';
  });
}
async function toggleSub(a, at) {
  const st = S.subs[a.id]?.status || a.status;
  if (st === 'released') { toast('Этот тайтл уже вышел полностью — новых серий не будет'); return; }
  const inList = S.settings.notifyLists.includes(S.list[a.id]?.status);
  const cur = subMode(a.id) || (inList ? 'each' : 'off');
  const note = inList ? `В закладках «${LIST_NAME[S.list[a.id].status]}» — уведомления приходят сами` : '';
  const mode = at ? await subMenu(a, cur, at, note)
    : ((await picker('Уведомления: ' + esc(title(a)), Object.entries(SUB_MODES).map(([v, label]) => ({ v, label })), [cur], { multi: false, note })) || [])[0];
  if (!mode || mode === cur) return;
  setSub(a, mode);
  toast(mode === 'each' ? 'Будем сообщать о каждой новой серии' : mode === 'final' ? 'Сообщим, когда выйдет последняя серия' : 'Уведомления по тайтлу отключены');
  paintSub(a);
}
function weekdayName(d) { return ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'][new Date(d).getDay()]; }

// Окно «Где смотреть»: бесплатные и подписочные площадки, прямой ссылкой если Shikimori её знает,
// иначе — поиск по названию. Всё открывается в браузере; ролики VK/RuTube/YouTube можно добавить в плеер через 🔗.
function watchWhereDialog(a, legal = []) {
  const q = title(a);
  const row = (x, href) => {
    const direct = href !== x.url(q);
    return `<a class="folder" href="${esc(href)}" target="_blank" rel="noopener">
      <span class="p">${esc(x.name)} <small style="font-weight:400;color:var(--ok)">${esc(x.free)}</small></span>
      <span class="muted">${direct ? 'прямая ссылка на тайтл' : x.note}</span><span>↗</span></a>`;
  };
  const body = WATCH_SERVICES.map(x => {
    const hit = legal.find(l => x.kinds.includes(l.kind));
    return row(x, hit ? hit.url : x.url(q));
  }).join('');
  modal(`<h3>Где смотреть</h3>
    <p class="muted">Официальные площадки: VK Видео, RuTube и YouTube — бесплатно; у Иви, Wink и Okko часть каталога открыта бесплатно с рекламой, остальное по подписке. Animax не ищет пиратские копии и не обходит защиты.</p>
    <div class="list">${body}</div>
    <p class="muted" style="font-size:12px">Свои файлы и домашний медиасервер играют прямо в Animax — раздел «Медиатека», а ссылку на ролик площадки можно добавить кнопкой 🔗 сверху.</p>
    <div class="row-btns"><button class="btn" onclick="closeModal()">Закрыть</button></div>`);
}

async function pageAnime(view, q, [id], alive) {
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  const a = await loadAnime(id);
  if (!alive()) return;
  if (!a) {
    view.innerHTML = emptyHtml('👻', 'Страница не найдена', 'Возможно, тайтл удалили из базы.') + `<div style="text-align:center"><button class="btn" onclick="goBack()">Вернуться назад</button>
      ${S.list[id] ? ' <button class="btn" id="rm">Удалить из закладок</button>' : ''}</div>`;
    $('#rm')?.addEventListener('click', () => { delete S.list[id]; save(); goBack(); });
    return;
  }
  const s = snap(a);
  SNAPS.set(s.id, s);
  if (S.list[s.id]) { entryOf(a); save(); }
  const rnd = q.get('random') === '1';
  const genresHtml = a.genres.map(g => `<a class="chip" href="#/results?genre=${g.id}">${esc(g.russian)}</a>`).join('');
  const desc = htmlText(a.descriptionHtml);
  const shots = a.screenshots || [];
  const vids = (a.videos || []).filter(v => youtubeId(v.playerUrl) || youtubeId(v.url)).sort((x, y) => (Object.keys(VIDEO_KINDS).indexOf(x.kind) - Object.keys(VIDEO_KINDS).indexOf(y.kind)) || ((+x.name || 0) - (+y.name || 0)));
  const related = (a.related || []).filter(r => r.anime);
  const seasonTxt = a.season ? SEASON[a.season.split('_')[0]] : '';
  const files = await libraryFiles().catch(() => []);
  const myFiles = files.filter(f => S.library.links[f.dir]?.id === s.id);
  const anons = a.status === 'anons';
  const myStreams = S.streams.filter(x => x.anime?.id === s.id);
  const inColls = S.collections.filter(c => c.items.some(x => x.id === s.id));
  const totalPeople = (a.statusesStats || []).reduce((n, x) => n + x.count, 0);
  const scoreTotal = (a.scoresStats || []).reduce((n, x) => n + x.count, 0);
  // 10-балльную гистограмму Shikimori сводим в 5 строк (как 5 звёзд)
  const hist5 = [5, 4, 3, 2, 1].map(st => ({ st, n: (a.scoresStats || []).filter(x => Math.ceil(x.score / 2) === st).reduce((n, x) => n + x.count, 0) }));
  const histMax = Math.max(1, ...hist5.map(h => h.n));
  const legal = (a.externalLinks || []).filter(l => LEGAL_LINKS[l.kind]);
  const info = (a.externalLinks || []).filter(l => INFO_LINKS[l.kind]);
  const marks = marksOf(s.id);
  const watched = Object.keys(marks).length;
  const nick = S.settings.nickname || 'Зритель';

  const rows = [
    ['🎬', [KIND_FULL[a.kind], a.airedOn?.year && a.airedOn.year + ' год', seasonTxt].filter(Boolean).join(', ')],
    ['📺', a.status === 'ongoing' ? `${a.episodesAired} из ${a.episodes || '?'} эп.${a.duration ? ` по ~${a.duration} мин.` : ''}` : a.episodes ? `${a.episodes} эп.${a.duration ? ` по ~${a.duration} мин.` : ''}` : a.duration ? `~${a.duration} мин.` : ''],
    ['📅', a.nextEpisodeAt ? `Новые серии каждую ${weekdayName(a.nextEpisodeAt)} · ${a.episodesAired + 1}-я серия ${fmtWhen(a.nextEpisodeAt)}` : a.status === 'anons' ? (a.airedOn?.date ? 'Выход: ' + fmtDate(a.airedOn.date) : 'Дата выхода пока неизвестна')
      : a.airedOn?.date ? `Выходил: ${fmtDate(a.airedOn.date)}${a.releasedOn?.date && a.releasedOn.date !== a.airedOn.date ? ' — ' + fmtDate(a.releasedOn.date) : ''}` : ''],
    ['📖', a.origin && ORIGIN[a.origin] ? 'Первоисточник: ' + ORIGIN[a.origin].toLowerCase() : ''],
    ['🏢', a.studios.length ? 'Студия: ' + a.studios.map(x => `<a class="linkbtn" href="#/results?studio=${x.id}&studioName=${encodeURIComponent(x.name)}">${esc(x.name)}</a>`).join(', ') : ''],
    ['✓', watched ? `Ты посмотрел ${watched} из ${a.episodes || a.episodesAired || '?'} серий` : ''],
  ].filter(([, v]) => v);

  view.innerHTML = `
    <div class="rel">
      <div class="rel-bg" style="background-image:url('${img(s.poster)}')"></div>
      <div class="rel-left">
        <div style="position:relative"><img class="poster" id="poster" src="${img(a.poster?.originalUrl || s.poster, 640)}" srcset="${img(a.poster?.originalUrl || s.poster, 640)} 640w, ${img(a.poster?.originalUrl || s.poster, 1200)} 1200w" sizes="270px" alt="">
          <div class="float">
            <button class="icon-btn" id="sub"></button>
            <button class="icon-btn" id="coll" title="Добавить в коллекцию">▣</button>
            ${rnd ? '<button class="icon-btn" id="reroll" title="Открыть другой случайный">🔀</button>' : ''}
          </div></div>
        <button class="btn status-btn ${S.list[s.id]?.status ? 'st-' + S.list[s.id].status : ''}" id="st"><span>${S.list[s.id]?.status ? LIST_NAME[S.list[s.id].status] : 'Не смотрю'}</span><span>▾</span></button>
        <div class="two">
          <button class="btn ${S.list[s.id]?.fav ? 'on' : ''}" id="fav">${S.list[s.id]?.fav ? '♥ В избранном' : '♡ В избранное'}</button>
          <a class="btn" href="#/anime/${s.id}/comments" title="Комментарии">💬 ${kfmt(a.topic?.commentsCount || 0)}</a>
          <button class="btn" id="more" title="Ещё">⋮</button>
        </div>
        ${anons ? `<div class="btn soon">📅 ${a.airedOn?.year ? 'Выход: ' + partDate(a.airedOn) : 'Дата выхода пока неизвестна'}</div>
        <label class="rl-follow anons-follow" title="Уведомим, когда начнётся показ, а потом — о новых сериях"><span>🔔 Следить за выходом</span>
          <span class="switch"><input type="checkbox" id="follow" ${followOn(s.id) ? 'checked' : ''}><span></span></span></label>`
        : `<button class="btn primary" id="play">▶ Смотреть</button>
        <div class="last-upd">${myFiles.length || myStreams.length ? `Мои источники: ${plural(myFiles.length, 'файл', 'файла', 'файлов')}${myStreams.length ? ', ' + plural(myStreams.length, 'ссылка', 'ссылки', 'ссылок') : ''}` : 'Выбери источник: файлы, ссылка или онлайн-озвучки'}</div>`}
        <button class="btn" id="online">🌐 Где смотреть</button>
      </div>

      <div class="rel-right">
        ${a.score > 0 ? `<div class="big-score">${shikiScore(a, 'bs', 2)} <small><a class="sh-link" href="${shikiUrl(a.id)}" target="_blank" rel="noopener" title="Открыть тайтл на Shikimori">Shikimori ↗</a> · ${kfmt(scoreTotal)} голосов</small></div>` : ''}
        <h1>${esc(title(a))}<span class="i" id="names" title="Все названия">i</span></h1>
        <div class="orig">${esc(a.name)}${RATING[a.rating] ? `<span class="age" id="age" title="${esc(RATING_INFO[a.rating] || '')}">${RATING[a.rating]}</span>` : ''}</div>
        <div style="margin-top:10px">${genresHtml}</div>
        <div class="info-rows">${rows.map(([i, v]) => `<div><i>${i}</i><span>${v.includes('<a') ? v : esc(v)}</span></div>`).join('')}</div>
        <div class="desc clamp" id="desc">${esc(desc || 'Описание пока не добавлено.')}</div>
        ${desc.length > 400 ? '<button class="linkbtn" id="desc-t">Подробнее…</button>' : ''}

        ${vids.length ? `<div class="sec-head"><h2>Видео</h2><span class="sub">${vids.length}</span><a class="link" href="#/anime/${s.id}/videos">Показать все</a></div>
          <div class="vrow">${vids.slice(0, 10).map((v, i) => `<div class="video" data-v="${i}"><div class="th"><img loading="lazy" src="${img(v.imageUrl)}" alt=""></div><div class="t">${esc(videoName(v))}</div></div>`).join('')}</div>` : ''}

        <div class="sec-head"><h2>Рейтинг</h2></div>
        <div class="rating-box">
          <div class="avg"><b>${a.score > 0 ? (a.score / 2).toFixed(1) : '—'}</b><div class="stars5 ro sm">${starsHtml(Math.round(a.score / 2))}</div><span>${scoreTotal ? kfmt(scoreTotal) + ' голосов на Shikimori' : 'Недостаточно голосов'}</span></div>
          <div class="hist">${hist5.map(h => `<div class="r"><span>${h.st}★</span><div class="tr"><i style="width:${h.n / histMax * 100}%"></i></div><span>${kfmt(h.n)}</span></div>`).join('')}</div>
          <div class="my-rate"><div class="avatar" style="${S.settings.avatar ? `background-image:url('${S.settings.avatar}')` : ''}">${S.settings.avatar ? '' : esc(nick[0].toUpperCase())}</div>
            <div><div class="muted" style="font-size:12px">${S.list[s.id]?.score ? 'Твоя оценка · ' + scoreText(S.list[s.id].score) : 'Оцени тайтл'}</div><div class="stars5" id="my-stars">${starsHtml(S.list[s.id]?.score || 0)}</div></div>
            ${S.notes[s.id] ? `<button class="linkbtn" id="note-edit" style="margin-left:auto">Изменить впечатления</button>` : ''}</div>
        </div>
        <div id="my-review"></div>
        <div id="viewer-reviews"></div>
        ${S.notes[s.id] ? `<div class="section"><h3>Мои впечатления</h3><div class="my-note">${S.notes[s.id].spoiler ? '<span class="spoiler">' + esc(S.notes[s.id].text) + '</span>' : esc(S.notes[s.id].text)}</div></div>` : ''}

        ${totalPeople ? `<div class="sec-head"><h2>В списках у людей</h2><span class="sub">${kfmt(totalPeople)}</span></div>
          <div class="people"><div class="pbar">${LISTS.map(([k]) => { const n = a.statusesStats.find(x => x.status === k)?.count || 0; return `<i style="width:${n / totalPeople * 100}%;background:${LIST_COLOR[k]}" title="${LIST_NAME[k]}: ${n}"></i>`; }).join('')}</div>
          <div class="plegend">${LISTS.map(([k, n]) => `<span style="--c:${LIST_COLOR[k]}">${n}: <b>${kfmt(a.statusesStats.find(x => x.status === k)?.count || 0)}</b></span>`).join('')}</div>
          ${a.status === 'anons' ? `<p class="muted" style="margin:10px 0 0">${kfmt(a.statusesStats.find(x => x.status === 'planned')?.count || 0)} человек планируют смотреть этот тайтл</p>` : ''}</div>` : ''}

        ${shots.length ? `<div class="sec-head"><h2>Кадры</h2><span class="sub">${shots.length}</span></div>
          <div class="shots-row">${shots.map((x, i) => `<img loading="lazy" src="${img(x.x332Url)}" data-i="${i}" alt="">`).join('')}</div>` : ''}

        ${related.length ? `<div class="sec-head"><h2>Связанные</h2><span class="sub">${related.length}</span><a class="link" href="#/anime/${s.id}/related">Хронология франшизы</a></div>
          <div class="row">${related.slice(0, 14).map(r => card(snap(r.anime), { meta: `${r.relationText} · ${snap(r.anime).year || ''}` })).join('')}</div>` : ''}

        <div class="sec-head"><h2>Коллекции</h2><a class="link" href="#/anime/${s.id}/collections">${inColls.length ? `В моих коллекциях: ${inColls.length} ›` : ''}</a></div>
        <button class="btn" id="coll2">＋ Добавить в свою коллекцию</button>

        <div class="sec-head"><h2>Рекомендуем также</h2></div><div id="similar"><div class="loading">Загрузка…</div></div>

        ${legal.length || info.length ? `<div class="sec-head"><h2>Ссылки</h2></div><div class="links">${[...legal, ...info].map(l => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${LEGAL_LINKS[l.kind] || INFO_LINKS[l.kind]}${l.kind === 'wikipedia' ? ` (${esc(new URL(l.url).hostname.split('.')[0])})` : ''} ↗</a>`).join('')}</div>` : ''}

        <div class="sec-head"><h2>Комментарии</h2><span class="sub">${kfmt(a.topic?.commentsCount || 0)} · с Shikimori</span><a class="link" href="#/anime/${s.id}/comments">Написать</a><a class="link" href="#/anime/${s.id}/comments">Показать все</a></div>
        <div id="cm-prev"><div class="loading">Загрузка…</div></div>
      </div>
    </div>`;

  // озвучки ищутся несколько секунд — начинаем заранее, пока человек читает описание
  if (!anons && !['music', 'pv', 'cm'].includes(a.kind) && SYS?.online !== false) onlineDubs(s);
  // кнопки
  $('#poster').onclick = () => viewer([a.poster?.originalUrl || s.poster]);
  paintSub(s);
  $('#sub').onclick = async e => { await toggleSub(s, e.currentTarget); paintSub(s); if ($('#follow')) $('#follow').checked = followOn(s.id); };
  $('#follow')?.addEventListener('change', e => {
    setSub(s, e.target.checked ? 'each' : 'off');
    paintSub(s);
    toast(e.target.checked ? 'Сообщим, когда начнётся показ, и о новых сериях' : 'Уведомления по тайтлу отключены');
  });
  $('#coll').onclick = $('#coll2').onclick = () => collectionPicker(s);
  $('#reroll')?.addEventListener('click', randomAnime);
  $('#st').onclick = async () => { if ((await statusPicker(s)) !== null) route(); };
  $('#fav').onclick = () => { toggleFav(s); route(); };
  $('#play')?.addEventListener('click', () => go(`#/anime/${s.id}/watch`));
  $('#online').onclick = () => watchWhereDialog(s, legal);
  $('#more').onclick = () => {
    const r = $('#more').getBoundingClientRect();
    const items = [
      ['🔗', 'Открыть ссылку на видео…', () => streamDialog({ anime: s })],
      ['↗', 'Открыть на Shikimori', () => window.open(shikiUrl(s.id), '_blank')],
      ['⧉', 'Скопировать ссылку', () => copy(shikiUrl(s.id), 'Ссылка скопирована')],
      ['✉', 'Поделиться', () => copy(`Рекомендую посмотреть: «${title(s)}» — ${shikiUrl(s.id)}`, 'Текст для отправки скопирован')],
      ['✎', S.notes[s.id] ? 'Изменить впечатления' : 'Записать впечатления', () => noteDialog(s)],
    ];
    ctx.innerHTML = items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${esc(t)}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false;
    ctx.style.left = r.left + 'px';
    ctx.style.top = (r.bottom + 6) + 'px';
  };
  $('#names').onclick = () => {
    const alt = [a.english, ...(a.synonyms || [])].filter(Boolean);
    const row = (h, t) => `<div class="folder"><div class="p"><small class="muted">${h}</small><br>${esc(t)}</div><button class="btn sm" data-c="${esc(t)}">⧉</button></div>`;
    const b = modal(`<h3>Названия</h3><div class="list">${row('Название', title(a))}${row('Оригинальное название', a.name)}${a.japanese ? row('На японском', a.japanese) : ''}
      ${alt.map(t => row('Альтернативное название', t)).join('')}</div><div class="row-btns"><button class="btn" onclick="closeModal()">Закрыть</button></div>`);
    $$('[data-c]', b).forEach(x => x.onclick = () => copy(x.dataset.c));
  };
  $('#age')?.addEventListener('click', () => modal(`<h3>Возрастное ограничение ${RATING[a.rating]}</h3><p>${esc(RATING_INFO[a.rating] || '')}</p>
    <p class="muted">Возрастные пометки — по американской системе MPAA, которую использует Shikimori: 0+ → G, 6+ → PG, 13+ → PG-13, 16+ → R, 18+ → R+.</p><div class="row-btns"><button class="btn" onclick="closeModal()">Понятно</button></div>`));
  $('#desc-t')?.addEventListener('click', e => { const d = $('#desc'); d.classList.toggle('clamp'); e.target.textContent = d.classList.contains('clamp') ? 'Подробнее…' : 'Скрыть'; });
  $$('.video', view).forEach(el => el.onclick = () => openVideo(vids[+el.dataset.v]));
  $$('.shots-row img', view).forEach(im => im.onclick = () => viewer(shots.map(x => x.originalUrl), +im.dataset.i));
  $$('#my-stars button').forEach(b => b.onclick = e => rateDialog(s, starVal(e)));
  $('#note-edit')?.addEventListener('click', () => noteDialog(s));
  $$('.my-note .spoiler', view).forEach(sp => sp.onclick = () => sp.classList.add('open'));

  renderMyReview($('#my-review'), a).then(() => {
    // ?rvc=<id> — пришли из уведомления «комментарий к отзыву»: показываем комментарии отзыва
    const rv = myReview(a.id);
    if (q.get('rvc') && rv && alive()) {
      $('#my-review').scrollIntoView({ block: 'start', behavior: 'smooth' });
      reviewComments(rv, q.get('rvc'));
    }
  });
  renderViewerReviews($('#viewer-reviews'), a, alive);
  // догружаем «Рекомендуем также» и комментарии
  rest(`/api/animes/${s.id}/similar`).then(list => fillPosters(list.slice(0, 16).map(snap))).then(list => {
    if (alive()) $('#similar').innerHTML = list.length ? `<div class="row">${list.map(x => card(x)).join('')}</div>` : '<div class="muted">Похожих не нашлось</div>';
  }).catch(err => { if (alive()) $('#similar').innerHTML = `<div class="muted">Не удалось загрузить: ${esc(err.message)}</div>`; });
  if (a.topic?.id) {
    loadComments(a.topic.id, 1, 3).then(list => {
      if (!alive()) return;
      $('#cm-prev').innerHTML = list.length ? `<div class="comments">${list.map(commentHtml).join('')}</div>` : '<div class="muted">Ещё никто не оставлял комментарии.</div>';
      fillAttitudes($('#cm-prev'), a.id);
      bindSpoilers($('#cm-prev'));
    }).catch(() => { if (alive()) $('#cm-prev').innerHTML = '<div class="muted">Комментарии не загрузились.</div>'; });
  } else $('#cm-prev').innerHTML = '<div class="muted">Обсуждения пока нет.</div>';
}
// Оценка Shikimori: основная — в шкале из настроек, вторая всплывает над ней при наведении
function shikiScore(a, cls, digits = 1) {
  const ten = (+a.score).toFixed(digits), five = (a.score / 2).toFixed(digits);
  const [main, alt] = scale10() ? [ten, five + ' из 5'] : [five, ten + ' из 10'];
  return `<span class="${cls} sc2"><em>${alt}</em>★ ${main}</span>`;
}
function starsHtml(n, ro = false) {
  const half = scale10() && !ro;
  return [1, 2, 3, 4, 5].map(i => `<button data-s="${i}" class="${i <= n ? 'on' : i - 0.5 <= n ? 'half' : ''}">★${half ? `<i data-s="${i - 0.5}"></i>` : ''}</button>`).join('');
}
// значение звезды под курсором: в режиме 1–10 левая половинка звезды — «половинка»
const starVal = e => +e.target.closest('[data-s]').dataset.s;
const videoName = v => v.kind === 'episode_preview' && /^\d+$/.test(v.name) ? `Превью ${+v.name} серии` : v.name || VIDEO_KINDS[v.kind] || 'Видео';

// Оценка: подтверждение со словом, потом — по желанию — впечатления
function rateDialog(a, n) {
  const e = S.list[a.id];
  let v = n;
  const b = modal(`<h3 id="rw" style="text-align:center">${scoreWord(v)}</h3><div style="text-align:center"><div class="stars5 big" id="rs">${starsHtml(v)}</div>
    <div class="muted" id="rn"></div></div>
    <div class="row-btns">${e?.score ? '<button class="btn" data-del>Убрать оценку</button>' : ''}<button class="btn" data-c>Отмена</button><button class="btn primary" data-ok>Оценить</button></div>`);
  const draw = () => {
    $('#rs', b).innerHTML = starsHtml(v);
    $('#rw', b).textContent = scoreWord(v);
    $('#rn', b).textContent = scale10() ? scoreText(v) : '';
    $$('#rs button', b).forEach(x => x.onclick = e => { v = starVal(e); draw(); });
  };
  draw();
  b.querySelector('[data-c]').onclick = closeModal;
  b.querySelector('[data-del]')?.addEventListener('click', () => { const x = entryOf(a); x.score = 0; commit(a.id); closeModal(); route(); });
  b.querySelector('[data-ok]').onclick = () => {
    const x = entryOf(a);
    const first = !x.score;
    x.score = v;
    x.scoredAt = Date.now();
    commit(a.id);
    if (first && !S.notes[a.id]) noteDialog(a, true); else { closeModal(); route(); }
  };
}
function noteDialog(a, afterRate = false) {
  const n = S.notes[a.id] || { text: '', spoiler: false };
  const b = modal(`<h3>${afterRate ? 'Оценка сохранена' : 'Мои впечатления'}</h3><p class="muted">${afterRate ? 'Запиши, что понравилось, а что разочаровало — это увидишь только ты.' : 'Заметка о тайтле видна только тебе.'}</p>
    <textarea class="input" id="nt" rows="5" maxlength="2000" placeholder="Твои впечатления">${esc(n.text)}</textarea>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="ns" ${n.spoiler ? 'checked' : ''}> Содержит спойлер</label>
    <div class="row-btns">${S.notes[a.id] ? '<button class="btn" data-del>Удалить</button>' : ''}<button class="btn" data-c>${afterRate ? 'Нет, спасибо' : 'Отмена'}</button><button class="btn primary" data-ok>Сохранить</button></div>`);
  $('#nt', b).focus();
  b.querySelector('[data-c]').onclick = () => { closeModal(); route(); };
  b.querySelector('[data-del]')?.addEventListener('click', () => { delete S.notes[a.id]; save(); closeModal(); route(); });
  b.querySelector('[data-ok]').onclick = () => {
    const text = $('#nt', b).value.trim();
    if (text) S.notes[a.id] = { text, spoiler: $('#ns', b).checked, at: Date.now() }; else delete S.notes[a.id];
    save();
    closeModal();
    route();
  };
}

// ---- комментарии Shikimori (только чтение) ----
async function loadComments(topicId, page, limit = 20, desc = true) {
  return rest(`/api/comments?commentable_id=${topicId}&commentable_type=Topic&page=${page}&limit=${limit}&desc=${desc ? 1 : 0}`);
}
// Безопасный разбор: из HTML/BB-кодов Shikimori оставляем только текст, переносы, цитаты и спойлеры
function commentBody(html) {
  const d = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const walk = node => [...node.childNodes].map(n => {
    if (n.nodeType === 3) return esc(n.textContent);
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase(), cls = n.className || '';
    if (tag === 'br') return '<br>';
    if (tag === 'img') return n.classList.contains('smiley') ? esc(n.alt || '') : '<span class="muted">[картинка]</span>';
    if (/b-spoiler|spoiler/.test(cls)) return `<span class="spoiler">${walk(n)}</span>`;
    if (tag === 'blockquote' || /b-quote/.test(cls)) return `<blockquote>${walk(n)}</blockquote>`;
    if (['b', 'strong'].includes(tag)) return `<b>${walk(n)}</b>`;
    if (['i', 'em'].includes(tag)) return `<i>${walk(n)}</i>`;
    if (['p', 'div'].includes(tag)) return walk(n) + '<br>';
    return walk(n);
  }).join('');
  let out = walk(d.body);
  out = out.replace(/\[quote=[^\];]*;?[^\];]*;?([^\]]*)\]/g, (_, nick) => `<blockquote>${nick ? `<b>${nick}</b>` : ''}`).replace(/\[quote\]/g, '<blockquote>').replace(/\[\/quote\]/g, '</blockquote>')
    .replace(/\[spoiler[^\]]*\]/g, '<span class="spoiler">').replace(/\[\/spoiler\]/g, '</span>')
    .replace(/\[\/?[a-z_]+(=[^\]]*)?\]/gi, '').replace(/(<br>\s*){3,}/g, '<br><br>');
  return out;
}
function commentHtml(c) {
  const mine = myComment(c.id);
  return `<div class="cm ${mine ? 'mine' : ''}" id="c${c.id}" data-uid="${c.user_id}"><img src="${img(c.user?.avatar, 0)}" alt="" onerror="this.src='icon-96.png'"><div>
    <div class="h"><b>${esc(c.user?.nickname || 'Пользователь')}</b><span>${fmtWhen(c.created_at)}${c.updated_at && c.updated_at !== c.created_at ? ' · изменён' : ''}</span>
      ${mine ? '<span class="tone-pill t-neu">мой</span>' : `<span class="att" data-uid="${c.user_id}"></span>`}</div>
    <div class="tx">${commentBody(c.html_body)}</div>
    <div class="cm-act"><button class="linkbtn" data-reply="${c.id}" data-uid="${c.user_id}" data-nick="${esc(c.user?.nickname || '')}">Ответить</button>
      ${mine && mine.replies.length ? `<span class="muted">💬 ${plural(mine.replies.length, 'ответ', 'ответа', 'ответов')}</span>` : ''}
      <a class="sh-link" href="${SHIKI_URL}comments/${c.id}" target="_blank" rel="noopener" title="Открыть этот комментарий на Shikimori">на Shikimori ↗</a></div></div></div>`;
}

// ---- свои комментарии: пишем в обсуждение Shikimori ----
const TONES = { pos: ['👍', 'Положительный'], neu: ['😐', 'Нейтральный'], neg: ['👎', 'Отрицательный'] };
const myComment = id => S.myComments.find(c => c.id === +id);
let AUTH = null;
async function authStatus(force = false) {
  if (!AUTH || force) AUTH = await fetch('/api/auth/status').then(r => r.json()).catch(() => ({}));
  return AUTH;
}
const animeSnap = a => ({ id: +a.id, russian: a.russian || '', name: a.name || '', poster: a.poster?.main2xUrl || a.poster?.mainUrl || a.poster || '',
  genres: (a.genres || []).filter(g => typeof g === 'string' || g.kind !== 'demographic').map(g => g.russian || g) });
// BB-коды комментария → простой текст (для профиля и уведомлений)
const bbText = t => String(t || '').replace(/\[comment=\d+(;\d+)?\],?\s*/g, '').replace(/\[\/?[a-z_]+(=[^\]]*)?\]/gi, '').trim();

// Поле «написать комментарий». Возвращает { reply({id, uid, nick}) } — ответить на чужой комментарий
async function composer(box, anime, topicId, onSent) {
  const au = await authStatus();
  if (!au.logged) {
    box.innerHTML = `<div class="hint"><span>💬</span><div>Чтобы писать и отвечать, войди через Shikimori — комментарии увидят все пользователи сайта.
      <a class="linkbtn" href="#/settings?s=account">Войти</a></div></div>`;
    return { reply() { go('#/settings?s=account'); } };
  }
  let reply = null;
  box.innerHTML = `<div class="composer">
    <div class="cmp-to" hidden></div>
    <textarea class="input" rows="3" maxlength="5000" placeholder="Комментарий от ${esc(au.user?.nickname || 'тебя')}…"></textarea>
    <div class="cmp-row">${opinionPicker(anime, false)}
      <label class="muted"><input type="checkbox" data-sp> спойлер</label>
      <button class="btn primary" data-send>Отправить</button></div>
    <div class="muted cmp-note">Мнение относится ко всему тайтлу и влияет на рекомендации. ${myReview(anime.id) ? 'Оно же стоит в твоём отзыве на Shikimori.' : 'На Shikimori его видно, только если написать отзыв.'}</div></div>`;
  const ta = $('textarea', box), to = $('.cmp-to', box);
  bindOpinion(box, anime);
  const setReply = r => {
    reply = r;
    to.hidden = !r;
    to.innerHTML = r ? `Ответ для <b>${esc(r.nick)}</b> <button class="linkbtn" data-x>✕</button>` : '';
    $('[data-x]', to)?.addEventListener('click', () => setReply(null));
    if (r) { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus(); }
  };
  $('[data-send]', box).onclick = async e => {
    const text = ta.value.trim();
    if (text.length < 2) { toast('Напиши хотя бы пару слов'); return; }
    let body = $('[data-sp]', box).checked ? `[spoiler=спойлер]${text}[/spoiler]` : text;
    if (reply) body = `[comment=${reply.id};${reply.uid}], ${body}`;
    e.target.disabled = true;
    try {
      const r = await fetch('/api/shiki/comment', { method: 'POST', body: JSON.stringify({ topic_id: topicId, body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) throw new Error(j.error || (j.errors && [].concat(j.errors).join(', ')) || 'Shikimori ответил ' + r.status);
      S.myComments.unshift({ id: j.id, topicId, anime: animeSnap(anime), body: text, at: Date.now(), replyTo: reply && { id: reply.id, nick: reply.nick }, replies: [] });
      save();
      ta.value = '';
      setReply(null);
      toast('Комментарий опубликован');
      onSent?.();
    } catch (err) { toast('Не отправилось: ' + err.message); }
    finally { e.target.disabled = false; }
  };
  return { reply: setReply };
}

// Ответы на мои комментарии: смотрим свежие комментарии в обсуждениях, где я писал,
// и ищем упоминания [comment=<id моего комментария>]. Новые — в уведомления.
let repliesBusy = false;
async function checkReplies() {
  return (await checkCommentReplies()) + (await checkReviewComments());
}
async function checkCommentReplies() {
  const mine = S.myComments.filter(c => Date.now() - c.at < 90 * 864e5);
  if (!mine.length || repliesBusy) return 0;
  repliesBusy = true;
  let added = 0;
  try {
    const me = (await authStatus()).user?.id;
    const topics = [...new Set(mine.map(c => c.topicId))].slice(0, 15);
    for (const tid of topics) {
      const list = mine.filter(c => c.topicId === tid);
      const oldest = Math.min(...list.map(c => c.at));
      for (let page = 1; page <= 3; page++) {
        const cs = await loadComments(tid, page, 30, true);
        for (const x of cs) {
          if (me && x.user_id === me) continue;
          for (const [, id] of String(x.body).matchAll(/\[comment=(\d+)/g)) {
            const c = list.find(m => m.id === +id);
            if (!c || c.replies.some(r => r.id === x.id)) continue;
            const text = bbText(x.body);
            const nick = x.user?.nickname || 'Кто-то';
            c.replies.push({ id: x.id, nick, avatar: x.user?.avatar || '', text, at: Date.parse(x.created_at) || Date.now() });
            const href = `#/anime/${c.anime.id}/comments?c=${x.id}`;  // сразу к этому ответу
            S.notifications.unshift({ id: uid(), type: 'reply', anime: c.anime, at: Date.now(), read: false, href,
              text: `${nick} ответил на твой комментарий: «${text.slice(0, 120)}»` });
            if (S.settings.notifyDesktop !== false) desktop('Ответ на комментарий', `${nick}: ${text.slice(0, 120)}`, href);
            added++;
          }
        }
        if (cs.length < 30 || Date.parse(cs.at(-1).created_at) < oldest) break;
      }
    }
  } catch { /* нет сети — проверим в следующий раз */ }
  finally { repliesBusy = false; }
  if (added) { S.notifications = S.notifications.slice(0, 300); save(); updateBadge(); }
  return added;
}

// ---- моё мнение о тайтле: 👍 / 😐 / 👎. Влияет на рекомендации; на Shikimori мнение есть только у отзыва,
// поэтому если отзыв написан — мнение в нём меняется вместе с мнением в Animax ----
const myOpinion = id => S.opinions[id]?.tone || null;
function migrateOpinions() {
  // раньше тон ставился у каждого комментария — переносим самый свежий на тайтл, отзыв главнее
  S.opinions = {};
  [...S.myComments].reverse().forEach(c => { if (c.tone) S.opinions[c.anime.id] = { tone: c.tone, anime: c.anime, at: c.at }; });
  S.myReviews.forEach(r => { S.opinions[r.anime.id] = { tone: r.tone, anime: r.anime, at: r.at }; });
}
async function setOpinion(a, tone) {
  const id = +a.id;
  if (!tone) delete S.opinions[id];
  else S.opinions[id] = { tone, anime: S.opinions[id]?.anime || animeSnap(a), at: Date.now() };
  save();
  const r = myReview(id);
  if (!r || !tone || r.tone === tone) return false;
  r.tone = tone;
  save();
  await refreshReview(r);  // меняет мнение отзыва на Shikimori и заодно приносит свежие голоса
  return true;
}
function opinionPicker(a, note = true) {
  const t = myOpinion(a.id), r = myReview(a.id);
  return `<div class="opinion-box"><span class="muted">Моё мнение:</span>
    <div class="tone-pick">${Object.entries(TONES).map(([k, [i, n]]) => `<button class="btn sm ${k === t ? 'on' : ''}" data-op="${k}">${i} ${n}</button>`).join('')}</div>
    ${note ? `<span class="muted op-note">${r ? 'Видно на Shikimori — в твоём отзыве' : 'Учитывается в рекомендациях. На Shikimori мнение появится вместе с отзывом'}</span>` : ''}</div>`;
}
function bindOpinion(root, a, after) {
  $$('[data-op]', root).forEach(b => b.onclick = async () => {
    const tone = b.dataset.op === myOpinion(a.id) ? null : b.dataset.op;  // повторный клик снимает мнение
    $$('[data-op]', root).forEach(x => x.classList.toggle('on', x.dataset.op === tone));
    try { if (await setOpinion(a, tone)) toast('Мнение изменено и в отзыве на Shikimori'); }
    catch (err) { toast('В Animax сохранено, но Shikimori не ответил: ' + err.message); }
    after?.();
  });
}

// ---- отзывы на Shikimori (право topics): мнение отзыва = моё мнение о тайтле, у отзыва есть голоса «за / против» и свои комментарии ----
const OPINION = { pos: 'positive', neu: 'neutral', neg: 'negative' };
const REVIEW_MIN = 230;  // Shikimori не принимает слишком короткие отзывы
const myReview = id => S.myReviews.find(r => r.anime.id === +id);
async function reviewTopic(r) {
  if (!r.topicId) {
    const t = await fetch('/api/shiki/review-topic?id=' + r.id).then(x => x.json()).catch(() => []);
    if (t[0]?.id) { r.topicId = t[0].id; r.comments = t[0].comments_count || 0; }
  }
  return r.topicId;
}
// Голоса: отдельного метода «прочитать отзыв» у Shikimori нет, но ответ на изменение содержит свежие голоса.
// Поэтому «изменяем» отзыв тем же мнением — текст не трогаем.
async function refreshReview(r) {
  const j = await postJson('/api/shiki/review', { id: r.id, opinion: OPINION[r.tone] });
  if (j.id) Object.assign(r, { up: j.cached_votes_up || 0, down: j.cached_votes_down || 0, comments: j.comments_count || 0, checkedAt: Date.now() });
  save();
}
async function checkReviewComments() {
  if (!S.myReviews.length) return 0;
  let added = 0;
  try {
    const me = (await authStatus()).user?.id;
    for (const r of S.myReviews.slice(0, 15)) {
      const tid = await reviewTopic(r);
      if (!tid) continue;
      r.seen ||= [];
      for (const x of await loadComments(tid, 1, 30, true)) {
        if ((me && x.user_id === me) || r.seen.includes(x.id)) continue;
        r.seen.push(x.id);
        const nick = x.user?.nickname || 'Кто-то', text = bbText(x.body);
        const href = `#/anime/${r.anime.id}?rvc=${x.id}`;  // тайтл → «Мой отзыв» → этот комментарий
        S.notifications.unshift({ id: uid(), type: 'reply', anime: r.anime, at: Date.now(), read: false, href,
          text: `${nick} прокомментировал твой отзыв: «${text.slice(0, 120)}»` });
        if (S.settings.notifyDesktop !== false) desktop('Комментарий к отзыву', `${nick}: ${text.slice(0, 120)}`, href);
        added++;
      }
    }
  } catch { /* нет сети */ }
  if (added) { S.notifications = S.notifications.slice(0, 300); save(); updateBadge(); }
  return added;
}
function reviewEditor(a, r, onDone) {
  let tone = r?.tone || myOpinion(a.id);
  const b = modal(`<h3 style="margin-top:0">${r ? 'Изменить отзыв' : 'Отзыв на Shikimori'}</h3>
    <p class="muted" style="margin-top:0">«${esc(title(a))}». Отзыв увидят все на Shikimori: его можно отметить «полезно / нет» и прокомментировать.</p>
    <textarea class="input rv-ta" rows="10" maxlength="20000" placeholder="Что понравилось, что нет, кому посоветуешь…">${esc(r?.body || '')}</textarea>
    <div class="muted" style="font-size:12px;margin-top:4px"><span id="rv-n">0</span> символов · нужно не меньше ${REVIEW_MIN}</div>
    <div class="cmp-row"><span class="muted">Какой отзыв?</span>
      <div class="tone-pick">${Object.entries(TONES).map(([k, [i, n]]) => `<button class="btn sm ${k === tone ? 'on' : ''}" data-tone="${k}">${i} ${n}</button>`).join('')}</div></div>
    <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn primary" data-ok>${r ? 'Сохранить' : 'Опубликовать'}</button></div>`, 'rv-modal');
  const ta = $('textarea', b), n = $('#rv-n', b);
  const count = () => { n.textContent = ta.value.trim().length; n.style.color = ta.value.trim().length >= REVIEW_MIN ? '' : 'var(--accent2)'; };
  ta.oninput = count; count(); ta.focus();
  $$('[data-tone]', b).forEach(x => x.onclick = () => { tone = x.dataset.tone; $$('[data-tone]', b).forEach(y => y.classList.toggle('on', y === x)); });
  $('[data-c]', b).onclick = closeModal;
  $('[data-ok]', b).onclick = async e => {
    const body = ta.value.trim();
    if (body.length < REVIEW_MIN) { toast(`Отзыв слишком короткий: ${body.length} из ${REVIEW_MIN} символов`); return; }
    if (!tone) { toast('Выбери, какой это отзыв: положительный, нейтральный или отрицательный'); return; }
    e.target.disabled = true;
    try {
      const j = await postJson('/api/shiki/review', r ? { id: r.id, body, opinion: OPINION[tone] } : { anime_id: a.id, body, opinion: OPINION[tone] });
      if (!j.id) throw new Error(j.error || 'Shikimori не принял отзыв');
      const item = r || { id: j.id, anime: animeSnap(a), at: Date.now(), topicId: null, seen: [] };
      Object.assign(item, { body, tone, up: j.cached_votes_up || 0, down: j.cached_votes_down || 0, comments: j.comments_count || 0 });
      if (!r) S.myReviews.unshift(item);
      S.opinions[a.id] = { tone, anime: item.anime, at: Date.now() };
      save();
      closeModal();
      toast(r ? 'Отзыв обновлён' : 'Отзыв опубликован на Shikimori');
      reviewTopic(item).then(save);
      onDone?.();
    } catch (err) { toast('Не получилось: ' + err.message); e.target.disabled = false; }
  };
}
function reviewCard(r, withTitle = false) {
  return `<div class="review-card" data-rid="${r.id}">
    ${withTitle ? `<a href="#/anime/${r.anime.id}"><img src="${img(r.anime.poster)}" alt=""></a>` : ''}
    <div class="b"><div class="h">${withTitle ? `<a href="#/anime/${r.anime.id}"><b>${esc(title(r.anime))}</b></a>` : ''}
        <span class="tone-pill t-${r.tone}">${TONES[r.tone][0]} ${TONES[r.tone][1]}</span><span class="muted">${fmtWhen(r.at)}</span></div>
      <div class="tx">${esc(r.body)}</div>
      <div class="cm-act"><span class="rv-votes" title="Голоса на Shikimori">👍 ${r.up || 0} · 👎 ${r.down || 0}</span>
        <button class="linkbtn" data-rv="comments" title="Комментарии к отзыву">💬 ${plural(r.comments || 0, 'комментарий', 'комментария', 'комментариев')}</button>
        <button class="linkbtn" data-rv="votes">⟳ Обновить</button><button class="linkbtn" data-rv="edit">Изменить</button>
        <a class="linkbtn" href="https://shikimori.io/animes/${r.anime.id}/reviews/${r.id}" target="_blank" rel="noopener">На Shikimori ↗</a>
        <button class="linkbtn" data-rv="del">Удалить</button></div></div></div>`;
}
function bindReviewCards(root, a) {
  $$('.review-card', root).forEach(el => {
    const r = S.myReviews.find(x => x.id === +el.dataset.rid);
    if (!r) return;
    $('[data-rv=votes]', el).onclick = async e => {
      e.target.disabled = true;
      try { await refreshReview(r); toast(`Голоса: 👍 ${r.up} · 👎 ${r.down}`); route(); } catch (err) { toast('Не удалось: ' + err.message); e.target.disabled = false; }
    };
    $('[data-rv=edit]', el).onclick = () => reviewEditor(a || r.anime, r, () => route());
    $('[data-rv=comments]', el).onclick = () => reviewComments(r);
    $('[data-rv=del]', el).onclick = async () => {
      if (!await confirmBox('Удалить отзыв на Shikimori?', 'Удалить')) return;
      try { await postJson('/api/shiki/review/delete', { id: r.id }); } catch (err) { toast('Не удалось: ' + err.message); return; }
      S.myReviews = S.myReviews.filter(x => x !== r);
      save();
      route();
    };
  });
}
// Комментарии к своему отзыву — окном поверх страницы; hl — какой подсветить (из уведомления)
async function reviewComments(r, hl) {
  const box = modal(`<h3>Комментарии к отзыву</h3><div class="comments rv-cm"><div class="loading">Загрузка…</div></div>
    <div class="row-btns"><a class="sh-link" href="${SHIKI_URL}animes/${r.anime.id}/reviews/${r.id}" target="_blank" rel="noopener">отзыв на Shikimori ↗</a>
      <button class="btn" data-x>Закрыть</button></div>`, 'rvc');
  $('[data-x]', box).onclick = closeModal;
  const list = $('.rv-cm', box);
  try {
    const tid = await reviewTopic(r);
    const cs = tid ? await loadComments(tid, 1, 30, true) : [];
    if (!list.isConnected) return;  // окно уже закрыли
    list.innerHTML = cs.length ? cs.map(commentHtml).join('') : emptyHtml('💬', 'Комментариев пока нет');
    $$('[data-reply]', list).forEach(b => b.remove());  // ответить можно на Shikimori — ссылка у комментария
    bindSpoilers(list);
    const el = hl && $('#c' + hl, list);
    if (el) { el.classList.add('cm-hl'); el.scrollIntoView({ block: 'center' }); }
  } catch (err) { list.innerHTML = ''; list.append(errBlock(err, () => reviewComments(r, hl))); }
}
// блок «Мой отзыв» на странице тайтла
async function renderMyReview(box, a) {
  const au = await authStatus();
  const r = myReview(a.id);
  const again = () => renderMyReview(box, a);
  if (r) {
    box.innerHTML = `<div class="sec-head"><h2>Мой отзыв</h2><span class="sub">на Shikimori</span></div>${opinionPicker(a)}${reviewCard(r)}`;
    bindReviewCards(box, a);
    bindOpinion(box, a, again);
    return;
  }
  const can = au.logged && (au.scope || '').includes('topics');
  box.innerHTML = `<div class="sec-head"><h2>Моё мнение</h2></div>${opinionPicker(a)}
    ${au.logged ? `<div class="hint"><span>✍</span><div>${can ? 'Напиши отзыв на Shikimori — тогда твоё мнение увидят все, как у других отзывов («Положительный», «Нейтральный», «Отрицательный»).'
      : 'Чтобы писать отзывы, поставь галочку <b>topics</b> в своём приложении на Shikimori и войди заново (Настройки → Аккаунт).'}
      ${can ? '<button class="btn primary" id="rv-new" style="margin-left:10px">Написать отзыв</button>' : ''}</div></div>` : ''}`;
  bindOpinion(box, a, again);
  $('#rv-new', box)?.addEventListener('click', () => reviewEditor(a, null, () => route()));
}

// ---- отзывы других зрителей с Shikimori: мнение, оценка автора, голоса «полезно» ----
const SHIKI_OPINION = { positive: 'pos', neutral: 'neu', negative: 'neg' };
async function renderViewerReviews(box, a, alive) {
  let opinion = '', page = 1;
  const counts = c => `<div class="tabs vr-tabs">${[['', 'Все', c.all], ['positive', '👍 Положительные', c.positive], ['neutral', '😐 Нейтральные', c.neutral], ['negative', '👎 Отрицательные', c.negative]]
    .map(([k, n, v]) => `<a class="tab ${k === opinion ? 'on' : ''}" data-op="${k}">${n} <span class="muted">${v || 0}</span></a>`).join('')}</div>`;
  const one = x => {
    const tone = SHIKI_OPINION[x.opinion] || 'neu';
    const rate = x.score ? scoreText(x.score / 2) : '';
    return `<div class="vr-item"><img src="${img(x.user.avatar, 0)}" alt="" onerror="this.src='icon-96.png'"><div class="b">
      <div class="h"><b>${esc(x.user.nickname)}</b><span class="tone-pill t-${tone}">${TONES[tone][0]} ${TONES[tone][1]}</span>
        ${rate || x.status ? `<span class="muted">в списке у автора: ${[x.status && LIST_NAME[FROM_SHIKI[x.status]], rate].filter(Boolean).join(', ')}</span>` : ''}
        <span class="muted" style="margin-left:auto">${fmtWhen(x.created_at)}</span></div>
      <div class="tx vr-tx">${commentBody(x.html)}</div>
      <div class="cm-act"><button class="linkbtn" data-more-tx>Читать полностью</button>
        <span class="rv-votes" title="Полезен ли отзыв — голоса на Shikimori">👍 ${x.up} · 👎 ${x.down}</span>
        <span class="muted">💬 ${x.comments}</span>
        <a class="linkbtn" href="${SHIKI_URL}animes/${a.id}/reviews/${x.id}" target="_blank" rel="noopener">На Shikimori ↗</a></div></div></div>`;
  };
  const load = async (more = false) => {
    const btn = $('[data-vr-more]', box);
    if (btn) btn.disabled = true;
    const d = await fetch(`/api/reviews?id=${a.id}&opinion=${opinion}&page=${page}`).then(r => r.json()).catch(() => ({ error: 'нет связи' }));
    if (!alive()) return;
    if (d.error) { box.innerHTML = `<div class="sec-head"><h2>Отзывы зрителей</h2></div><div class="muted">Не удалось загрузить: ${esc(d.error)}</div>`; return; }
    if (syncMyReviewFrom(a, d.items) && $('#my-review')) renderMyReview($('#my-review'), a);
    if (!more) {
      if (!d.counts.all) { box.innerHTML = ''; return; }
      const share = Math.round(d.counts.positive / d.counts.all * 100);
      box.innerHTML = `<div class="sec-head"><h2>Отзывы зрителей</h2><span class="sub">${share}% советуют</span></div>
        <div class="vr-bar" title="👍 ${d.counts.positive} · 😐 ${d.counts.neutral} · 👎 ${d.counts.negative}">
          <i class="t-pos" style="flex:${d.counts.positive}"></i><i class="t-neu" style="flex:${d.counts.neutral}"></i><i class="t-neg" style="flex:${d.counts.negative}"></i></div>
        ${counts(d.counts)}<div class="vr-list"></div>`;
      $$('.vr-tabs .tab', box).forEach(t => t.onclick = () => { opinion = t.dataset.op; page = 1; load(); });
    }
    $('[data-vr-more]', box)?.remove();
    const list = $('.vr-list', box);
    list.insertAdjacentHTML('beforeend', d.items.map(one).join('') || '<div class="muted">Таких отзывов нет</div>');
    if (!d.done) {
      list.insertAdjacentHTML('afterend', '<button class="btn" data-vr-more style="margin-top:10px">Ещё отзывы</button>');
      $('[data-vr-more]', box).onclick = () => { page++; load(true); };
    }
    $$('.vr-item:not([data-b])', list).forEach(el => {
      el.dataset.b = 1;
      bindSpoilers(el);
      const tx = $('.vr-tx', el), more = $('[data-more-tx]', el);
      if (tx.scrollHeight <= tx.clientHeight + 4) more.remove();
      else more.onclick = () => { tx.classList.add('open'); more.remove(); };
    });
  };
  await load();
}
// Свой отзыв в общем списке: если на сайте поменяли мнение или пришли голоса — подтягиваем в Animax
function syncMyReviewFrom(a, items) {
  const r = myReview(a.id), x = r && items.find(i => i.id === r.id);
  if (!x) return false;
  const tone = SHIKI_OPINION[x.opinion] || r.tone;
  if (tone !== r.tone) S.opinions[a.id] = { tone, anime: r.anime, at: Date.now() };
  const changed = tone !== r.tone || x.up !== r.up || x.down !== r.down;
  Object.assign(r, { tone, up: x.up, down: x.down, comments: x.comments, topicId: r.topicId || x.topic_id });
  save();
  return changed;
}
// вкладка «Отзывы» в профиле
function profileReviews(box) {
  const all = S.myReviews;
  const tile = (n, t) => `<div class="stat-tile"><b>${n}</b><span>${t}</span></div>`;
  box.innerHTML = `<div class="pc-tiles">${tile(all.length, 'отзывов')}${tile(all.reduce((n, r) => n + (r.up || 0), 0), '👍 полезно')}${tile(all.reduce((n, r) => n + (r.down || 0), 0), '👎 не полезно')}${tile(all.reduce((n, r) => n + (r.comments || 0), 0), '💬 комментариев')}</div>
    <div style="display:flex;gap:10px;align-items:center;margin:14px 0"><span class="muted" style="flex:1;font-size:13px">Голоса и комментарии берутся с Shikimori. Написать отзыв — на странице тайтла.</span>
      <button class="btn" id="rv-all" ${all.length ? '' : 'disabled'}>⟳ Обновить все</button></div>
    <div class="pc-list">${all.map(r => reviewCard(r, true)).join('') || emptyHtml('✍', 'Отзывов пока нет', 'Открой тайтл и нажми «Написать отзыв».')}</div>`;
  bindReviewCards(box);
  $('#rv-all').onclick = async e => {
    e.target.disabled = true;
    for (const r of all) { try { await refreshReview(r); await reviewTopic(r); } catch { /* пропускаем */ } }
    toast('Голоса обновлены');
    route();
  };
}
function bindSpoilers(root) { $$('.spoiler', root).forEach(sp => sp.onclick = () => sp.classList.add('open')); }

// ---- отношение комментатора к тайтлу ----
// У комментариев Shikimori нет пометки «положительный / отрицательный», поэтому смотрим на автора:
// мнение его отзыва на этот тайтл (точнее всего), иначе его оценку в открытом списке, иначе «Брошено».
const ATT = new Map();  // `${тайтл}:${пользователь}` → { score, status, opinion }
function attitude(x) {
  if (!x) return null;
  if (x.opinion) return { tone: SHIKI_OPINION[x.opinion], why: 'по его отзыву' };
  if (x.score) return { tone: x.score >= 8 ? 'pos' : x.score >= 5 ? 'neu' : 'neg', why: 'оценка ' + scoreText(x.score / 2) };
  if (x.status === 'dropped') return { tone: 'neg', why: 'бросил' };
  return { tone: null, why: x.status ? LIST_NAME[FROM_SHIKI[x.status]] + ', без оценки' : 'тайтла нет в его списке или список закрыт' };
}
function attHtml(x) {
  const t = attitude(x);
  if (!t) return '';
  return t.tone ? `<span class="tone-pill t-${t.tone}" title="Отношение к тайтлу: ${esc(t.why)}">${TONES[t.tone][0]} ${TONES[t.tone][1]} <small>· ${esc(t.why)}</small></span>`
    : `<span class="tone-pill" title="Отношение к тайтлу неизвестно">? <small>${esc(t.why)}</small></span>`;
}
async function fillAttitudes(root, animeId) {
  const need = [...new Set($$('.att[data-uid]:empty', root).map(e => e.dataset.uid))].filter(u => !ATT.has(`${animeId}:${u}`));
  for (let i = 0; i < need.length; i += 40) {
    const d = await fetch(`/api/attitudes?anime=${animeId}&users=${need.slice(i, i + 40).join(',')}`).then(r => r.json()).catch(() => ({}));
    Object.entries(d).forEach(([u, x]) => ATT.set(`${animeId}:${u}`, x));
  }
  $$('.att[data-uid]:empty', root).forEach(e => { e.innerHTML = attHtml(ATT.get(`${animeId}:${e.dataset.uid}`)); });
}

async function pageComments(view, q, [id], alive) {
  const a = await loadAnime(id);
  if (!alive()) return;
  const order = q.get('sort') === 'old' ? 'old' : 'new';
  const opts = scale10() ? [9, 8, 7, 6, 5].map(n => [n, 'от ' + n + '/10']) : [5, 4, 3, 2].map(n => [n * 2 - 1, 'от ' + n + ' ★']);
  view.innerHTML = `<h1 class="page-title">Комментарии</h1><p class="muted" style="margin-top:-10px">«${esc(title(a))}» · обсуждение на Shikimori</p>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
      <div class="tabs" style="margin:0"><a class="tab ${order === 'new' ? 'on' : ''}" href="#/anime/${id}/comments">Сначала новые</a><a class="tab ${order === 'old' ? 'on' : ''}" href="#/anime/${id}/comments?sort=old">Сначала старые</a></div>
      <a class="btn sm" style="margin-left:auto" href="https://shikimori.io/animes/${id}" target="_blank" rel="noopener">Открыть на Shikimori ↗</a></div>
    <div id="cmp"></div>
    <div class="cm-filter">
      <input class="input" id="cf-q" placeholder="Поиск по комментариям…">
      <div class="tabs" id="cf-t" style="margin:0">${[['', 'Все'], ['pos', '👍'], ['neu', '😐'], ['neg', '👎'], ['none', '?']]
        .map(([k, n]) => `<a class="tab ${k ? '' : 'on'}" data-t="${k}" title="${k ? (TONES[k]?.[1] || 'Отношение неизвестно') : 'Любое отношение'}">${n}</a>`).join('')}</div>
      <select class="input" id="cf-s"><option value="">Оценка автора: любая</option><option value="rated">есть оценка</option>
        ${opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}<option value="low">низкая (${scale10() ? '1–4' : '1–2 ★'})</option></select>
      <span class="muted" id="cf-n"></span></div>
    <div class="muted cf-note">Отношение к тайтлу — по отзыву автора на Shikimori, а если отзыва нет, по его оценке: ${scale10() ? '8–10' : '4–5 ★'} 👍, ${scale10() ? '5–7' : '2.5–3.5 ★'} 😐, ниже 👎.</div>
    <div id="cl"></div>`;
  if (!a.topic?.id) { $('#cl').innerHTML = emptyHtml('💬', 'Обсуждения пока нет'); return; }
  const cmp = await composer($('#cmp'), a, a.topic.id, () => route());
  if (!alive()) return;
  $('#cl').addEventListener('click', e => {
    const b = e.target.closest('[data-reply]');
    if (b) cmp.reply({ id: +b.dataset.reply, uid: +b.dataset.uid, nick: b.dataset.nick });
  });
  // Свой загрузчик вместо pager: при фильтре часть комментариев скрыта, и бесконечная подгрузка
  // могла бы выкачать всё обсуждение. Здесь — кнопка «Ещё» и не больше 5 страниц автоматически.
  const box = $('#cl'), grid = document.createElement('div'), more = document.createElement('div');
  grid.className = 'comments';
  box.append(grid, more);
  let page = 1, done = false, busy = false, total = 0;
  const f = { q: '', t: '', s: '' };
  // ?c=<id> — пришли из уведомления: ищем этот комментарий (до 10 страниц) и подсвечиваем
  const target = /^\d+$/.test(q.get('c') || '') ? q.get('c') : null;
  let seek = target ? 10 : 0;
  const reveal = () => {
    const el = target && $('#c' + target, grid);
    if (!el) return false;
    seek = 0;
    el.classList.add('cm-hl');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  };
  const pass = el => {
    if (f.q && !el.textContent.toLowerCase().includes(f.q)) return false;
    if (!f.t && !f.s) return true;
    const x = ATT.get(`${id}:${el.dataset.uid}`), t = attitude(x);
    if (el.classList.contains('mine')) {  // свой комментарий — по своему мнению и оценке
      const e = S.list[id];
      return (!f.t || (myOpinion(id) || 'none') === f.t) && (!f.s || okScore(e?.score ? Math.round(e.score * 2) : 0));
    }
    if (!x) return false;
    return (!f.t || (t.tone || 'none') === f.t) && (!f.s || okScore(x.score));
  };
  const okScore = sc => f.s === 'rated' ? sc > 0 : f.s === 'low' ? sc > 0 && sc < 5 : sc >= +f.s;
  const apply = () => {
    let shown = 0;
    $$('.cm', grid).forEach(el => { const ok = pass(el); el.hidden = !ok; shown += ok; });
    $('#cf-n').textContent = f.q || f.t || f.s ? `показано ${shown} из ${total}` : '';
    return shown;
  };
  async function load(auto = 0) {
    if (busy || done || !alive()) return;
    busy = true;
    more.innerHTML = '<div class="loading">Загрузка…</div>';
    try {
      const list = await loadComments(a.topic.id, page, PAGE, order === 'new');
      if (!alive()) return;
      grid.insertAdjacentHTML('beforeend', list.map(commentHtml).join(''));
      bindSpoilers(grid);
      total += list.length;
      page++;
      done = list.length < PAGE;
      apply();
      if (seek) reveal();  // к комментарию из уведомления — сразу, не дожидаясь «отношения» авторов
      if (f.t || f.s) more.innerHTML = '<div class="loading">Смотрю, как авторы относятся к тайтлу…</div>';
      await fillAttitudes(grid, id);
      if (!alive()) return;
    } catch (err) {
      more.innerHTML = '';
      more.append(errBlock(err, () => { busy = false; load(); }));
      busy = false;
      return;
    }
    busy = false;
    const shown = apply();
    more.innerHTML = done ? (total ? '' : emptyHtml('💬', 'Комментариев пока нет'))
      : '<button class="btn" data-more>Ещё комментарии</button>';
    if (done && total && !shown) more.innerHTML = emptyHtml('🔍', 'Ничего не найдено', 'Попробуй изменить условия.');
    $('[data-more]', more)?.addEventListener('click', () => load());
    if (seek && !reveal()) { if (!done && --seek) return load(auto); toast('Комментарий не нашёлся — возможно, его удалили'); seek = 0; }
    if (!done && shown < 10 && auto < 5) load(auto + 1);  // под фильтр подошло мало — подгружаем ещё
  }
  const refilter = () => { if (apply() < 10 && !done) load(1); };
  $('#cf-q').addEventListener('input', debounce(e => { f.q = e.target.value.trim().toLowerCase(); refilter(); }, 250));
  $$('#cf-t .tab').forEach(t => t.onclick = () => { f.t = t.dataset.t; $$('#cf-t .tab').forEach(x => x.classList.toggle('on', x === t)); refilter(); });
  $('#cf-s').onchange = e => { f.s = e.target.value; refilter(); };
  load();
}

async function pageVideos(view, q, [id], alive) {
  const a = await loadAnime(id);
  if (!alive()) return;
  const vids = (a.videos || []).filter(v => youtubeId(v.playerUrl) || youtubeId(v.url));
  const groups = {};
  vids.forEach((v, i) => (groups[VIDEO_KINDS[v.kind] ? v.kind : 'other'] ??= []).push([v, i]));
  view.innerHTML = `<h1 class="page-title">Видео</h1><p class="muted" style="margin-top:-10px">«${esc(title(a))}» · официальные ролики</p>
    ${Object.keys(VIDEO_KINDS).filter(k => groups[k]).map(k => `<div class="section"><h3>${VIDEO_KINDS[k]} <small class="muted">${groups[k].length}</small></h3><div class="videos">
      ${groups[k].sort((x, y) => (+x[0].name || 0) - (+y[0].name || 0)).map(([v, i]) => `<div class="video" data-v="${i}"><div class="th"><img loading="lazy" src="${img(v.imageUrl)}" alt=""></div><div class="t">${esc(videoName(v))}</div></div>`).join('')}</div></div>`).join('')
      || emptyHtml('🎞', 'Видео пока нет')}`;
  $$('.video', view).forEach(el => el.onclick = () => openVideo(vids[+el.dataset.v]));
}

async function pageRelated(view, q, [id], alive) {
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  const [a, d] = await Promise.all([loadAnime(id), gql(animes({ ids: String(id), limit: 1, rating: '' }, `chronology { ${CARD} }`))]);
  if (!alive()) return;
  let list = (d.animes[0]?.chronology || []).map(snap);
  if (!list.some(x => x.id === +id)) list.push(snap(a));
  list.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
  const rel = Object.fromEntries((a.related || []).filter(r => r.anime).map(r => [+r.anime.id, r.relationText]));
  view.innerHTML = `<div class="fr-head"><div class="stack">${list.slice(0, 3).map(x => `<img src="${img(x.poster)}" alt="">`).join('')}</div>
      <div><div class="muted">Хронология франшизы</div><h1 class="page-title" style="margin:2px 0">${esc(title(a))}</h1><div class="muted">${plural(list.length, 'тайтл', 'тайтла', 'тайтлов')} по порядку выхода</div></div></div>
    <div class="timeline">${list.map(x => `<div class="tl ${x.id === +id ? 'here' : ''}"><div class="ln"></div>
      ${wideCard(x, `${esc(metaLine(x))}${x.score ? ' · ★ ' + x.score : ''}${rel[x.id] ? ' · ' + esc(rel[x.id]) : ''}${S.list[x.id]?.status ? ` · <b style="color:${LIST_COLOR[S.list[x.id].status]}">${LIST_NAME[S.list[x.id].status]}</b>` : ''}${x.id === +id ? '<span class="here-tag">Ты здесь</span>' : ''}`)}</div>`).join('')}</div>`;
}

function pageAnimeCollections(view, q, [id]) {
  const list = S.collections.filter(c => c.items.some(x => x.id === +id));
  view.innerHTML = `<h1 class="page-title">Коллекции с этим тайтлом</h1>
    ${list.length ? `<div class="grid colls">${list.map(collCard).join('')}</div>` : emptyHtml('▣', 'Пока ни в одной коллекции')}
    <div style="margin-top:20px"><button class="btn primary" id="add">＋ Добавить в коллекцию</button></div>`;
  $('#add').onclick = () => collectionPicker(SNAPS.get(+id) || S.list[id]?.anime || { id: +id });
}
