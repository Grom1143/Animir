'use strict';
// Animax — общие блоки интерфейса: карточки, окна, контекстное меню.

// ================= общие блоки =================
function errBlock(err, retry) {
  const box = document.createElement('div');
  box.className = 'err';
  box.innerHTML = `<div class="ic">⚠</div><h3>Что-то пошло не так</h3><p>Не удалось загрузить данные. Проверь интернет и попробуй ещё раз.</p>
    <button class="btn primary">Повторить</button> <button class="btn" data-more>Подробнее</button><pre hidden>${esc(err?.message || err)}</pre>`;
  box.querySelector('.primary').onclick = retry || route;
  box.querySelector('[data-more]').onclick = () => { box.querySelector('pre').hidden = false; };
  return box;
}
const emptyHtml = (icon, head, text = '') => `<div class="empty"><span class="ic">${icon}</span><b>${head}</b>${text ? `<br>${text}` : ''}</div>`;
function hint(key, html) {
  if (S.settings.hints[key]) return '';
  return `<div class="hint" data-hint="${key}"><span>💡</span><div>${html}</div><button class="x" title="Скрыть">✕</button></div>`;
}
document.addEventListener('click', e => {
  const x = e.target.closest('.hint .x');
  if (!x) return;
  const h = x.closest('.hint');
  S.settings.hints[h.dataset.hint] = true;
  save();
  h.remove();
});

// Картинка не загрузилась (хост недоступен, ссылка устарела) — аккуратная заглушка вместо «битой» иконки.
// error не всплывает, поэтому слушаем на фазе перехвата.
// Сеть до Shikimori бывает нестабильной, поэтому картинку через /img сначала пробуем загрузить ещё раз.
document.addEventListener('error', e => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || im.dataset.fallback || im.getAttribute('onerror')) return;
  if (!im.dataset.retried && im.getAttribute('src')?.startsWith('/img?')) {
    im.dataset.retried = '1';
    // новый адрес, чтобы браузер не взял из памяти прошлую неудачу; сервер лишний параметр не читает
    const again = s => s.replace(/\/img\?[^\s,]+/g, u => u + '&retry=1');
    setTimeout(() => {
      if (!im.isConnected) return;
      if (im.srcset) im.srcset = again(im.getAttribute('srcset'));
      im.src = again(im.getAttribute('src'));
    }, 2500);
    return;
  }
  im.dataset.fallback = '1';
  im.removeAttribute('srcset');
  im.src = 'placeholder.svg';
  im.classList.add('img-missing');
}, true);

