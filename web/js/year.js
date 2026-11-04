'use strict';
// Анимир — «Мой год в аниме»: итоги года из журнала отмеченных серий (S.watchLog).
// Всё считается на месте, из своих данных; из сети — только студии (их нет в сохранённых карточках).

const YEAR_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const epMinutes = a => a.duration || (a.kind === 'movie' ? 100 : 24);
// Номер дня по календарю, а не по миллисекундам: при переводе часов сутки бывают 23 и 25 часов
const dayNo = t => { const d = new Date(t); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };

function yearStats(y) {
  const from = new Date(y, 0, 1).getTime(), to = new Date(y + 1, 0, 1).getTime();
  const log = S.watchLog.filter(w => w.at >= from && w.at < to);
  const animeOf = id => S.list[id]?.anime || SNAPS.get(+id) || { id: +id, russian: '', name: '', duration: 0 };
  const per = new Map();
  log.forEach(w => per.set(w.id, (per.get(w.id) || 0) + 1));
  const months = Array(12).fill(0);
  log.forEach(w => months[new Date(w.at).getMonth()]++);
  // самая длинная серия дней подряд, когда смотрел хоть что-то
  const days = [...new Set(log.map(w => dayNo(w.at)))].sort((a, b) => a - b);
  let streak = 0, run = 0;
  days.forEach((d, i) => { run = i && d === days[i - 1] + 1 ? run + 1 : 1; streak = Math.max(streak, run); });
  const genres = {};
  [...per.keys()].forEach(id => (animeOf(id).genres || []).forEach(g => genres[g] = (genres[g] || 0) + 1));
  const done = Object.values(S.list).filter(e => e.status === 'completed' && e.statusAt >= from && e.statusAt < to);
  return {
    eps: log.length,
    minutes: log.reduce((n, w) => n + epMinutes(animeOf(w.id)), 0),
    titles: [...per].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ a: animeOf(id), n })),
    months, streak, done,
    days: days.length,
    night: log.filter(w => new Date(w.at).getHours() < 5).length,
    genres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 8),
    best: done.filter(e => e.score).sort((a, b) => b.score - a.score)[0] || null,
  };
}

async function pageYear(view, q, _m, alive) {
  const now = new Date().getFullYear();
  const years = [...new Set([now, ...S.watchLog.map(w => new Date(w.at).getFullYear())])].sort((a, b) => b - a);
  const y = +q.get('y') || now;
  const st = yearStats(y);
  document.title = `Мой ${y} в аниме · Анимир`;
  const chips = years.length > 1 ? `<div class="chips">${years.map(n => `<a class="chip ${n === y ? 'on' : ''}" href="#/year?y=${n}">${n}</a>`).join('')}</div>` : '';
  if (!st.eps) {
    view.innerHTML = `<h1 class="page-title">Мой ${y} в аниме</h1>${chips}
      ${emptyHtml('🎆', 'За этот год серий не отмечено', 'Отмечай просмотренные серии (или досматривай их в плеере) — здесь соберутся итоги года.')}`;
    return;
  }
  const peak = st.months.indexOf(Math.max(...st.months));
  const maxM = st.months[peak] || 1, maxG = st.genres[0]?.[1] || 1;
  const nameOf = a => a.id && (a.russian || a.name) ? title(a) : 'Тайтл ' + a.id;
  const stat = (k, v, label) => `<div class="stat"><b data-stat="${k}">${v}</b><span>${label}</span></div>`;
  view.innerHTML = `
    <section class="year-hero"><div class="yh-in">
      <div class="yh-y">${y}</div>
      <div><h1>Мой год в аниме</h1>
        <p>${plural(st.eps, 'серия', 'серии', 'серий')} за ${plural(st.days, 'день', 'дня', 'дней')} просмотра${st.genres[0] ? ` · больше всего — «${esc(st.genres[0][0])}»` : ''}</p></div>
    </div>${chips}</section>
    <div class="stats">
      ${stat('eps', st.eps, 'Серий отмечено')}
      ${stat('time', fmtDuration(st.minutes), 'Времени за экраном')}
      ${stat('titles', st.titles.length, 'Разных тайтлов')}
      ${stat('done', st.done.length, 'Досмотрено целиком')}
      ${stat('streak', st.streak, 'Дней подряд — рекорд')}
    </div>
    <div class="year-cols">
      <div><div class="sec-head"><h2>По месяцам</h2><span class="sub" data-peak-month>пик — ${YEAR_MONTHS[peak].toLowerCase()} · ${plural(st.months[peak], 'серия', 'серии', 'серий')}</span></div>
        <div class="people"><div class="days-bars months">${st.months.map((n, i) => `<div class="d${i === peak ? ' peak' : ''}" title="${YEAR_MONTHS[i]}: ${n}">${n ? `<b>${n}</b>` : ''}<i style="height:${n / maxM * 100}%"></i>${YEAR_MONTHS[i].slice(0, 3)}</div>`).join('')}</div></div></div>
      <div><div class="sec-head"><h2>Жанры года</h2></div>
        ${st.genres.length ? `<div class="bars">${st.genres.map(([g, n], i) => `<div class="r"><span ${i ? '' : 'data-top-genre'}>${esc(g)}</span><div class="tr"><i style="width:${n / maxG * 100}%"></i></div><b>${n}</b></div>`).join('')}</div>`
          : '<div class="muted">Жанры появятся, когда тайтлы будут в закладках.</div>'}
        <div id="y-studios"></div></div>
    </div>
    <div class="sec-head"><h2>Чаще всего смотрел</h2></div>
    <div class="list cols">${st.titles.slice(0, 6).map(({ a, n }, i) => `<div data-top-title>${wideCard(a, `<b>#${i + 1}</b> · ${plural(n, 'серия', 'серии', 'серий')} · ${fmtDuration(n * epMinutes(a))}`)}</div>`).join('')}</div>
    <div class="year-facts">
      ${st.best ? `<div class="hint"><span>★</span><div>Лучшее из досмотренного: <a class="linkbtn" href="#/anime/${st.best.anime.id}">${esc(nameOf(st.best.anime))}</a> — ${scoreText(st.best.score)}</div></div>` : ''}
      ${st.night ? `<div class="hint"><span>🌙</span><div>Ночная сова: ${Math.round(st.night / st.eps * 100)}% серий — после полуночи и до пяти утра.</div></div>` : ''}
    </div>`;
  yearStudios(st.titles.map(t => t.a.id).filter(Boolean), alive);
}

// Студии — отдельным запросом: в сохранённых карточках их нет. Нет сети — раздел просто не появится.
async function yearStudios(ids, alive) {
  if (!ids.length) return;
  try {
    const count = {};
    for (let i = 0; i < ids.length; i += 50) {
      const d = await gql(animes({ ids: ids.slice(i, i + 50).join(','), limit: 50, rating: '' }, 'id studios { name }'));
      d.animes.forEach(a => (a.studios || []).forEach(s => count[s.name] = (count[s.name] || 0) + 1));
    }
    const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const box = $('#y-studios');
    if (!alive() || !box || !top.length) return;
    box.innerHTML = `<div class="sec-head"><h2>Студии</h2></div><div class="chips">${top.map(([s, n]) => `<span class="chip">${esc(s)} · ${n}</span>`).join('')}</div>`;
  } catch { /* без студий итоги всё равно полные */ }
}
