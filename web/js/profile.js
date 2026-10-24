'use strict';
// Animax — профиль и настройки.

// ================= Профиль =================
function pageProfile(view, q) {
  const sec = q.get('s') || 'stats';
  const st = S.settings;
  const nick = st.nickname || 'Зритель';
  const all = Object.values(S.list);
  view.innerHTML = `
    <div class="cover" style="${st.cover ? `background-image:url('${st.cover}')` : ''}"><div class="cbtn"><button class="btn sm" id="cov">🖼 ${st.cover ? 'Изменить обложку' : 'Загрузить обложку'}</button>${st.cover ? '<button class="btn sm" id="cov-rm">Удалить</button>' : ''}</div></div>
    <div class="profile-head">
      <div class="avatar" id="ava" title="Изменить фото" style="${st.avatar ? `background-image:url('${st.avatar}')` : ''}">${st.avatar ? '' : esc(nick[0].toUpperCase())}</div>
      <div style="flex:1;padding-bottom:4px"><input id="nick" value="${esc(nick)}" maxlength="32" title="Изменить никнейм">
        <div class="st-text"><input id="stx" value="${esc(st.status)}" maxlength="80" placeholder="Напиши статус…"></div>
        <div class="muted" style="padding-left:7px;font-size:12px">В Animax с ${fmtDate(S.createdAt)} · профиль хранится только на этом компьютере</div></div>
      <button class="btn" id="pedit">✎ Редактировать профиль</button>
    </div>
    ${st.about ? `<div class="profile-about">${esc(st.about)}</div>` : ''}
    <input type="file" id="file" accept="image/*" hidden>
    <div class="tabs" style="margin-top:24px">${[['stats', 'Статистика'], ['rates', 'Оценки'], ['colls', 'Коллекции'], ['recent', 'Просмотрено недавно'], ['comments', 'Комментарии'], ['reviews', 'Отзывы']].map(([k, n]) => `<a class="tab ${k === sec ? 'on' : ''}" href="#/profile?s=${k}">${n}</a>`).join('')}</div>
    <div id="ps"></div>`;
  $('#pedit').onclick = profileEditor;
  $('#nick').onchange = e => { st.nickname = e.target.value.trim() || 'Зритель'; save(); route(); };
  $('#stx').onchange = e => { st.status = e.target.value.trim(); save(); };
  let target = null;
  $('#ava').onclick = () => {
    if (!st.avatar) { target = 'avatar'; $('#file').click(); return; }
    const r = $('#ava').getBoundingClientRect();
    const items = [['👁', 'Открыть', () => viewerData(st.avatar)], ['✎', 'Изменить', () => { target = 'avatar'; $('#file').click(); }], ['🗑', 'Удалить', () => { st.avatar = ''; save(); route(); }]];
    ctx.innerHTML = items.map(([i, t], n) => `<button data-k="${n}"><i>${i}</i>${t}</button>`).join('');
    $$('button', ctx).forEach(b => b.onclick = () => { hideCtx(); items[+b.dataset.k][2](); });
    ctx.hidden = false; ctx.style.left = r.left + 'px'; ctx.style.top = (r.bottom + 6) + 'px';
  };
  $('#cov').onclick = () => { target = 'cover'; $('#file').click(); };
  $('#cov-rm')?.addEventListener('click', () => { st.cover = ''; save(); route(); });
  $('#file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    st[target] = await shrinkImage(f, target === 'avatar' ? 256 : 1600);
    save();
    route();
  };
  const box = $('#ps');
  if (sec === 'stats') profileStats(box, all);
  else if (sec === 'rates') profileRates(box, all, q.get('sort') || 'recent');
  else if (sec === 'colls') { box.innerHTML = collectionsGrid(); bindCollections(box); }
  else if (sec === 'comments') profileComments(box);
  else if (sec === 'reviews') profileReviews(box);
  else {
    const seen = [...new Map(S.history.filter(h => h.anime).map(h => [h.anime.id, h])).values()];
    box.innerHTML = seen.length ? `<div class="grid">${seen.slice(0, 40).map(historyCard).join('')}</div>` : emptyHtml('↺', 'Пока ничего', 'Здесь появятся тайтлы, которые ты смотрел в Animax.');
  }
}
// Редактор профиля: всё в одном окне, изменения применяются только по «Сохранить»
function profileEditor() {
  const st = S.settings;
  const d = { nickname: st.nickname || 'Зритель', status: st.status || '', about: st.about || '', avatar: st.avatar || '', cover: st.cover || '' };
  const b = modal(`<h3 style="margin-top:0">Редактировать профиль</h3>
    <div class="pe-cover" id="pe-cov"><div class="pe-btns"><button class="btn sm" id="pe-cov-set">🖼 Обложка</button><button class="btn sm" id="pe-cov-rm">Убрать</button></div></div>
    <div class="pe-ava-row"><div class="avatar" id="pe-ava"></div>
      <div class="pe-btns"><button class="btn sm" id="pe-ava-set">📷 Фото</button><button class="btn sm" id="pe-ava-rm">Убрать</button></div></div>
    <label class="pe-f">Никнейм<input class="input" id="pe-nick" maxlength="32" value="${esc(d.nickname)}"></label>
    <label class="pe-f">Статус<input class="input" id="pe-st" maxlength="80" placeholder="Например: смотрю всё про космос" value="${esc(d.status)}"></label>
    <label class="pe-f">О себе<textarea class="input" id="pe-ab" rows="4" maxlength="500" placeholder="Пара слов о себе и любимом аниме">${esc(d.about)}</textarea>
      <small class="muted"><span id="pe-abl">${d.about.length}</span>/500</small></label>
    <input type="file" id="pe-file" accept="image/*" hidden>
    <div class="row-btns"><button class="btn" id="pe-cancel">Отмена</button><button class="btn primary" id="pe-save">Сохранить</button></div>`);
  const paint = () => {
    $('#pe-cov', b).style.backgroundImage = d.cover ? `url('${d.cover}')` : '';
    $('#pe-cov-rm', b).hidden = !d.cover;
    const a = $('#pe-ava', b);
    a.style.backgroundImage = d.avatar ? `url('${d.avatar}')` : '';
    a.textContent = d.avatar ? '' : (($('#pe-nick', b).value.trim() || 'З')[0]).toUpperCase();
    $('#pe-ava-rm', b).hidden = !d.avatar;
  };
  let target = null;
  const pick = t => { target = t; $('#pe-file', b).click(); };
  $('#pe-file', b).onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { d[target] = await shrinkImage(f, target === 'avatar' ? 256 : 1600); paint(); } catch { toast('Не удалось открыть картинку'); }
  };
  $('#pe-cov-set', b).onclick = () => pick('cover');
  $('#pe-ava-set', b).onclick = () => pick('avatar');
  $('#pe-ava', b).onclick = () => pick('avatar');
  $('#pe-cov-rm', b).onclick = () => { d.cover = ''; paint(); };
  $('#pe-ava-rm', b).onclick = () => { d.avatar = ''; paint(); };
  $('#pe-nick', b).oninput = paint;
  $('#pe-ab', b).oninput = e => { $('#pe-abl', b).textContent = e.target.value.length; };
  $('#pe-cancel', b).onclick = closeModal;
  $('#pe-save', b).onclick = () => {
    Object.assign(st, d, {
      nickname: $('#pe-nick', b).value.trim() || 'Зритель',
      status: $('#pe-st', b).value.trim(),
      about: $('#pe-ab', b).value.trim(),
    });
    save();
    closeModal();
    route();
    toast('Профиль сохранён');
  };
  paint();
  $('#pe-nick', b).focus();
}
// Вкладка «Комментарии» в профиле: мои комментарии на Shikimori, ответы и моё мнение о тайтле
function profileComments(box) {
  const all = S.myComments;
  const ops = Object.values(S.opinions);
  const by = t => ops.filter(o => o.tone === t).length;
  const replies = all.reduce((n, c) => n + c.replies.length, 0);
  const tile = (n, t) => `<div class="stat-tile"><b>${n}</b><span>${t}</span></div>`;
  box.innerHTML = `
    <div class="pc-tiles">${tile(all.length, 'комментариев')}${tile(replies, 'ответов получено')}${tile(by('pos'), '👍 тайтлов нравится')}${tile(by('neu'), '😐 нейтрально')}${tile(by('neg'), '👎 не нравится')}</div>
    <div style="display:flex;gap:10px;align-items:center;margin:14px 0">
      <span class="muted" style="flex:1;font-size:13px">Лайков у комментариев на Shikimori нет — отклик на комментарий виден по ответам. Рядом с тайтлом — твоё мнение о нём, клик меняет.</span>
      <button class="btn" id="pc-check">⟳ Проверить ответы</button></div>
    <div class="pc-list">${all.map(c => `<div class="pc-item" data-id="${c.id}">
      <a href="#/anime/${c.anime.id}/comments"><img src="${img(c.anime.poster)}" alt=""></a>
      <div class="b"><div class="h"><a href="#/anime/${c.anime.id}/comments"><b>${esc(title(c.anime))}</b></a>
          ${(t => t ? `<button class="tone-pill t-${t}" data-tone title="Сменить мнение о тайтле">${TONES[t][0]} ${TONES[t][1]}</button>`
            : '<button class="tone-pill t-neu" data-tone title="Поставить мнение о тайтле">＋ мнение</button>')(myOpinion(c.anime.id))}
          <span class="muted">${fmtWhen(c.at)}</span></div>
        ${c.replyTo ? `<div class="muted" style="font-size:12px">в ответ ${esc(c.replyTo.nick)}</div>` : ''}
        <div class="tx">${esc(c.body)}</div>
        ${c.replies.length ? `<div class="pc-replies">${c.replies.map(r => `<div><b>${esc(r.nick)}</b> <span class="muted">${fmtWhen(r.at)}</span><br>${esc(r.text)}</div>`).join('')}</div>` : ''}
        <div class="cm-act"><span class="muted">💬 ${plural(c.replies.length, 'ответ', 'ответа', 'ответов')}</span>
          <a class="linkbtn" href="https://shikimori.io/comments/${c.id}" target="_blank" rel="noopener">На Shikimori ↗</a>
          <button class="linkbtn" data-del>Удалить</button></div></div></div>`).join('')
      || emptyHtml('💬', 'Ты ещё не писал комментариев', 'Открой любой тайтл → «Комментарии» → напиши.')}</div>`;
  $('#pc-check').onclick = async e => {
    e.target.disabled = true;
    const n = await checkReplies();
    toast(n ? 'Новых ответов: ' + n : 'Новых ответов нет');
    route();
  };
  $$('.pc-item', box).forEach(el => {
    const c = myComment(el.dataset.id);
    $('[data-tone]', el).onclick = async () => {
      const order = Object.keys(TONES), t = myOpinion(c.anime.id);
      try { if (await setOpinion(c.anime, order[(order.indexOf(t) + 1) % order.length])) toast('Мнение изменено и в отзыве на Shikimori'); }
      catch (err) { toast('Shikimori не ответил: ' + err.message); }
      route();
    };
    $('[data-del]', el).onclick = async () => {
      if (!await confirmBox('Удалить комментарий на Shikimori?', 'Удалить')) return;
      const r = await fetch('/api/shiki/comment/delete', { method: 'POST', body: JSON.stringify({ id: c.id }) });
      if (!r.ok && r.status !== 404) { toast('Не удалось удалить: ' + ((await r.json().catch(() => ({}))).error || r.status)); return; }
      S.myComments = S.myComments.filter(x => x !== c);
      save();
      route();
    };
  });
}
function viewerData(url) { const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${url}" alt="">`; v.onclick = () => v.remove(); document.body.append(v); }
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = rej;
    im.src = URL.createObjectURL(file);
  });
}
function fmtDuration(min) {
  if (S.settings.timeFormat === 'h') return Math.round(min / 60) + ' ч';
  const d = Math.floor(min / 1440), h = Math.round(min % 1440 / 60);
  return d ? `${d} д ${h} ч` : `${h} ч`;
}
function profileStats(box, all) {
  const cnt = k => all.filter(e => e.status === k).length;
  const counts = LISTS.map(([k]) => [k, cnt(k)]);
  const total = counts.reduce((n, [, v]) => n + v, 0);
  const eps = all.reduce((n, e) => n + (e.ep || 0), 0);
  const minutes = all.reduce((n, e) => n + (e.ep || 0) * (e.anime.duration || (e.anime.kind === 'movie' ? 100 : 24)), 0);
  const scored = all.filter(e => e.score);
  const avg = scored.length ? (scored.reduce((n, e) => n + e.score, 0) / scored.length * (scale10() ? 2 : 1)).toFixed(1) : '—';
  const genreCount = {};
  all.filter(e => ['completed', 'watching', 'on_hold'].includes(e.status)).forEach(e => (e.anime.genres || []).forEach(g => genreCount[g] = (genreCount[g] || 0) + 1));
  const topG = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxG = topG[0]?.[1] || 1;
  // кольцевая диаграмма статусов
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  const ring = total ? counts.filter(([, n]) => n).map(([k, n]) => { const len = n / total * C; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${LIST_COLOR[k]}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"/>`; acc += len; return s; }).join('') : `<circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--card2)" stroke-width="20"/>`;
  // динамика за 14 дней
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); return d; });
  const perDay = days.map(d => S.watchLog.filter(w => w.at >= d.getTime() && w.at < d.getTime() + 864e5).length);
  const maxD = Math.max(1, ...perDay);
  const unrated = all.filter(e => e.status === 'completed' && !e.score).length;
  box.innerHTML = `
    <div class="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" style="transform:rotate(-90deg)">${ring}</svg>
      <div class="stats" style="flex:1">
        ${counts.map(([k, n]) => `<a class="stat" href="#/bookmarks?tab=${k}"><b style="color:${LIST_COLOR[k]}">${n}</b><span>${LIST_NAME[k]}</span></a>`).join('')}
      </div>
    </div>
    <div class="stats" style="margin-top:14px">
      <div class="stat"><b>${eps}</b><span>Просмотрено серий</span></div>
      <div class="stat"><b>${fmtDuration(minutes)}</b><span>Время просмотра</span></div>
      <div class="stat"><b>${avg}${avg !== '—' ? (scale10() ? '/10' : ' ★') : ''}</b><span>Средняя оценка</span></div>
      <a class="stat" href="#/bookmarks?tab=favorites"><b>${all.filter(e => e.fav).length}</b><span>В избранном</span></a>
      <a class="stat" href="#/collections"><b>${S.collections.length}</b><span>Коллекций</span></a>
    </div>
    ${unrated ? `<div class="hint" style="margin-top:18px"><span>★</span><div>Есть просмотренные, но не оценённые тайтлы: ${unrated}. <a class="linkbtn" href="#/rate">Оценить</a></div></div>` : ''}
    <div class="sec-head"><h2>Динамика просмотра серий</h2><span class="sub">за 2 недели</span></div>
    <div class="people"><div class="days-bars">${days.map((d, i) => `<div class="d" title="${d.toLocaleDateString('ru-RU')}: ${perDay[i]}">${perDay[i] ? `<b>${perDay[i]}</b>` : ''}<i style="height:${perDay[i] / maxD * 100}%"></i>${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}</div>`).join('')}</div></div>
    <div class="sec-head"><h2>Любимые жанры</h2></div>
    ${topG.length ? `<div class="bars">${topG.map(([g, n]) => `<div class="r"><span>${esc(g)}</span><div class="tr"><i style="width:${n / maxG * 100}%"></i></div><b>${n}</b></div>`).join('')}</div>`
      : '<div class="muted">Появятся, когда добавишь тайтлы в «Смотрю» или «Просмотрено» (жанры подтягиваются со страницы тайтла).</div>'}`;
}
function profileRates(box, all, sort) {
  let list = all.filter(e => e.score);
  const sorts = { recent: ['Сначала последние', (a, b) => (b.scoredAt || 0) - (a.scoredAt || 0)], old: ['Сначала старые', (a, b) => (a.scoredAt || 0) - (b.scoredAt || 0)], ...Object.fromEntries((scale10() ? [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] : [5, 4, 3, 2, 1]).map(n => ['s' + n, [scale10() ? n + '/10' : plural(n, 'звезда', 'звезды', 'звёзд'), null]])) };
  const pts = e => scale10() ? Math.round(e.score * 2) : Math.round(e.score);
  if (sort.startsWith('s')) list = list.filter(e => pts(e) === +sort.slice(1)).sort(sorts.recent[1]);
  else list.sort((sorts[sort] || sorts.recent)[1]);
  const unrated = all.filter(e => e.status === 'completed' && !e.score).length;
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><b style="flex:1">${plural(list.length, 'оценка', 'оценки', 'оценок')}</b>
      <select class="select" id="rs">${Object.entries(sorts).map(([k, [n]]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${unrated ? `<div class="hint"><span>★</span><div>Есть просмотренные, но не оценённые: ${unrated}. <a class="linkbtn" href="#/rate">Оценить</a></div></div>` : ''}
    <div class="list cols">${list.map(e => wideCard(e.anime, `<span class="stars5 ro sm">${starsHtml(e.score, true)}</span> ${scale10() ? scoreText(e.score) : ''}<br>${e.scoredAt ? fmtWhen(e.scoredAt) : ''}`)).join('') || emptyHtml('★', 'Оценок пока нет')}</div>`;
  $('#rs').onchange = e => go('#/profile?s=rates&sort=' + e.target.value);
}
function pageRate(view) {
  const queue = Object.values(S.list).filter(e => ['completed', 'watching', 'dropped', 'on_hold'].includes(e.status) && !e.score).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  view.innerHTML = `<h1 class="page-title">Оцени просмотренное</h1>
    <p class="muted" style="margin-top:-8px">Честные оценки делают рекомендации точнее. Нажми на звёзды — карточка исчезнет.</p>
    <div class="list cols" id="rq">${queue.map(e => `<div class="wide-card" data-id="${e.anime.id}"><img src="${img(e.anime.poster)}" alt=""><div class="wc-b"><div class="t">${esc(title(e.anime))}</div>
      <div class="m">${LIST_NAME[e.status]} · ${esc(metaLine(e.anime))}</div><div class="stars5">${starsHtml(0)}</div></div></div>`).join('') || emptyHtml('★', 'Всё оценено', 'Спасибо! Загляни в <a class="linkbtn" href="#/recs">рекомендации</a>.')}</div>`;
  $$('#rq .wide-card').forEach(el => $$('.stars5 button', el).forEach(b => b.onclick = ev => {
    const e = S.list[el.dataset.id];
    e.score = starVal(ev);
    e.scoredAt = Date.now();
    commit(e.anime.id);
    el.remove();
    toast(`${scoreWord(e.score)} (${scoreText(e.score)}): «${title(e.anime)}»`);
  }));
}

// ================= Настройки =================
// Аккаунт Shikimori: свои ключи приложения (один раз) и вход. Нужен, чтобы писать комментарии.
async function renderAccount(box) {
  const au = await authStatus(true);
  const copyBtn = t => `<button class="btn sm" data-copy="${esc(t)}">⧉</button>`;
  if (au.logged) {
    box.innerHTML = `<div class="set"><div><div>Вход выполнен: <b>${esc(au.user?.nickname || '')}</b></div>
      <div class="d">Можно писать комментарии и отвечать в обсуждениях. Ответы тебе Animax покажет в уведомлениях.</div></div>
      <div class="ctrl"><a class="btn" href="https://shikimori.io/${encodeURIComponent(au.user?.nickname || '')}" target="_blank" rel="noopener">Профиль ↗</a><button class="btn" id="a-out">Выйти</button></div></div>`;
    const hasRates = (au.scope || '').includes('user_rates');
    const lack = ['user_rates', 'comments', 'topics'].filter(x => !(au.scope || '').includes(x));
    if (lack.length && hasRates) box.insertAdjacentHTML('beforeend', `<div class="hint"><span>⚠</span><div>Не хватает прав: <b>${lack.join(', ')}</b>.
      Поставь эти галочки в своём приложении на <a class="linkbtn" href="https://shikimori.io/oauth/applications" target="_blank" rel="noopener">shikimori.io → Приложения</a>, сохрани, затем «Выйти» и войди снова.</div></div>`);
    box.insertAdjacentHTML('beforeend', `<div class="set-group">Синхронизация с Shikimori</div>
      ${hasRates ? `<div class="set"><div><div>Синхронизировать закладки, оценки и серии</div>
          <div class="d">Списки «Смотрю», «В планах» и т.д., оценки и число просмотренных серий совпадают в Animax и на Shikimori. Побеждает более позднее изменение.
          ${S.settings.shikiSyncAt ? 'Последняя синхронизация: ' + fmtWhen(S.settings.shikiSyncAt) : 'Ещё не синхронизировалось'}</div></div>
          <div class="ctrl"><label class="switch"><input type="checkbox" id="a-sync" ${S.settings.shikiSync !== false ? 'checked' : ''}><span></span></label>
          <button class="btn" id="a-sync-now">⟳ Сейчас</button></div></div>`
      : `<div class="hint"><span>⚠</span><div>Вход выполнен без права <b>user_rates</b>, поэтому списки не синхронизируются.
          Открой своё приложение на <a class="linkbtn" href="https://shikimori.io/oauth/applications" target="_blank" rel="noopener">shikimori.io → Приложения</a>,
          поставь галочку <b>user_rates</b>, сохрани — и здесь нажми «Выйти», потом войди снова.</div></div>`}`);
    $('#a-out').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); AUTH = null; route(); };
    $('#a-sync')?.addEventListener('change', e => { S.settings.shikiSync = e.target.checked; save(); if (e.target.checked) syncShikimori(true); });
    $('#a-sync-now')?.addEventListener('click', async e => { e.target.disabled = true; await syncShikimori(true); renderAccount(box); });
    return;
  }
  box.innerHTML = `
    <div class="acc-intro"><b>Зачем это нужно.</b> Комментарии в Animax публикуются на сайте Shikimori — так их видят и могут ответить другие люди. А закладки и оценки
      будут совпадать с твоим списком на Shikimori. Для этого Shikimori выдаёт Animax два ключа (как логин и пароль, но только для Animax и только для списка и комментариев).
      Настраивается <b>один раз</b>, займёт пару минут. Ссылки ниже откроются в твоём обычном браузере.</div>

    <div class="acc-step"><div class="acc-n">1</div><div>
      <h4>Войди на Shikimori</h4>
      <p>Если аккаунта нет — там же можно зарегистрироваться.</p>
      <a class="btn" href="https://shikimori.io/users/sign_in" target="_blank" rel="noopener">Открыть вход на Shikimori ↗</a>
    </div></div>

    <div class="acc-step"><div class="acc-n">2</div><div>
      <h4>Создай приложение для Animax</h4>
      <ol>
        <li>Открой страницу приложений: <a class="btn sm" href="https://shikimori.io/oauth/applications" target="_blank" rel="noopener">shikimori.io → Приложения ↗</a></li>
        <li>Нажми ссылку <b>«создать»</b> рядом с заголовком «OAuth приложения».</li>
        <li>В поле <b>«Название»</b> вставь: <span class="acc-copy"><code>${esc(au.app_name)}</code>${copyBtn(au.app_name)}</span></li>
        <li>В поле <b>«Redirect URI»</b> вставь: <span class="acc-copy"><code>${esc(au.redirect)}</code>${copyBtn(au.redirect)}</span></li>
        <li>В правах (scopes) поставь три галочки: <b>user_rates</b> (закладки и оценки совпадают с Shikimori), <b>comments</b> (комментарии) и <b>topics</b> (отзывы).</li>
        <li>Нажми <b>«Сохранить»</b>. Shikimori покажет два ключа: <b>Client ID</b> и <b>Client Secret</b>.</li>
      </ol>
      <p class="muted">Нет кнопки «создать»? Shikimori даёт создавать приложения только аккаунтам старше суток — попробуй завтра.</p>
    </div></div>

    <div class="acc-step"><div class="acc-n">3</div><div>
      <h4>Вставь ключи сюда</h4>
      <div class="acc-form">
        <input class="input" id="a-id" placeholder="Client ID" value="${esc(au.client_id || '')}">
        <input class="input" id="a-sec" type="password" placeholder="Client Secret">
        <button class="btn" id="a-save">Сохранить ключи</button>
      </div>
    </div></div>

    <div class="acc-step"><div class="acc-n">4</div><div>
      <h4>Войди через Shikimori</h4>
      <p>Откроется браузер — нажми там <b>«Разрешить»</b>. После этого Animax сам увидит вход.</p>
      <button class="btn primary" id="a-in" ${au.configured ? '' : 'disabled'}>Войти через Shikimori</button>
      ${au.configured ? '' : '<span class="muted" style="font-size:13px;margin-left:8px">сначала сохрани ключи (шаг 3)</span>'}
      <details class="acc-more"><summary>Не получилось?</summary>
        <p>Если после «Разрешить» Animax так и не показал вход, в адресной строке браузера будет <code>…/oauth/callback?code=<b>КОД</b></code>. Скопируй код и вставь:</p>
        <div class="acc-form"><input class="input" id="a-code" placeholder="Код" style="width:200px"><button class="btn" id="a-code-ok">OK</button></div>
        <p>Название приложения на Shikimori отличается от «${esc(au.app_name)}»? Впиши его сюда: <input class="input" id="a-name" value="${esc(au.app_name)}" style="width:160px"> и снова нажми «Сохранить ключи».</p>
      </details>
    </div></div>
    <p class="muted" style="font-size:12px">Ключи и вход хранятся только на этом компьютере (%APPDATA%\\Animax\\auth.json).</p>`;
  $$('[data-copy]', box).forEach(b => b.onclick = () => copy(b.dataset.copy, 'Скопировано'));
  $('#a-save').onclick = async () => {
    const body = { app_name: $('#a-name').value, client_id: $('#a-id').value, client_secret: $('#a-sec').value };
    if (!body.client_id.trim() || !body.client_secret.trim()) { toast('Нужны оба ключа: Client ID и Client Secret'); return; }
    await fetch('/api/auth/config', { method: 'POST', body: JSON.stringify(body) });
    toast('Ключи сохранены');
    renderAccount(box);
  };
  $('#a-in').onclick = async () => {
    const j = await fetch('/api/auth/login').then(r => r.json());
    if (j.error) { toast(j.error); return; }
    openInBrowser(j.url);
    toast('Подтверди вход в открывшемся браузере');
    // ждём, пока сервер получит код (вкладка входа закроется сама)
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      if (!box.isConnected) return;
      if ((await authStatus(true)).logged) { toast('Вход выполнен'); renderAccount(box); syncShikimori(true); return; }
    }
  };
  $('#a-code-ok').onclick = async () => {
    const r = await fetch('/api/auth/code', { method: 'POST', body: JSON.stringify({ code: $('#a-code').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Не получилось: ' + (j.error || r.status)); return; }
    toast('Вход выполнен');
    renderAccount(box);
  };
}
const SET_SECTIONS = [['main', 'Основные'], ['notify', 'Уведомления'], ['play', 'Воспроизведение'], ['look', 'Внешний вид'], ['data', 'Данные'], ['account', 'Аккаунт'], ['about', 'О приложении']];
function pageSettings(view, q) {
  const sec = SET_SECTIONS.some(([k]) => k === q.get('s')) ? q.get('s') : 'main';
  const st = S.settings;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  const row = (head, desc, ctrl) => `<div class="set"><div><div>${head}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="ctrl">${ctrl}</div></div>`;
  const sel = (id, opts, cur) => `<select class="select" id="${id}">${opts.map(([k, n]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  let body = '';
  if (sec === 'main') body = `
    ${row('Тема', 'Оформление приложения', sel('theme', [['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Как в Windows']], st.theme))}
    ${row('Шкала оценок', 'Как ставить свои оценки: 5 звёзд или 10 баллов (половинки звёзд). Уже поставленные оценки сохранятся', sel('scale', [['5', '1–5 (звёзды)'], ['10', '1–10 (половинки звёзд)']], st.scale || '5'))}
    ${row('Цвет акцента', 'Кнопки, выделения, полоса прогресса', `<div class="swatches">${ACCENTS.map(c => `<button style="background:${c}" data-c="${c}" class="${st.accent === c ? 'on' : ''}"></button>`).join('')}</div>`)}
    ${row('Профиль', 'Никнейм, фото, обложка и статус', '<a class="btn" href="#/profile">Открыть</a>')}`;
  else if (sec === 'notify') body = `
    ${row('Получать уведомления о сериях', 'Animax проверяет новые серии при запуске и каждые полчаса', sw('notify', st.notify))}
    ${row('На рабочий стол', 'Тост Windows от сервера Animax — приходит даже когда окно свернуто', sw('notifyDesktop', st.notifyDesktop !== false))}
    ${row('Из каких списков', 'Тайтлы из этих закладок попадут в проверку', `<button class="btn" id="nl">${names(LIST_NAME, st.notifyLists.join(',')) || 'Ни из каких'}</button>`)}
    ${row('Одно уведомление на тайтл', 'Если вышло несколько серий сразу — одно сообщение «Вышли серии 5–7»', sw('notifyOne', st.notifyOne))}
    <div class="set-group">Новые релизы — все аниме, не только из закладок</div>
    ${row('Премьеры онгоингов', 'Начался показ нового сериала из популярных. Понравился — нажми на нём 🔔', sw('notifyPremieres', st.notifyPremieres !== false))}
    ${row('Вышли полностью', 'Онгоинг закончился — вышла последняя серия, можно смотреть целиком', sw('notifyFinished', st.notifyFinished !== false))}
    <div class="set-group">Уведомления по отдельным тайтлам (🔔)</div>
    <div class="muted nb-legend">Значки на постерах и на странице тайтла: 🔔 — каждая серия (или тайтл в закладках, по ним уведомления приходят сами) · 🏁 — только последняя серия · 🎙 — слежу за озвучкой · бледный 🔔 / 🔕 — уведомлений нет.</div>
    ${Object.values(S.subs).length ? `<div class="list">${Object.values(S.subs).map(x => `<div class="folder"><img src="${img(x.poster)}" style="width:32px;height:46px;object-fit:cover;border-radius:6px" alt=""><span class="p">${esc(title(x))}${x.status === 'released' ? '<span class="muted"> · вышел</span>' : ''}</span>
        <select class="select" data-submode="${x.id}">${Object.entries(SUB_MODES).map(([k, n]) => `<option value="${k}" ${subMode(x.id) === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="btn sm" data-unsub="${x.id}" title="Убрать из списка (для тайтлов из закладок снова будут приходить уведомления по спискам)">✕</button></div>`).join('')}</div>`
      : '<div class="muted" style="padding:6px">Нажми 🔔 на постере тайтла, чтобы следить за ним, даже если его нет в закладках: каждая серия или только последняя.</div>'}
    <div class="set-group">Подписки на озвучки (на странице просмотра)</div>
    ${Object.values(S.subsDub || {}).length ? `<div class="list">${Object.entries(S.subsDub).map(([k, x]) => `<div class="folder"><img src="${img(x.anime.poster)}" style="width:32px;height:46px;object-fit:cover;border-radius:6px" alt=""><span class="p">${esc(title(x.anime))} — ${esc(x.dubLabel)}<span class="muted"> · ${x.ep || 0} эп.</span></span><button class="btn sm" data-unsubdub="${esc(k)}">Отключить</button></div>`).join('')}</div>`
      : '<div class="muted" style="padding:6px">Открой серию тайтла онлайн и нажми «🔔 Следить за…» — уведомим, когда у этой озвучки выйдет новая серия.</div>'}`;
  else if (sec === 'play') body = `
    ${row('Видеоплеер', 'Где открывать файлы из медиатеки', `<div class="radio-cards" style="width:440px">
      <label class="${st.externalPlayer ? '' : 'on'}"><input type="radio" name="pl" value="0" ${st.externalPlayer ? '' : 'checked'}><b>Встроенный</b><small>Запоминает место, отмечает серии, горячие клавиши</small></label>
      <label class="${st.externalPlayer ? 'on' : ''}"><input type="radio" name="pl" value="1" ${st.externalPlayer ? 'checked' : ''}><b>Системный</b><small>VLC, MPC и т. п. — для форматов, которые встроенный не тянет</small></label></div>`)}
    ${row('Перемотка опенинга', 'На сколько перематывает кнопка «⏩ Опенинг» и клавиша S (не меньше 5 секунд)', `<input class="input" id="sk-m" type="number" min="0" max="10" value="${Math.floor(st.skipLen / 60)}" style="width:64px"> мин <input class="input" id="sk-s" type="number" min="0" max="59" value="${st.skipLen % 60}" style="width:64px"> с`)}
    ${row('Автопереход к следующей серии', 'Через 5 секунд после конца серии', sw('autoNext', st.autoNext))}
    ${row('Скорость по умолчанию', '', sel('speed', [0.75, 1, 1.25, 1.5, 2].map(r => [r, r === 1 ? 'Обычная' : r + '×']), st.speed))}
    ${row('Качество по умолчанию', 'Для онлайн-серий, у которых оно есть. Меняется и кнопкой ⚙ в плеере', sel('defq', [['', 'Авто (лучшее)'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['240', '240p']], String(st.q || '')))}
    ${row('Масштаб видео', '', sel('fit', [['contain', 'Вписать'], ['cover', 'Заполнить (обрезать края)'], ['fill', 'Растянуть']], st.fit))}`;
  else if (sec === 'look') body = `
    ${row('Вид отображения тайтлов', '', `<div class="radio-cards" style="width:420px">
      <label class="${isList() ? '' : 'on'}"><input type="radio" name="vw" value="cards" ${isList() ? '' : 'checked'}><b>▦ Карточками</b><small>Сетка постеров</small></label>
      <label class="${isList() ? 'on' : ''}"><input type="radio" name="vw" value="list" ${isList() ? 'checked' : ''}><b>☰ Списком</b><small>Постер, данные и описание</small></label></div>`)}
    ${row('Вкладка на главной по умолчанию', 'Открывается при запуске', sel('homeTab', Object.keys(HOME_TABS).map(k => [k, tabName(k)]), st.homeTab))}
    ${row('Вкладка в закладках по умолчанию', '', sel('bookmarksTab', BM_TABS, st.bookmarksTab))}
    ${row('Формат времени просмотра в профиле', '', sel('timeFormat', [['dh', 'Дни и часы'], ['h', 'Часы']], st.timeFormat))}
    ${row('Компактное меню', 'Меньше отступы в боковом меню', sw('compactNav', st.compactNav))}
    ${row('Снег зимой', 'Снежинки в строке поиска с декабря по февраль', sw('snow', st.snow))}
    ${row('Лёгкий режим', `Для слабых компьютеров: меньше памяти и нагрузки — без анимаций, с картинками попроще и видео до 720p; на ПК с малой памятью ещё и без видеокарты.${SYS?.ram_gb ? ` У этого компьютера ${SYS.ram_gb} ГБ памяти и ${plural(SYS.cores, 'ядро', 'ядра', 'ядер')}${SYS.low_end ? ' — лёгкий режим нужен' : ''}.` : ''} Окно применит его после перезапуска Animax.`,
      sel('lite', [['auto', 'Как у компьютера'], ['on', 'Включён'], ['off', 'Выключен']], st.lite || 'auto'))}
    ${row('Подсказки', 'Снова показать все скрытые подсказки', '<button class="btn" id="hints">Вернуть</button>')}`;
  else if (sec === 'data') body = `
    <div class="set-group">Закладки</div>
    ${row('Импорт из Shikimori', 'Файл со списком аниме из Shikimori (Настройки профиля → Списки → Экспорт → JSON)', '<button class="btn" id="imp">Выбрать файл</button><input type="file" id="imp-f" accept=".json" hidden>')}
    ${row('Экспорт закладок', 'Таблица CSV (открывается в Excel) или текстовый документ', '<button class="btn" id="exp">Экспортировать</button>')}
    <div class="set-group">Резервная копия</div>
    ${row('Всё в один файл', 'Закладки, отметки серий, коллекции, история, настройки', '<button class="btn" id="bk">Сохранить</button><button class="btn" id="rs">Загрузить</button><input type="file" id="rs-f" accept=".json" hidden>')}
    <div class="set-group">Кэш изображений</div>
    ${row('Постеры и кадры на диске', 'Ускоряет повторное открытие страниц', '<span class="muted" id="cache-sz">…</span><button class="btn" id="cache-clr">Очистить</button>')}`;
  else if (sec === 'account') body = '<div id="acc"><div class="loading">…</div></div>';
  else body = `
    ${row('Animax ' + APP_VERSION, 'Аниме-клиент для ПК: каталог, закладки, расписание, онлайн-озвучки, медиатека и плеер. Продолжение AnyX — закладки и настройки из него переносятся сами.', '')}
    ${row('Данные о тайтлах', 'Shikimori (shikimori.io): каталог, оценки, статистика, комментарии', '<a class="btn" href="https://shikimori.io" target="_blank" rel="noopener">Открыть ↗</a>')}
    ${row('Видео', 'Твои файлы, ссылки на потоки (свой медиасервер) и официальные ролики YouTube', '')}
    ${row('Горячие клавиши', 'Поиск, навигация и управление плеером с клавиатуры. Окно со списком открывается и клавишей ?', '<button class="btn" id="keys">⌨ Показать</button>')}`;
  view.innerHTML = `<h1 class="page-title">Настройки</h1>
    <div class="tabs">${SET_SECTIONS.map(([k, n]) => `<a class="tab ${k === sec ? 'on' : ''}" href="#/settings?s=${k}">${n}</a>`).join('')}</div>
    <div class="settings">${body}</div>`;

  const bind = (id, fn) => { const el = $('#' + id); if (el) el.onchange = e => { fn(e.target.type === 'checkbox' ? e.target.checked : e.target.value); save(); }; };
  bind('theme', v => { st.theme = v; applyTheme(); });
  bind('scale', v => { st.scale = v; toast(v === '10' ? 'Оценки 1–10: кликай по левой половине звезды для нечётного балла' : 'Оценки 1–5 звёзд'); });
  if ($('#acc')) renderAccount($('#acc'));
  $$('.swatches button', view).forEach(b => b.onclick = () => { st.accent = b.dataset.c; applyTheme(); save(); route(); });
  bind('notify', v => { st.notify = v; });
  bind('notifyDesktop', v => { st.notifyDesktop = v; });
  bind('notifyOne', v => { st.notifyOne = v; });
  bind('notifyPremieres', v => { st.notifyPremieres = v; });
  bind('notifyFinished', v => { st.notifyFinished = v; });
  $$('[data-submode]').forEach(el => el.onchange = () => { const x = S.subs[el.dataset.submode]; if (x) { x.mode = el.value; save(); } });
  $('#nl')?.addEventListener('click', async () => { const r = await picker('Уведомления из списков', LISTS.map(([v, label]) => ({ v, label })), st.notifyLists); if (!r) return; st.notifyLists = r; save(); route(); });
  $$('[data-unsub]', view).forEach(b => b.onclick = () => {
    S.subsDel['subs:' + b.dataset.unsub] = Date.now();
    delete S.subs[b.dataset.unsub];
    save();
    route();
  });
  $$('[data-unsubdub]', view).forEach(b => b.onclick = () => {
    S.subsDel['subsDub:' + b.dataset.unsubdub] = Date.now();
    delete S.subsDub[b.dataset.unsubdub];
    save();
    route();
  });
  $$('input[name=pl]', view).forEach(r => r.onchange = () => { st.externalPlayer = r.value === '1'; save(); route(); });
  const sk = () => { st.skipLen = Math.max(5, (+$('#sk-m').value || 0) * 60 + (+$('#sk-s').value || 0)); save(); };
  $('#sk-m')?.addEventListener('change', sk);
  $('#sk-s')?.addEventListener('change', sk);
  bind('autoNext', v => { st.autoNext = v; });
  bind('speed', v => { st.speed = +v; });
  bind('defq', v => { st.q = v ? +v : 0; });
  bind('fit', v => { st.fit = v; });
  $$('input[name=vw]', view).forEach(r => r.onchange = () => { st.view = r.value; save(); route(); });
  bind('homeTab', v => { st.homeTab = v; });
  $('#keys')?.addEventListener('click', keysHelp);
  bind('lite', v => { st.lite = v; initLite(); saveNow().catch(() => {}); toast(LITE ? 'Лёгкий режим включён. Окно станет легче после перезапуска Animax' : 'Лёгкий режим выключен'); });
  bind('bookmarksTab', v => { st.bookmarksTab = v; });
  bind('timeFormat', v => { st.timeFormat = v; });
  bind('compactNav', v => { st.compactNav = v; applyTheme(); });
  bind('snow', v => { st.snow = v; snowfall(); });
  $('#hints')?.addEventListener('click', () => { st.hints = {}; save(); toast('Подсказки снова будут показываться'); });
  // данные
  $('#imp')?.addEventListener('click', () => $('#imp-f').click());
  $('#imp-f')?.addEventListener('change', e => importShikimori(e.target.files[0]));
  $('#exp')?.addEventListener('click', exportDialog);
  $('#bk')?.addEventListener('click', () => download(`Animax-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 1), 'application/json'));
  $('#rs')?.addEventListener('click', () => $('#rs-f').click());
  $('#rs-f')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';  // тот же файл можно будет выбрать ещё раз
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!j.list) throw new Error('не похоже на копию Animax или AnyX');
      if (!(await confirmBox('Заменить текущие данные данными из файла?', 'Заменить'))) return;
      // _replace: именно заменить, а не слить с текущим состоянием (как при обычном сохранении)
      const r = await fetch('/api/state', { method: 'POST', body: JSON.stringify({ ...j, _replace: true, _win: WIN }) });
      if (!r.ok) throw new Error('сервер не принял файл');
      await loadState();
      applyTheme();
      toast('Данные загружены');
      route();
    } catch (err) { toast('Не удалось загрузить: ' + err.message); }
  });
  if ($('#cache-sz')) fetch('/api/cache').then(r => r.json()).then(c => { $('#cache-sz').textContent = `${c.files} файлов · ${(c.bytes / 2 ** 20).toFixed(1)} МБ`; });
  $('#cache-clr')?.addEventListener('click', async () => { await fetch('/api/cache/clear', { method: 'POST' }); toast('Кэш очищен'); route(); });
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: type + ';charset=utf-8' }));
  a.download = name;
  a.click();
  toast('Файл сохранён в «Загрузки»: ' + name);
}
function exportDialog() {
  const b = modal(`<h3>Экспорт закладок</h3>
    <div class="radio-cards"><label class="on"><input type="radio" name="ef" value="csv" checked><b>Таблица CSV</b><small>Откроется в Excel</small></label><label><input type="radio" name="ef" value="txt"><b>Текстовый документ</b><small>Удобно отправить</small></label></div>
    <p class="muted" style="margin:14px 0 6px">Сортировать по</p>${`<select class="select" id="es"><option value="name">названию</option><option value="status">статусу</option><option value="score">моей оценке</option></select>`}
    <p class="muted" style="margin:14px 0 6px">Что добавить</p>
    <div class="checks"><label><input type="checkbox" id="e-orig" checked>Оригинальное название</label><label><input type="checkbox" id="e-st" checked>Статус просмотра</label><label><input type="checkbox" id="e-sc" checked>Моя оценка</label><label><input type="checkbox" id="e-ep" checked>Просмотрено серий</label></div>
    <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn primary" data-ok>Сохранить файл</button></div>`);
  $$('input[name=ef]', b).forEach(r => r.onchange = () => $$('.radio-cards label', b).forEach(l => l.classList.toggle('on', l.contains(r) && r.checked)));
  b.querySelector('[data-c]').onclick = closeModal;
  b.querySelector('[data-ok]').onclick = () => {
    const fmt = $('input[name=ef]:checked', b).value, sortBy = $('#es', b).value;
    const opt = { orig: $('#e-orig', b).checked, st: $('#e-st', b).checked, sc: $('#e-sc', b).checked, ep: $('#e-ep', b).checked };
    const order = Object.fromEntries(LISTS.map(([k], i) => [k, i]));
    const list = Object.values(S.list).filter(e => e.status || e.fav).sort(sortBy === 'status' ? (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || title(a.anime).localeCompare(title(b.anime)) : sortBy === 'score' ? (a, b) => (b.score || 0) - (a.score || 0) : (a, b) => title(a.anime).localeCompare(title(b.anime)));
    let out;
    if (fmt === 'csv') {
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['Название', opt.orig && 'Оригинальное название', opt.st && 'Статус', opt.sc && 'Моя оценка', opt.ep && 'Серий просмотрено', 'Shikimori ID'].filter(Boolean);
      out = [head.map(q).join(';'), ...list.map(e => [title(e.anime), opt.orig && e.anime.name, opt.st && (LIST_NAME[e.status] || (e.fav ? 'Избранное' : '')), opt.sc && (e.score ? scoreText(e.score) : ''), opt.ep && e.ep, e.anime.id].filter(x => x !== false).map(q).join(';'))].join('\r\n');
    } else {
      out = list.map((e, i) => `${i + 1}. ${title(e.anime)}${opt.orig && e.anime.name ? ` (${e.anime.name})` : ''}${opt.st && e.status ? ' — ' + LIST_NAME[e.status] : ''}${opt.sc && e.score ? ' — ' + scoreText(e.score) : ''}${opt.ep && e.ep ? ` — ${e.ep} эп.` : ''}`).join('\r\n');
    }
    closeModal();
    download(`Animax-закладки-${new Date().toISOString().slice(0, 10)}.${fmt}`, out, fmt === 'csv' ? 'text/csv' : 'text/plain');
  };
}
// Импорт списка аниме, выгруженного из Shikimori (JSON)
async function importShikimori(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('ожидался список');
    data = data.filter(x => (x.target_type || 'Anime') === 'Anime' && x.target_id);
  } catch (err) { toast('Это не похоже на экспорт Shikimori: ' + err.message); return; }
  const map = { watching: 'watching', rewatching: 'watching', planned: 'planned', completed: 'completed', on_hold: 'on_hold', dropped: 'dropped' };
  const counts = {};
  data.forEach(x => { const k = map[x.status] || 'planned'; counts[x.status] = (counts[x.status] || 0) + 1; x._to = k; });
  const b = modal(`<h3>Импорт из Shikimori</h3><p class="muted">Найдено тайтлов: ${data.length}. Куда переносить списки:</p>
    <div class="list">${Object.entries(counts).map(([k, n]) => `<div class="folder"><span class="p">${esc(k)} <span class="muted">(${n})</span></span>→ ${`<select class="select" data-from="${esc(k)}">${LISTS.map(([v, l]) => `<option value="${v}" ${v === (map[k] || 'planned') ? 'selected' : ''}>В список «${l}»</option>`).join('')}</select>`}</div>`).join('')}</div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="imp-keep" checked> Не трогать тайтлы, которые уже есть в моих закладках</label>
    <div class="row-btns"><button class="btn" data-c>Отмена</button><button class="btn primary" data-ok>Перенести</button></div>`);
  b.querySelector('[data-c]').onclick = closeModal;
  b.querySelector('[data-ok]').onclick = async () => {
    const to = Object.fromEntries($$('[data-from]', b).map(s => [s.dataset.from, s.value]));
    const keep = $('#imp-keep', b).checked;
    b.innerHTML = '<h3>Импорт…</h3><div class="loading" id="imp-p">Загружаю данные тайтлов</div>';
    let n = 0;
    const ids = data.map(x => +x.target_id);
    const info = {};
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const d = await gql(animes({ ids: ids.slice(i, i + 50).join(','), limit: 50, rating: '' }, CARD + ' duration genres { russian kind }'));
        d.animes.forEach(a => { info[a.id] = a; });
      } catch { /* продолжим с тем, что есть */ }
      $('#imp-p', b).textContent = `Загружено ${Math.min(i + 50, ids.length)} из ${ids.length}`;
    }
    for (const x of data) {
      const id = +x.target_id;
      if (keep && S.list[id]?.status) continue;
      const a = info[id] || { id, russian: x.target_title_ru, name: x.target_title, episodes: x.episodes };
      const e = entryOf(a);
      e.status = to[x.status] || 'planned';
      e.statusAt = Date.now();
      if (x.score) { e.score = clamp(x.score / 2, 0.5, 5); e.scoredAt = Date.now(); }
      if (x.episodes) { e.ep = x.episodes; const m = S.marks[id] ??= {}; for (let k = 1; k <= x.episodes; k++) m[k] ??= Date.now(); }
      if (x.text) S.notes[id] ??= { text: x.text, spoiler: false, at: Date.now() };
      e.updated = Date.now();
      n++;
    }
    save();
    closeModal();
    toast(`Перенесено тайтлов: ${n}`);
    go('#/bookmarks');
  };
}