// ================= карточки =================
function card(a, opt = {}) {
  SNAPS.set(a.id, a);
  const e = S.list[a.id];
  return `<a class="card" href="${opt.href || '#/anime/' + a.id}" data-aid="${a.id}">
    <div class="poster"><img loading="lazy" ${pimg(a)} alt="">
      ${a.score > 0 ? shikiScore(a, 'score') : ''}
      ${e?.status && !opt.noMark ? `<span class="mark st-${e.status}">${LIST_NAME[e.status]}</span>` : ''}
      ${opt.rank ? `<span class="rank">${opt.rank}</span>` : ''}
      ${opt.badge ? `<span class="eps">${esc(opt.badge)}</span>` : ''}
      ${e?.fav ? '<span class="fav">♥</span>' : ''}
      ${notifyBadge(a)}
      ${opt.bar != null ? `<div class="bar"><i style="width:${opt.bar}%"></i></div>` : ''}
      <button class="more-btn" data-more="${a.id}" title="Ещё">⋮</button>
    </div>
    <div class="t">${esc(title(a))}</div>
    <div class="m">${esc(opt.meta ?? metaLine(a))}</div>
  </a>`;
}
function lrow(a, opt = {}) {
  SNAPS.set(a.id, a);
  const e = S.list[a.id];
  const bits = [epsText(a), a.score > 0 ? shikiScore(a, 'st') : '', e?.fav ? '<span class="hf">♥</span>' : ''].filter(Boolean);
  return `<a class="lrow" href="${opt.href || '#/anime/' + a.id}" data-aid="${a.id}">
    ${opt.rank ? `<span class="rank">${opt.rank}</span>` : ''}
    <div class="pw"><img loading="lazy" ${pimg(a, 110)} alt="">${e?.status ? `<span class="mark st-${e.status}">${LIST_NAME[e.status]}</span>` : ''}${notifyBadge(a)}</div>
    <div class="b"><div class="t">${esc(title(a))}</div>
      <div class="m">${[KIND[a.kind], a.year].filter(Boolean).join(' · ')}${bits.length ? ' · ' + bits.join(' • ') : ''}${opt.extra ? ' · ' + esc(opt.extra) : ''}</div>
      <div class="d">${esc(a.desc || '')}</div></div>
    <button class="more-btn" data-more="${a.id}" title="Ещё">⋮</button>
  </a>`;
}
const isList = () => S.settings.view === 'list';
const item = (a, opt) => isList() ? lrow(a, opt) : card(a, opt);
const gridClass = () => isList() ? 'lgrid' : 'grid';
const fieldsFor = () => isList() ? CARD + ' description' : CARD;
function wideCard(a, sub, href = `#/anime/${a.id}`, right = '') {
  if (a.id) SNAPS.set(a.id, a);
  return `<a class="wide-card" href="${href}" ${a.id ? `data-aid="${a.id}"` : ''}><img loading="lazy" src="${img(a.poster, 120)}" alt="">
    <div class="wc-b"><div class="t">${esc(title(a))}</div><div class="m">${sub}</div></div>${right}</a>`;
}

// Долгая загрузка с объяснением: что именно ищем и сколько уже ждём (а не безликое «Загрузка…»)
function slowLoading(view, text, alive) {
  view.innerHTML = `<div class="loading slow"><div><b>${esc(text)}</b><small></small></div></div>`;
  const t0 = Date.now(), small = $('.loading.slow small', view);
  const timer = setInterval(() => {
    if (!alive() || !small.isConnected) return clearInterval(timer);
    const sec = Math.round((Date.now() - t0) / 1000);
    if (sec >= 2) small.textContent = `${sec} с · в первый раз поиск занимает до 10 секунд, потом тайтл открывается сразу`;
  }, 1000);
}
// Сетка с подгрузкой при прокрутке. fetchPage(page) → { items, done }
function pager(box, fetchPage, render, alive, cls = gridClass()) {
  let page = 1, busy = false, done = false, count = 0;
  const grid = document.createElement('div');
  grid.className = cls;
  const more = document.createElement('div');
  box.append(grid, more);
  const sv = $('#view');
  // keepWant > 0 — экран возвращается на прежнее место после «Назад» (router.js): грузим дальше, пока не хватит
  const near = () => more.getBoundingClientRect().top < innerHeight + 700 + (sv.keepWant || 0);
  // пока грузится первая порция — показываем силуэты карточек, а не пустоту
  const skeleton = () => {
    if (LITE) return '';
    return cls === 'lgrid'
      ? Array.from({ length: 6 }, () => '<div class="skrow"><div class="sk sk-pw"></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>').join('')
      : Array.from({ length: 12 }, () => '<div class="skcard"><div class="sk sk-poster"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>').join('');
  };
  async function load() {
    if (busy || done || !alive()) return;
    busy = true;
    more.innerHTML = count ? '<div class="loading">Загрузка…</div>' : '';
    if (!count) grid.innerHTML = skeleton();
    try {
      const r = await fetchPage(page);
      if (!alive()) return;
      if (!count) grid.innerHTML = '';
      grid.insertAdjacentHTML('beforeend', r.items.map((a, i) => render(a, count + i)).join(''));
      count += r.items.length;
      page++;
      done = r.done;
      more.innerHTML = done && !count ? emptyHtml('🔍', 'Ничего не найдено', 'Попробуй изменить условия.') : '';
    } catch (err) {
      if (!count) grid.innerHTML = '';
      more.innerHTML = '';
      more.append(errBlock(err, () => { busy = false; load(); }));
      busy = false;
      return;
    }
    busy = false;
    if (!done && near()) load();
  }
  $('#view').addEventListener('scroll', () => { if (near()) load(); }, { passive: true });
  load();
}
// Стандартный загрузчик страницы каталога
const catalogPage = (args, filterFn) => async page => {
  const d = await gql(animes({ ...args, limit: PAGE, page }, fieldsFor()));
  let items = d.animes.map(snap);
  if (filterFn) items = items.filter(filterFn);
  return { items, done: d.animes.length < PAGE };
};

