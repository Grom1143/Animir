'use strict';
// Анимир - скачивание серий: кнопки, выбор серий и окно с прогрессом.
// Сервер качает в «Загрузки\\Анимир»: mp4 напрямую, HLS (AniLiberty) сегментами в .ts.
// Очередь и прогресс живут на сервере, поэтому окно можно закрыть - загрузка продолжится.

let dlTimer = 0;

function dlStart(sid, dub, label, title, episodes) {
  return postJson('/api/download', { sid, dub, label, title, episodes })
    .then(r => {
      toast('Скачивание началось: ' + plural(episodes.length, 'серия', 'серии', 'серий'));
      downloadsDialog();
      return r;
    })
    .catch(e => { toast('Не удалось начать: ' + e.message, 'err'); return null; });
}

// Выбор, что качать: все серии озвучки, только непросмотренные или диапазон.
function dlPickEpisodes(s, dub, marks) {
  const total = Math.max(1, +dub.count || 1);
  const unmarked = [];
  for (let n = 1; n <= total; n++) if (!marks[n]) unmarked.push(n);
  return new Promise(res => {
    const b = modal(`<h3>Скачать «${esc(dub.label)}»</h3>
      <p class="muted" style="margin:0 0 12px">Сериало${total !== 1 ? 'в' : ''} в озвучке: ${total}. Файлы сохранятся в «Загрузки\\Анимир».</p>
      <div class="checks">
        <label><input type="radio" name="dlw" value="all" checked> Все серии (${total})</label>
        <label><input type="radio" name="dlw" value="new" ${unmarked.length ? '' : 'disabled'}> Только непросмотренные (${unmarked.length})</label>
        <label><input type="radio" name="dlw" value="range"> Диапазон: <input class="input" id="dl-a" type="number" min="1" max="${total}" value="1" style="width:70px"> - <input class="input" id="dl-b" type="number" min="1" max="${total}" value="${total}" style="width:70px"></label>
      </div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Прямые mp4 качаются целиком; HLS (AniLiberty) собирается в .ts - такие файлы играет VLC/MPC, в приложении они открываются системным плеером.</p>
      <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn primary" data-s>Скачать</button></div>`, 'dlpick', () => res(null));
    const pick = () => b.querySelector('input[name=dlw]:checked').value;
    b.querySelector('[data-c]').onclick = () => { answerModal(); res(null); };
    b.querySelector('[data-s]').onclick = () => {
      const mode = pick();
      let eps = [];
      if (mode === 'all') eps = Array.from({ length: total }, (_, i) => i + 1);
      else if (mode === 'new') eps = unmarked;
      else {
        const a = Math.max(1, +b.querySelector('#dl-a').value || 1);
        const z = Math.min(total, +b.querySelector('#dl-b').value || total);
        for (let n = Math.min(a, z); n <= Math.max(a, z); n++) eps.push(n);
      }
      answerModal();
      res(eps.length ? eps : null);
    };
  });
}

// Окно загрузок: список заданий, прогресс, отмена, папка
function downloadsDialog() {
  const b = modal(`<h3>Скачивания</h3>
    <p class="muted" style="margin:0 0 12px">Файлы: «Загрузки\\Анимир». Загрузка идёт в фоне, окно можно закрыть.</p>
    <div id="dll" class="loading">Загружаю список…</div>
    <div class="row-btns"><button class="btn" data-folder>📁 Папка</button><button class="btn" data-clear>Убрать завершённые</button><button class="btn primary" data-c>Закрыть</button></div>`, 'downloads');
  b.querySelector('[data-c]').onclick = () => { clearInterval(dlTimer); answerModal(); };
  b.querySelector('[data-folder]').onclick = () => postJson('/api/downloads/open', {}).catch(() => {});
  b.querySelector('[data-clear]').onclick = () => postJson('/api/downloads/clear', {}).then(draw).catch(() => {});
  const box = b.querySelector('#dll');
  const stateName = { running: 'качается', done: 'готово', partial: 'готово с пропусками', error: 'ошибка', cancelled: 'отменено' };
  async function draw() {
    const d = await fetch('/api/downloads').then(r => r.json()).catch(() => ({ jobs: [] }));
    const jobs = d.jobs || [];
    if (!jobs.length) { box.className = 'muted'; box.textContent = 'Пока ничего не скачивается.'; return; }
    box.className = '';
    box.innerHTML = jobs.map(j => {
      const p = Math.min(100, Math.round(j.percent || 0));
      const last = j.file ? esc(String(j.file).split(/[\\/]/).pop()) : '';
      return `<div class="dl-job">
        <div class="dl-top"><b>${esc(j.title)}</b><span class="muted">${esc(j.label)}</span>
          <span class="dl-state ${j.state}">${stateName[j.state] || j.state}</span></div>
        <div class="dl-bar ${j.state}"><i style="width:${j.state === 'running' ? p : 100}%"></i></div>
        <div class="dl-sub"><span>${j.done} из ${j.total}${j.state === 'running' ? ' · серия ' + (j.ep || '') + ' · ' + p + '%' : ''}</span>
          <span class="muted">${last}</span>
          ${j.state === 'running' ? `<button class="link" data-stop="${esc(j.id)}">Отменить</button>` : ''}</div>
        ${j.error ? `<div class="muted" style="font-size:12px">${esc(j.error)}</div>` : ''}
      </div>`;
    }).join('');
    $$('[data-stop]', box).forEach(x => x.onclick = () => postJson('/api/downloads/cancel', { id: x.dataset.stop }).then(draw).catch(() => {}));
  }
  draw();
  clearInterval(dlTimer);
  dlTimer = setInterval(draw, 2000);
}
