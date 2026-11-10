'use strict';
// Анимир - «Мой год в аниме»: итоги года из журнала отмеченных серий (S.watchLog).
// Всё считается на месте, из своих данных; из сети - только студии (их нет в сохранённых карточках).

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
      ${emptyHtml('🎆', 'За этот год серий не отмечено', 'Отмечай просмотренные серии (или досматривай их в плеере) - здесь соберутся итоги года.')}`;
    return;
  }
  const peak = st.months.indexOf(Math.max(...st.months));
  const maxM = st.months[peak] || 1, maxG = st.genres[0]?.[1] || 1;
  const nameOf = a => a.id && (a.russian || a.name) ? title(a) : 'Тайтл ' + a.id;
  const stat = (k, v, label) => `<div class="stat"><b data-stat="${k}">${v}</b><span>${label}</span></div>`;
  view.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin:-10px 0 12px"><button class="btn" id="y-card">🖼 Поделиться картинкой</button></div>
    <section class="year-hero"><div class="yh-in">
      <div class="yh-y">${y}</div>
      <div><h1>Мой год в аниме</h1>
        <p>${plural(st.eps, 'серия', 'серии', 'серий')} за ${plural(st.days, 'день', 'дня', 'дней')} просмотра${st.genres[0] ? ` · больше всего - «${esc(st.genres[0][0])}»` : ''}</p></div>
    </div>${chips}</section>
    <div class="stats">
      ${stat('eps', st.eps, 'Серий отмечено')}
      ${stat('time', fmtDuration(st.minutes), 'Времени за экраном')}
      ${stat('titles', st.titles.length, 'Разных тайтлов')}
      ${stat('done', st.done.length, 'Досмотрено целиком')}
      ${stat('streak', st.streak, 'Дней подряд - рекорд')}
    </div>
    <div class="year-cols">
      <div><div class="sec-head"><h2>По месяцам</h2><span class="sub" data-peak-month>пик - ${YEAR_MONTHS[peak].toLowerCase()} · ${plural(st.months[peak], 'серия', 'серии', 'серий')}</span></div>
        <div class="people"><div class="days-bars months">${st.months.map((n, i) => `<div class="d${i === peak ? ' peak' : ''}" title="${YEAR_MONTHS[i]}: ${n}">${n ? `<b>${n}</b>` : ''}<i style="height:${n / maxM * 100}%"></i>${YEAR_MONTHS[i].slice(0, 3)}</div>`).join('')}</div></div></div>
      <div><div class="sec-head"><h2>Жанры года</h2></div>
        ${st.genres.length ? `<div class="bars">${st.genres.map(([g, n], i) => `<div class="r"><span ${i ? '' : 'data-top-genre'}>${esc(g)}</span><div class="tr"><i style="width:${n / maxG * 100}%"></i></div><b>${n}</b></div>`).join('')}</div>`
          : '<div class="muted">Жанры появятся, когда тайтлы будут в закладках.</div>'}
        <div id="y-studios"></div></div>
    </div>
    <div class="sec-head"><h2>Чаще всего смотрел</h2></div>
    <div class="list cols">${st.titles.slice(0, 6).map(({ a, n }, i) => `<div data-top-title>${wideCard(a, `<b>#${i + 1}</b> · ${plural(n, 'серия', 'серии', 'серий')} · ${fmtDuration(n * epMinutes(a))}`)}</div>`).join('')}</div>
    <div class="year-facts">
      ${st.best ? `<div class="hint"><span>★</span><div>Лучшее из досмотренного: <a class="linkbtn" href="#/anime/${st.best.anime.id}">${esc(nameOf(st.best.anime))}</a> - ${scoreText(st.best.score)}</div></div>` : ''}
      ${st.night ? `<div class="hint"><span>🌙</span><div>Ночная сова: ${Math.round(st.night / st.eps * 100)}% серий - после полуночи и до пяти утра.</div></div>` : ''}
    </div>`;
  yearStudios(st.titles.map(t => t.a.id).filter(Boolean), alive);
  document.getElementById('y-card').onclick = () => yearCard(y, st);
}