// ================= окна =================
// onCancel — что сделать, если окно закрыли мимо кнопок (Esc, клик по фону, переход на другой экран):
// иначе ожидающий ответа промис (confirmBox, picker…) так и висел бы навсегда.
let modalCancel = null, modalFocus = null;
function modal(html, cls = '', onCancel = null) {
  const m = $('#modal'), box = $('#modal-box');
  if (!m.hidden) dropModal();  // одно окно сменяет другое — прошлое считается отменённым
  else modalFocus = document.activeElement;
  box.className = 'modal-box ' + cls;
  // ✕ есть у каждого окна: у некоторых (выбор тайтла для папки, загрузка студий) других кнопок закрытия нет
  box.innerHTML = '<button class="modal-x" type="button" title="Закрыть (Esc)" aria-label="Закрыть">✕</button>' + html;
  $('.modal-x', box).onclick = closeModal;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  m.hidden = false;
  modalCancel = onCancel;
  // фокус — в первое поле ввода, иначе на главную кнопку: Enter сразу подтверждает
  requestAnimationFrame(() => {
    if (box.contains(document.activeElement)) return;
    // preventScroll: иначе фокус на кнопке внизу прокручивал длинное окно и прятал заголовок
    ($('input:not([type=checkbox]):not([type=radio]):not([hidden]), textarea', box) || $('.btn.primary', box) || box).focus?.({ preventScroll: true });
  });
  return box;
}
function dropModal() {
  const cancel = modalCancel;
  modalCancel = null;
  $('#modal').hidden = true;
  $('#modal-box').innerHTML = '';
  cancel?.();
}
// closeModal() — закрыть окно «как отмену»; кнопки, которые уже отдали ответ, сначала сбрасывают modalCancel
function closeModal() {
  if ($('#modal').hidden) return;
  dropModal();
  if (modalFocus?.isConnected) modalFocus.focus?.();
  modalFocus = null;
}
const answerModal = () => { modalCancel = null; closeModal(); };
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
// Tab не уходит из окна на страницу под ним
$('#modal').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const f = $$('button:not([disabled]), input:not([disabled]):not([hidden]), select, textarea, a[href], a[data-go], [tabindex="0"]', $('#modal-box')).filter(x => x.offsetParent);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});
// text — уже готовый HTML (вызывающий сам экранирует пользовательские строки через esc)
function confirmBox(text, yes = 'Да', no = 'Отмена') {
  return new Promise(res => {
    const b = modal(`<h3>${text}</h3><div class="row-btns"><button class="btn" data-n>${no}</button><button class="btn primary" data-y>${yes}</button></div>`, 'confirm', () => res(false));
    b.querySelector('[data-y]').onclick = () => { answerModal(); res(true); };
    b.querySelector('[data-n]').onclick = () => { answerModal(); res(false); };
  });
}
// Универсальный выбор: options = [{v, label, group?}], multi — флажки, иначе радио.
// Ответ — массив выбранных значений ([] — «Сбросить»), null — окно закрыли без выбора.
function picker(head, options, selected = [], { multi = true, search = false, note = '' } = {}) {
  return new Promise(res => {
    const sel = new Set(selected.map(String));
    const box = modal(`<h3>${head}</h3>${note ? `<p class="muted">${note}</p>` : ''}
      ${search ? '<input class="input" id="pk-q" placeholder="Поиск" style="width:100%">' : ''}
      <div class="checks" id="pk-l"></div>
      <div class="row-btns"><button class="btn" data-r>Сбросить</button><button class="btn primary" data-ok>Выбрать</button></div>`, 'picker', () => res(null));
    const draw = (q = '') => {
      let last = null;
      $('#pk-l', box).innerHTML = options.filter(o => !q || o.label.toLowerCase().includes(q)).map(o => {
        const g = o.group && o.group !== last ? `<h5>${esc(o.group)}</h5>` : '';
        last = o.group;
        return `${g}<label><input type="${multi ? 'checkbox' : 'radio'}" name="pk" value="${esc(o.v)}" ${sel.has(String(o.v)) ? 'checked' : ''}>${esc(o.label)}</label>`;
      }).join('') || '<div class="muted">Ничего не нашлось</div>';
      $$('input', $('#pk-l', box)).forEach(i => i.onchange = () => {
        if (!multi) sel.clear();
        i.checked ? sel.add(i.value) : sel.delete(i.value);
      });
      // одиночный выбор: двойной клик по варианту — сразу «Выбрать»
      if (!multi) $$('label', $('#pk-l', box)).forEach(l => l.ondblclick = () => { answerModal(); res([...sel]); });
    };
    draw();
    $('#pk-q', box)?.addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
    box.querySelector('[data-r]').onclick = () => { answerModal(); res([]); };
    box.querySelector('[data-ok]').onclick = () => { answerModal(); res([...sel]); };
  });
}
function statusPicker(a) {
  const e = S.list[a.id];
  const box = modal(`<h3>Выберите статус просмотра</h3><div class="checks">${LISTS.map(([k, n]) =>
    `<label><input type="radio" name="st" value="${k}" ${e?.status === k ? 'checked' : ''}><span style="color:${LIST_COLOR[k]}">●</span> ${n}</label>`).join('')}</div>
    <div class="row-btns">${e?.status ? '<button class="btn" data-del>Удалить из списка</button>' : ''}<button class="btn" data-c>Закрыть</button></div>`);
  return new Promise(res => {
    modalCancel = () => res(null);  // закрыли мимо кнопок — статус не меняли
    $$('input', box).forEach(i => i.onchange = () => { setStatus(a, i.value); answerModal(); res(i.value); });
    box.querySelector('[data-del]')?.addEventListener('click', () => { setStatus(a, ''); answerModal(); res(''); });
    box.querySelector('[data-c]').onclick = () => { answerModal(); res(null); };
  });
}
function youtubeId(u) {
  const m = String(u || '').match(/(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : null;
}
// Ролики YouTube открываем прямо на YouTube: встроенный плеер часто просит «подтвердить, что вы не бот».
const ytWatch = id => 'https://www.youtube.com/watch?v=' + id;
function openVideo(v) {
  const id = youtubeId(v.playerUrl) || youtubeId(v.url);
  window.open(id ? ytWatch(id) : v.url, '_blank');
}
// Просмотрщик картинок: листание, «N из M», сохранить и зум (колёсико, двойной клик, перетаскивание).
// При увеличении подгружаем картинку крупнее — сервер увеличит её сам, если оригинал мал.
function viewer(urls, start = 0) {
  let i = start, z = 1, px = 0, py = 0, base = null, loadedW = 0, hiT = 0;
  const v = document.createElement('div');
  v.className = 'viewer';
  document.body.append(v);
  const apply = () => {
    const im = $('.vstage img', v);
    if (!im) return;
    im.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    v.classList.toggle('zoomed', z > 1.01);
    $('.vz', v).textContent = Math.round(z * 100) + '%';
    clearTimeout(hiT);
    hiT = setTimeout(sharpen, 200);
  };
  // сколько пикселей нужно = размер на экране × зум × плотность экрана
  function sharpen() {
    if (!base) return;
    const maxW = LITE ? 1600 : 2400;
    const need = Math.ceil(base.w * z * (devicePixelRatio || 1) / 400) * 400;
    if (need <= loadedW * 1.05 || loadedW >= maxW) return;
    const w = Math.min(need, maxW), url = urls[i], pre = new Image();
    pre.onload = () => {
      const im = $('.vstage img', v);
      if (urls[i] !== url || !im) return;
      im.src = pre.src;
      loadedW = Math.max(w, pre.naturalWidth);
    };
    pre.src = img(url, w);
  }
  const zoomAt = (nz, cx, cy) => {
    nz = clamp(nz, 1, 8);
    const st = $('.vstage', v).getBoundingClientRect();
    // точка под курсором остаётся на месте
    const ox = cx - st.left - base.x, oy = cy - st.top - base.y;
    px = ox - (ox - px) * nz / z;
    py = oy - (oy - py) * nz / z;
    z = nz;
    if (z === 1) px = py = 0;
    apply();
  };
  const zoomCenter = k => {
    if (!base) return;
    const st = $('.vstage', v).getBoundingClientRect();
    zoomAt(z * k, st.left + st.width / 2, st.top + st.height / 2);
  };
  const draw = () => {
    z = 1; px = py = 0; base = null; loadedW = 0;
    v.innerHTML = `<div class="vt"><b>${i + 1} из ${urls.length}</b>
        <button class="btn sm" data-z="-" title="Уменьшить">−</button><span class="vz">100%</span><button class="btn sm" data-z="+" title="Увеличить">+</button>
        <a class="btn sm" href="${img(urls[i], 0)}" download="animax-${i + 1}.jpg">⤓ Сохранить</a></div>
      <div class="vstage"><img alt="" draggable="false"></div>
      ${urls.length > 1 ? '<button class="vb l">‹</button><button class="vb r">›</button>' : ''}<button class="btn sm vx">✕</button>
      <div class="vh">Колёсико или двойной клик — приблизить · перетаскивание — двигать</div>`;
    const im = $('.vstage img', v), stage = $('.vstage', v);
    im.onload = () => {
      if (base) return;
      // вписываем в окно — даже маленькую картинку растягиваем до размера окна
      const k = Math.min(stage.clientWidth / im.naturalWidth, stage.clientHeight / im.naturalHeight);
      base = { w: Math.round(im.naturalWidth * k), h: Math.round(im.naturalHeight * k) };
      base.x = (stage.clientWidth - base.w) / 2;
      base.y = (stage.clientHeight - base.h) / 2;
      Object.assign(im.style, { width: base.w + 'px', height: base.h + 'px', left: base.x + 'px', top: base.y + 'px' });
      loadedW = im.naturalWidth;
      im.classList.add('on');
      sharpen();
    };
    im.src = img(urls[i], 0);
    v.querySelector('.l')?.addEventListener('click', e => { e.stopPropagation(); i = (i - 1 + urls.length) % urls.length; draw(); });
    v.querySelector('.r')?.addEventListener('click', e => { e.stopPropagation(); i = (i + 1) % urls.length; draw(); });
    v.querySelector('.vx').onclick = close;
    $$('[data-z]', v).forEach(b => b.onclick = () => zoomCenter(b.dataset.z === '+' ? 1.5 : 1 / 1.5));
    stage.addEventListener('wheel', e => { e.preventDefault(); if (base) zoomAt(z * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener('dblclick', e => { if (base) zoomAt(z > 1.01 ? 1 : 2.5, e.clientX, e.clientY); });
    let drag = null, moved = false;
    stage.addEventListener('mousedown', e => { moved = false; if (z > 1.01) { drag = { x: e.clientX - px, y: e.clientY - py }; e.preventDefault(); } });
    stage.addEventListener('mousemove', e => { if (!drag) return; px = e.clientX - drag.x; py = e.clientY - drag.y; moved = true; apply(); });
    stage.addEventListener('mouseup', () => { drag = null; });
    stage.addEventListener('mouseleave', () => { drag = null; });
    stage.addEventListener('click', e => { if (e.target === stage && z <= 1.01 && !moved) close(); });
  };
  const key = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') { i = (i - 1 + urls.length) % urls.length; draw(); }
    if (e.key === 'ArrowRight') { i = (i + 1) % urls.length; draw(); }
    if (e.key === '+' || e.key === '=') zoomCenter(1.5);
    if (e.key === '-') zoomCenter(1 / 1.5);
    e.stopPropagation();
  };
  function close() { v.remove(); document.removeEventListener('keydown', key, true); }
  document.addEventListener('keydown', key, true);
  draw();
}

// ================= контекстное меню (правый клик / «⋮») =================
const ctx = $('#ctx');
function hideCtx() { ctx.hidden = true; }
function showCtx(x, y, a, extra = []) {
  const e = S.list[a.id];
  const at = { x, y };  // подменю (уведомления) открываем на том же месте
  const items = [
    ['↗', 'Открыть', () => go('#/anime/' + a.id)],
    [e?.fav ? '♥' : '♡', e?.fav ? 'Удалить из избранного' : 'Добавить в избранное', () => { toggleFav(a); refreshCards(a.id); }],
    ['▤', e?.status ? `В списке: ${LIST_NAME[e.status]}` : 'Добавить в список…', async () => { await statusPicker(a); refreshCards(a.id); }],
    ['▣', 'Добавить в коллекцию', () => collectionPicker(a)],
    (n => [n.i, n.on || n.k === 'off' ? n.t : 'Уведомлять о сериях…', () => toggleSub(a, at)])(notifyState(a)),
    ['⧉', 'Скопировать название', () => copy(title(a))],
    ...extra,
  ];
  ctx.innerHTML = `<div class="ch"><b>${esc(title(a))}</b><span>${esc(metaLine(a))}${a.score ? ' · ★ ' + a.score : ''}</span></div>`
    + items.map(([i, t], k) => `<button data-k="${k}"><i>${i}</i>${esc(t)}</button>`).join('');
  $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  ctx.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
// Обновить метки на уже нарисованных карточках
function refreshCards(id) {
  const a = SNAPS.get(+id);
  if (!a) return;
  $$(`[data-aid="${id}"]`).forEach(el => {
    if (el.closest('.ctx-keep')) return;
    const html = el.classList.contains('lrow') ? lrow(a) : el.classList.contains('card') ? card(a) : null;
    if (html) el.outerHTML = html;
  });
}
document.addEventListener('contextmenu', e => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;  // в полях ввода оставляем «Копировать/Вставить»
  e.preventDefault();  // меню браузера («Назад», «Сохранить как», «Проверить») выдаёт, что это сайт
  const el = e.target.closest('[data-aid]');
  if (!el) return;
  const a = SNAPS.get(+el.dataset.aid);
  if (!a) return;
  e.preventDefault();
  showCtx(e.clientX, e.clientY, a, el.dataset.hist ? [['🗑', 'Удалить из истории просмотра', () => { S.history = S.history.filter(h => h.file !== el.dataset.hist); save(); route(); }]] : []);
});
document.addEventListener('click', e => {
  const m = e.target.closest('[data-more]');
  if (m && m.classList.contains('more-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const a = SNAPS.get(+m.dataset.more);
    const r = m.getBoundingClientRect();
    if (a) showCtx(r.left, r.bottom + 4, a);
    return;
  }
  if (!e.target.closest('#ctx')) hideCtx();
}, true);
addEventListener('blur', hideCtx);
