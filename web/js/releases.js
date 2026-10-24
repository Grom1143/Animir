'use strict';
// Animax — расписание, релизы, уведомления.

// ================= Расписание =================
async function pageSchedule(view, q, _, alive) {
  view.innerHTML = '<div class="loading">Загрузка расписания…</div>';
  const mine = q.get('mine') === '1';
  const since = Date.now() - 6 * 3600e3;
  const cal = (await rest('/api/calendar')).filter(it => new Date(it.next_episode_at) >= since);
  const snaps = await fillPosters(cal.map(it => snap(it.anime)));
  if (!alive()) return;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const today = new Date().getDay();
  const byDay = new Map(order.map(d => [d, []]));
  cal.forEach((it, i) => {
    const a = snaps[i];
    if (mine && !S.list[a.id]?.status && !subOn(a.id)) return;
    const at = new Date(it.next_episode_at);
    byDay.get(at.getDay()).push({ a, at, ep: it.next_episode });
  });
  // начинаем с сегодняшнего дня
  const days = [...order.slice(order.indexOf(today)), ...order.slice(0, order.indexOf(today))];
  view.innerHTML = `<h1 class="page-title">Расписание</h1>
    ${hint('schedule', 'Указаны дни и время выхода новых серий в Японии и Китае (по твоему часовому поясу). Переводы появляются позже.')}
    <div class="tabs"><a class="tab ${mine ? '' : 'on'}" href="#/schedule">Все онгоинги</a><a class="tab ${mine ? 'on' : ''}" href="#/schedule?mine=1">Только мои</a></div>
    <div class="days">${days.map(d => {
      const list = byDay.get(d).sort((x, y) => x.at - y.at);
      if (!list.length) return '';
      const date = list[0].at;
      return `<div class="day ${d === today ? 'today' : ''}"><h3>${d === today ? '● Сегодня, ' + names[d].toLowerCase() : names[d]} <small>${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · ${plural(list.length, 'серия', 'серии', 'серий')}</small></h3>
        <div class="list cols">${list.map(({ a, at, ep }) => wideCard(a, `${ep}-я серия · ${KIND[a.kind] || ''}${a.score ? ' · ★ ' + a.score : ''}${S.list[a.id]?.status ? ` · <b style="color:${LIST_COLOR[S.list[a.id].status]}">${LIST_NAME[S.list[a.id].status]}</b>` : ''}`,
          `#/anime/${a.id}`, `<div class="time">${at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>`)).join('')}</div></div>`;
    }).join('') || emptyHtml('▦', 'Ничего не найдено', 'Добавь онгоинги в закладки или включи уведомления на странице тайтла.')}</div>`;
}

// ================= Релизы: анонсы, онгоинги, завершённые =================
// Фильтр «Аниме / Донхуа». У Shikimori нет поля «страна», поэтому донхуа определяем приблизительно:
// оригинальное название иероглифами без японской азбуки и латинское название без типично японских сочетаний.
const ROMAJI = /tsu|\b(no|wa|ga|to|ka)\b|ky|ry[ou]|([kstpgbdmr])\2|aa|ii|uu|ee|oo|[tskdjz]o(?!u|ng)|(?:^|[^aeiou])[nrg]o(?!u|ng)|[srt]ei|jou/i;
const ROMAN = /(?<![A-Za-z])[IVX]+(?![A-Za-z])|[Ⅰ-Ⅻ]/g;
const EN_WORDS = /(\d+(st|nd|rd|th) )?season|\bpart\b|\bmovie\b|\bshort films?\b|\bspecials?\b/gi;
function isDonghua(a) {
  const j = (a.japanese || '').replace(ROMAN, '');
  if (!/[\u4e00-\u9fff]/.test(j) || /[\u3040-\u30ff]/.test(j)) return false;  // нет иероглифов или есть японская азбука
  if (/[A-Za-z]{3}/.test(j) || /期|劇/.test(j)) return false;  // латиница в оригинале, японские «第2期» и «劇場版»
  return !ROMAJI.test((a.name || '').replace(ROMAN, '').replace(EN_WORDS, ''));
}
const RL_FIELDS = 'id russian name kind score status episodes episodesAired japanese airedOn{year month day date} releasedOn{year month day date} poster{mainUrl main2xUrl originalUrl}';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS1 = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
// Неполная дата Shikimori: известен день, месяц, только год или ничего
const partDate = d => !d?.year ? '' : d.day ? `${d.day} ${MONTHS[d.month - 1]} ${d.year}` : d.month ? `${MONTHS1[d.month - 1]} ${d.year}` : `${d.year} год`;
function rlSnap(x) {
  const a = snap(x);
  a.japanese = x.japanese || '';
  a.donghua = isDonghua(x);
  a.airedText = partDate(x.airedOn);
  a.airedKey = x.airedOn?.year ? (x.airedOn.year * 100 + (x.airedOn.month || 13)) * 100 + (x.airedOn.day || 0) : 99999999;
  a.releasedText = partDate(x.releasedOn);
  return a;
}
let ongoingCache = null;  // { at, list } — все онгоинги, чтобы вкладки переключались мгновенно
async function allOngoing() {
  if (ongoingCache && Date.now() - ongoingCache.at < 10 * 60 * 1000) return ongoingCache.list;
  const list = [];
  for (let page = 1; page <= 8; page++) {
    const d = await gql(animes({ status: 'ongoing', kind: 'tv,ona,ova,movie,special', order: 'popularity', limit: 50, page }, RL_FIELDS));
    list.push(...d.animes.map(rlSnap));
    if (d.animes.length < 50) break;
  }
  ongoingCache = { at: Date.now(), list };
  return list;
}
function logFinished(a) {
  S.finishedLog = [{ ...stripEmpty(a), at: Date.now() }, ...(S.finishedLog || []).filter(x => x.id !== +a.id)].slice(0, 300);
}
function rlItem(a, mode) {
  const follow = mode !== 'finished' && a.status !== 'released';
  const meta = mode === 'anons' ? (a.airedText ? '📅 ' + a.airedText : '📅 скоро')
    : mode === 'finished' ? `${a.releasedText ? '🏁 ' + a.releasedText : '🏁 вышел'}${a.episodes ? ' · ' + plural(a.episodes, 'серия', 'серии', 'серий') : ''}`
    : `${a.episodesAired || 0}${a.episodes ? ' из ' + a.episodes : ''} эп.`;
  return `<div class="rl-item">${card(a, { meta: (a.donghua ? '🇨🇳 ' : '') + meta })}
    ${follow ? `<label class="rl-follow" title="Уведомлять о новых сериях"><span>${mode === 'anons' ? 'Следить' : 'Уведомлять'}</span>
      <span class="switch"><input type="checkbox" data-follow="${a.id}" ${subOn(a.id) || S.settings.notifyLists.includes(S.list[a.id]?.status) && subMode(a.id) !== 'off' ? 'checked' : ''}><span></span></span></label>` : ''}</div>`;
}
// «Релизы» теперь живут на главной (вкладки Онгоинги / Анонсы / Завершённые); старый адрес ведёт туда же
const RL_HOME = { anons: 'anons', ongoing: 'ongoing', finished: 'released' };
function pageReleases(view, q) {
  const tab = RL_HOME[q.get('tab')] || 'anons';
  history.replaceState({ d: navDepth() }, '', `#/?tab=${tab}${q.get('k') ? '&k=' + q.get('k') : ''}`);
  route();
}
const RL_KINDS = { all: 'Всё', anime: 'Аниме', donghua: 'Донхуа' };
// Список релизов: даты выхода, тумблер «Следить», фильтр аниме/донхуа. mode: anons | ongoing | finished
async function releasesList(box, mode, kind, alive) {
  const pass = a => kind === 'all' || (kind === 'donghua') === !!a.donghua;
  const tab = mode;
  box.addEventListener('change', e => {
    const id = e.target.dataset.follow;
    if (!id) return;
    const a = SNAPS.get(+id);
    setSub(a, e.target.checked ? 'each' : 'off');
    toast(e.target.checked ? 'Будем сообщать о выходе серий' : 'Уведомления по тайтлу отключены');
  });
  box.addEventListener('click', e => { if (e.target.closest('.rl-follow')) e.stopPropagation(); });
  if (tab === 'anons') {
    box.innerHTML = '';
    let shownPages = 0;
    pager(box, async page => {
      const d = await gql(animes({ status: 'anons', order: 'popularity', limit: 50, page }, RL_FIELDS));
      shownPages++;
      const items = d.animes.map(rlSnap).filter(pass);
      return { items, done: d.animes.length < 50 || shownPages >= 15 };
    }, a => rlItem(a, 'anons'), alive);
    return;
  }
  if (tab === 'ongoing') {
    const list = (await allOngoing()).filter(pass);
    if (!alive()) return;
    box.innerHTML = list.length ? `<div class="muted rl-count">${plural(list.length, 'тайтл выходит', 'тайтла выходят', 'тайтлов выходят')} сейчас</div>
      <div class="grid">${list.map(a => rlItem(a, 'ongoing')).join('')}</div>` : emptyHtml('📺', 'Ничего не нашлось');
    return;
  }
  // завершённые: то, что Animax заметил сам (журнал), + вышедшее за этот и прошлый сезон
  const prev = currentSeason(new Date(Date.now() - 92 * 864e5));
  const d = await gql(animes({ status: 'released', season: `${currentSeason()},${prev}`, kind: 'tv,ona', order: 'popularity', limit: 50 }, RL_FIELDS));
  if (!alive()) return;
  const seen = new Set();
  const list = [...(S.finishedLog || []), ...d.animes.map(rlSnap)].filter(a => !seen.has(a.id) && seen.add(a.id)).filter(pass);
  box.innerHTML = list.length ? `<div class="grid">${list.map(a => rlItem(a, 'finished')).join('')}</div>`
    : emptyHtml('🏁', 'Пока пусто', 'Сюда попадают онгоинги, которые вышли полностью.');
}

// ================= Уведомления =================
const finishedSeen = new Set();  // о каких тайтлах уже сказали «вышла последняя серия» в этом запуске
async function checkNewEpisodes(silent = false) {
  try { await checkReleases(silent); } catch { /* нет сети — попробуем позже */ }
  if (!S.settings.notify) return;
  const lists = new Set(S.settings.notifyLists);
  const ids = new Set();
  Object.values(S.list).forEach(e => { if (lists.has(e.status) && e.anime.status !== 'released' && subMode(e.anime.id) !== 'off') ids.add(e.anime.id); });
  Object.values(S.subs).forEach(x => { if (x.status !== 'released' && subMode(x.id) !== 'off') ids.add(x.id); });
  if (!ids.size && !Object.keys(S.subsDub || {}).length) return;
  try {
    const all = [...ids];
    let added = 0;
    for (let i = 0; i < all.length; i += 50) {
      const d = await gql(animes({ ids: all.slice(i, i + 50).join(','), limit: 50, rating: '' }, CARD));
      for (const a of d.animes) {
        const fresh = snap(a);
        const old = S.list[a.id]?.anime || S.subs[a.id];
        if (!old) continue;
        const from = old.episodesAired || 0, to = fresh.episodesAired;
        const push = (text, type, ep) => { S.notifications.unshift({ id: uid(), type, anime: fresh, ep, at: Date.now(), read: false, text }); if (S.settings.notifyDesktop !== false) desktop(fresh.russian || fresh.name || 'Animax', text, `#/anime/${fresh.id}`); added++; };
        const final = subMode(a.id) === 'final';
        if (old.status && old.status !== 'released' && fresh.status === 'released') {
          logFinished(fresh);
          if (!finishedSeen.has(+a.id)) push(`Вышла последняя серия — можно смотреть целиком${fresh.episodes ? ` (${plural(fresh.episodes, 'серия', 'серии', 'серий')})` : ''}`, 'release', to);
          finishedSeen.add(+a.id);
        } else if (old.status === 'anons' && fresh.status === 'ongoing') push('Начался показ', 'release', to);
        else if (to > from && old.status && !final) {
          if (S.settings.notifyOne || to - from === 1) push(to - from === 1 ? `Вышла ${to}-я серия` : `Вышли серии ${from + 1}–${to}`, 'episode', to);
          else for (let n = from + 1; n <= to; n++) push(`Вышла ${n}-я серия`, 'episode', n);
        }
        if (S.list[a.id]) S.list[a.id].anime = { ...old, ...stripEmpty(fresh) };
        if (S.subs[a.id]) S.subs[a.id] = { ...S.subs[a.id], ...stripEmpty(fresh) };
      }
    }
    S.notifications = S.notifications.slice(0, 300);
    // подписки на конкретную озвучку: следим за числом серий именно у этой озвучки
    let dubAdded = 0;
    for (const sub of Object.values(S.subsDub || {})) {
      try {
        const dubs = await onlineDubs(sub.anime);
        // подписка могла остаться на старой записи студии (AniDUB Online → AniDUB) — переводим её
        let cur = dubs.find(x => x.key === sub.dub);
        if (!cur && sub.dubLabel) cur = dubs.find(x => dubKey(x.label) === dubKey(sub.dubLabel));
        if (!cur) continue; // озвучки пока нет — подождём
        if (cur.key !== sub.dub) { sub.dub = cur.key; sub.dubLabel = cur.label; }
        if (cur.count > (sub.ep || 0)) {
          const from = (sub.ep || 0) + 1, to = cur.count;
          const note = (n, text) => {
            const href = `#/watch?o=${sub.id}&d=${encodeURIComponent(sub.dub)}&e=${n}`;
            S.notifications.unshift({ id: uid(), type: 'episode', anime: sub.anime, ep: n, at: Date.now(), read: false, text, href });
            if (S.settings.notifyDesktop !== false) desktop(sub.anime.russian || sub.anime.name || 'Animax', text, href);
            dubAdded++;
          };
          if (!sub.ep) note(to, `Появилась озвучка «${sub.dubLabel}»: ${plural(to, 'серия', 'серии', 'серий')}`);
          else if (S.settings.notifyOne || to === from) note(to, to === from ? `Вышла ${to}-я серия — ${sub.dubLabel}` : `Вышли серии ${from}–${to} — ${sub.dubLabel}`);
          else for (let n = from; n <= to; n++) note(n, `Вышла ${n}-я серия — ${sub.dubLabel}`);
          sub.ep = cur.count;
        }
      } catch { /* источник недоступен — попробуем позже */ }
    }
    if (dubAdded) {
      S.notifications = S.notifications.slice(0, 300);
      added += dubAdded;
    }
    save();
    updateBadge();
    if (added && !silent) toast(`Новые серии: ${added}. Загляни в уведомления 🔔`);
  } catch { /* нет сети — попробуем позже */ }
}
// Новые релизы (не только из закладок): следим за популярными онгоингами.
// Новый онгоинг, начавшийся недавно, — «премьера»; онгоинг, который сменил статус на «вышел», — «вышел полностью».
// Первый запуск только запоминает текущие онгоинги, чтобы не завалить уведомлениями.
async function checkReleases(silent) {
  const st = S.settings;
  if (!st.notify || (!st.notifyPremieres && !st.notifyFinished)) return;
  const w = S.releaseWatch ||= { ids: [], seeded: false };
  if (Date.now() - (w.at || 0) < 25 * 60 * 1000) return;  // чаще раза в полчаса не нужно
  const now = [];
  for (let page = 1; page <= 4; page++) {
    const d = await gql(animes({ status: 'ongoing', kind: 'tv,ona', order: 'popularity', limit: 50, page }, CARD));
    now.push(...d.animes.map(snap));
    if (d.animes.length < 50) break;
  }
  const nowIds = new Set(now.map(a => a.id)), known = new Set(w.ids);
  const out = { premiere: [], finished: [] };
  if (w.seeded) {
    if (st.notifyPremieres) now.forEach(a => {
      const started = Date.parse(a.date || '') || 0;
      if (!known.has(a.id) && Date.now() - started < 21 * 864e5) out.premiere.push(a);  // начался недавно, а не просто стал популярнее
    });
    const gone = w.ids.filter(id => !nowIds.has(id));
    for (let i = 0; i < gone.length; i += 50) {
      const d = await gql(animes({ ids: gone.slice(i, i + 50).join(','), limit: 50, rating: '' }, RL_FIELDS));
      d.animes.map(rlSnap).filter(a => a.status === 'released').forEach(a => out.finished.push(a));
    }
    if (!st.notifyFinished) out.finished = [];
  }
  // помним и ушедшие из топа онгоинги, пока они не вышли — иначе пропустим их финал
  const stillOngoing = w.ids.filter(id => !nowIds.has(id) && !out.finished.some(a => a.id === id));
  w.ids = [...nowIds, ...stillOngoing].slice(0, 400);
  w.seeded = true;
  w.at = Date.now();
  const note = (a, text) => S.notifications.unshift({ id: uid(), type: 'release', anime: a, at: Date.now(), read: false, text });
  out.premiere.forEach(a => note(a, `Премьера: начался показ${a.episodes ? ` (${plural(a.episodes, 'серия', 'серии', 'серий')})` : ''}. Понравится — нажми 🔔 на странице тайтла`));
  out.finished = out.finished.filter(a => !finishedSeen.has(a.id));
  out.finished.forEach(a => { finishedSeen.add(a.id); logFinished(a); note(a, `Вышел полностью${a.episodes ? ` — все ${plural(a.episodes, 'серия', 'серии', 'серий')}` : ''}. Можно смотреть целиком`); });
  const n = out.premiere.length + out.finished.length;
  if (n) {
    S.notifications = S.notifications.slice(0, 300);
    if (st.notifyDesktop !== false) {
      // один тайтл — клик ведёт на него, несколько — в список уведомлений
      const one = (list, head) => list.length === 1 ? desktop(head, title(list[0]), `#/anime/${list[0].id}`) : list.length && desktop(head, list.slice(0, 3).map(title).join(', ') + (list.length > 3 ? ` и ещё ${list.length - 3}` : ''));
      one(out.premiere, 'Премьера аниме');
      one(out.finished, 'Аниме вышло полностью');
    }
    if (!silent) toast(`Новые релизы: ${n}. Загляни в уведомления 🔔`);
  }
  save();
  updateBadge();
}
function updateBadge() {
  const n = S.notifications.filter(x => !x.read).length;
  const b = $('#notif-badge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
}
function pageNotifications(view, q) {
  const f = q.get('f') || 'all';
  const list = S.notifications.filter(n => f === 'all' || (n.type || 'episode') === f);
  view.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h1 class="page-title" style="margin:0;flex:1">Уведомления</h1>
      <button class="btn" id="check">⟳ Проверить</button><button class="icon-btn" id="clear" title="Очистить все">🗑</button></div>
    <div class="tabs" style="margin-top:16px">${[['all', 'Все уведомления'], ['episode', 'Только серии'], ['release', 'Только релизы'], ['reply', 'Ответы']].map(([k, n]) => `<a class="tab ${k === f ? 'on' : ''}" href="#/notifications?f=${k}">${n}</a>`).join('')}</div>
    ${S.settings.notify ? '' : '<div class="hint"><span>🔕</span><div>Уведомления выключены. <a class="linkbtn" href="#/settings?s=notify">Открыть настройки</a></div></div>'}
    <div class="list">${list.map(n => `<a class="notif ${n.read ? '' : 'new'}" href="${n.href || '#/anime/' + n.anime.id}" data-aid="${n.anime.id}"><img src="${img(n.anime.poster, 120)}" alt="">
      <div class="b"><div><b>${esc(title(n.anime))}</b></div><div>${{ episode: '📺 ', reply: '💬 ' }[n.type || 'episode'] || '🎬 '}${esc(n.text)}</div><div class="m">${ago(n.at)}</div></div>${n.read ? '' : '<span style="color:var(--accent2)">●</span>'}</a>`).join('')
      || emptyHtml('🔔', 'Нет уведомлений', 'Animax сообщит о новых сериях тайтлов из закладок и тех, где ты нажал 🔔, а ещё о премьерах и вышедших полностью аниме.')}</div>`;
  list.forEach(n => n.read = true);
  list.forEach(n => SNAPS.set(n.anime.id, n.anime));
  save();
  updateBadge();
  $('#check').onclick = async () => { $('#check').disabled = true; if (S.releaseWatch) S.releaseWatch.at = 0; await Promise.all([checkNewEpisodes(), checkReplies()]); route(); };
  $('#clear').onclick = async () => { if (await confirmBox('Удалить все уведомления?', 'Удалить')) { S.notifications = []; save(); route(); } };
}