// Картинка «Мой год в аниме»: рисуем на canvas и отдаём PNG. Всё локально, без библиотек.
// Такой карточкой можно похвастаться в чате - и это единственный способ вынести итоги из приложения.
function yearCard(y, st) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#7c5cff';
  const accent2 = css.getPropertyValue('--accent2').trim() || '#ff7a59';
  const rgba = (col, a) => {
    const h = String(col).trim().replace('#', '');
    const n = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    const v = parseInt(n.slice(0, 6), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  };
  const blob = (x, yy, r, col) => {
    const gr = g.createRadialGradient(x, yy, 0, x, yy, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, yy, r, 0, 7);
    g.fill();
  };
  const font = (size, weight = 400) => `${weight} ${size}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  const text = (s, x, yy, size, weight = 400, col = '#fff', align = 'left') => {
    g.font = font(size, weight);
    g.fillStyle = col;
    g.textAlign = align;
    g.fillText(s, x, yy);
  };
  // длинное название подгоняем по ширине, иначе вылезет за карточку
  const fit = (s, maxW, size) => {
    g.font = font(size, 600);
    while (size > 16 && g.measureText(s).width > maxW) {
      size -= 2;
      g.font = font(size, 600);
    }
    return size;
  };

  g.fillStyle = '#0a0c16';
  g.fillRect(0, 0, W, H);
  blob(60, 60, 620, rgba(accent, 0.42));
  blob(W - 40, H - 40, 680, rgba(accent2, 0.34));
  g.strokeStyle = 'rgba(255,255,255,.12)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(28, 28, W - 56, H - 56, 40);
  g.stroke();

  text('МОЙ ГОД В АНИМЕ', 84, 178, 30, 700, 'rgba(255,255,255,.62)');
  const grad = g.createLinearGradient(84, 200, 640, 380);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, accent2);
  g.font = font(190, 800);
  g.fillStyle = grad;
  g.textAlign = 'left';
  g.fillText(String(y), 80, 380);
  text(`${plural(st.eps, 'серия', 'серии', 'серий')} за ${plural(st.days, 'день', 'дня', 'дней')} просмотра`,
    84, 448, 34, 400, 'rgba(255,255,255,.78)');

  // главные числа
  const cells = [
    [fmtDuration(st.minutes), 'времени за экраном'],
    [String(st.titles.length), 'разных тайтлов'],
    [String(st.done.length), 'досмотрено целиком'],
    [String(st.streak), 'дней подряд - рекорд'],
  ];
  cells.forEach(([v, label], i) => {
    const x = 84 + (i % 2) * 470, yy = 540 + Math.floor(i / 2) * 150;
    text(v, x, yy, 62, 800, '#fff');
    text(label, x, yy + 42, 26, 400, 'rgba(255,255,255,.6)');
  });

  // месяцы
  if (st.months.some(Boolean)) {
    text('По месяцам', 84, 862, 26, 700, 'rgba(255,255,255,.62)');
    const maxM = Math.max(...st.months) || 1;
    st.months.forEach((n, i) => {
      const bw = 62, bx = 84 + i * 76, bh = Math.round(n / maxM * 130);
      g.fillStyle = 'rgba(255,255,255,.09)';
      g.beginPath();
      g.roundRect(bx, 1030 - 130, bw, 130, 8);
      g.fill();
      if (n) {
        const gr2 = g.createLinearGradient(0, 900, 0, 1030);
        gr2.addColorStop(0, accent2);
        gr2.addColorStop(1, accent);
        g.fillStyle = gr2;
        g.beginPath();
        g.roundRect(bx, 1030 - bh, bw, bh, 8);
        g.fill();
      }
      g.font = font(20, 400);
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.textAlign = 'center';
      g.fillText(YEAR_MONTHS[i].slice(0, 3), bx + bw / 2, 1064);
    });
  }

  // жанр и топ тайтлов
  if (st.genres[0]) text(`Больше всего - «${st.genres[0][0]}»`, 84, 1130, 30, 600, 'rgba(255,255,255,.85)');
  st.titles.slice(0, 3).forEach(({ a, n }, i) => {
    const name = a.id && (a.russian || a.name) ? title(a) : 'Тайтл ' + a.id;
    const yy = 1188 + i * 44;
    text(`#${i + 1}`, 84, yy, 26, 800, rgba(accent2, 0.95));
    const size = fit(name, 760, 28);
    text(name, 140, yy, size, 600, 'rgba(255,255,255,.88)');
    text(plural(n, 'серия', 'серии', 'серий'), W - 90, yy, 24, 400, 'rgba(255,255,255,.55)', 'right');
  });

  text('Анимир', 84, H - 92, 30, 800, rgba(accent, 0.95));
  text('аниме-клиент для ПК', W - 90, H - 92, 22, 400, 'rgba(255,255,255,.4)', 'right');

  saveFile(`Animir-${y}.png`, c.toDataURL('image/png')).then(path => {
    toast(path ? 'Картинка сохранена: ' + path : 'Картинка сохранена в «Загрузки»');
  }).catch(() => toast('Не удалось сохранить картинку', 'err'));
}

// Студии - отдельным запросом: в сохранённых карточках их нет. Нет сети - раздел просто не появится.
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
