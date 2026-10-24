'use strict';
/* Animax — динамическое оформление.
   Ничего не решает за интерфейс: только подсвечивает то, на что смотрит человек —
   курсор на карточках, активный пункт меню, прогресс прокрутки и цвет постера
   на странице тайтла. В лёгком режиме и при «уменьшении движения» выключается. */

(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = () => !LITE && !reduceMotion;

  // ---------- прогресс прокрутки и «стеклянная» шапка ----------
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.append(bar);

  let scrollRaf = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const v = $('#view');
      if (!v) return;
      const max = v.scrollHeight - v.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, v.scrollTop / max)) : 0;
      bar.style.transform = `scaleX(${p})`;
      const moved = v.scrollTop > 8;
      bar.classList.toggle('on', moved);
      document.body.classList.toggle('scrolled', moved);
    });
  }
  // scroll не всплывает — слушаем на фазе перехвата, поэтому работает и после замены #view
  document.addEventListener('scroll', e => { if (e.target?.id === 'view') onScroll(); }, { capture: true, passive: true });
  addEventListener('resize', onScroll, { passive: true });

  // ---------- скользящая подсветка активного пункта меню ----------
  const nav = $('.nav');
  let ink = null;
  if (nav) {
    ink = document.createElement('span');
    ink.className = 'nav-ink';
    nav.prepend(ink);
  }
  function moveInk() {
    if (!nav || !ink) return;
    const on = $('a.on', nav);
    if (!on) {
      if (ink.classList.contains('on')) ink.classList.remove('on');
      return;
    }
    const nr = nav.getBoundingClientRect();
    const or = on.getBoundingClientRect();
    const top = or.top - nr.top + nav.scrollTop;
    ink.style.height = or.height + 'px';
    ink.style.transform = `translateY(${top}px)`;
    // classList.add/remove меняют атрибут даже когда класс уже есть — проверяем заранее,
    // иначе MutationObserver зацикливается сам на себе
    if (!ink.classList.contains('on')) ink.classList.add('on');
  }
  if (nav && ink) {
    new MutationObserver(moveInk).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    nav.addEventListener('scroll', moveInk, { passive: true });
    addEventListener('resize', moveInk, { passive: true });
    moveInk();
  }

  // ---------- курсор: пятно света на карточках, плитках и кнопках ----------
  let ptrRaf = 0, ptr = null;
  function applyPointer() {
    ptrRaf = 0;
    if (!ptr) return;
    const { el, x, y } = ptr;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    el.style.setProperty('--mx', ((x - r.left) / r.width * 100).toFixed(2) + '%');
    el.style.setProperty('--my', ((y - r.top) / r.height * 100).toFixed(2) + '%');
    el.style.setProperty('--bx', (x - r.left).toFixed(0) + 'px');
    el.style.setProperty('--by', (y - r.top).toFixed(0) + 'px');
  }
  document.addEventListener('pointermove', e => {
    if (!fx() || e.pointerType === 'touch') return;

    // лёгкий параллакс фона баннера
    const hero = e.target.closest?.('.hero');
    if (hero) {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--hx', (((e.clientX - r.left) / r.width) - .5).toFixed(3));
      hero.style.setProperty('--hy', (((e.clientY - r.top) / r.height) - .5).toFixed(3));
    }

    const el = e.target.closest?.('.card .poster, .tile, .btn.primary');
    if (!el) return;
    ptr = { el, x: e.clientX, y: e.clientY };
    if (!ptrRaf) ptrRaf = requestAnimationFrame(applyPointer);
  }, { passive: true });

  // ---------- цвет постера → мягкое свечение страницы ----------
  const tintCache = new Map();
  function colorOf(image, cb) {
    const src = image.currentSrc || image.src;
    if (!src) return cb(null);
    if (tintCache.has(src)) return cb(tintCache.get(src));
    const finish = val => { tintCache.set(src, val); cb(val); };
    const draw = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 34;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(image, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        // раскладываем пиксели по 12 оттенкам и берём самый «весомый» —
        // так свечение получается цветным, а не средним серым
        const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 140) continue;
          const r = d[i], gg = d[i + 1], bb = d[i + 2];
          const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
          const v = mx / 255;
          if (v < .16) continue;
          const sat = mx ? (mx - mn) / mx : 0;
          const w = .03 + sat * sat * v;
          const bin = bins[Math.min(11, Math.floor(hueOf(r, gg, bb, mx, mn) / 30))];
          bin.w += w; bin.r += r * w; bin.g += gg * w; bin.b += bb * w;
        }
        const best = bins.reduce((a, b) => (b.w > a.w ? b : a), bins[0]);
        if (!best.w) return finish(null);
        let r = best.r / best.w, g2 = best.g / best.w, b = best.b / best.w;
        let mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
        let hue = hueOf(r, g2, b, mx, mn);
        const l0 = (mx + mn) / 2 / 255;
        const s0 = mx ? (mx - mn) / mx : 0;
        // насыщаем и слегка подсвечиваем: цвет должен читаться как свет, а не как грязь
        const sat = Math.round(clamp(s0 * 100 + 22, 46, 88));
        const light = Math.round(clamp(l0 * 100 + 18, 54, 72));
        finish(`hsl(${Math.round(hue)} ${sat}% ${light}%)`);
      } catch { finish(null); }
    };
    if (image.complete && image.naturalWidth) draw();
    else image.addEventListener('load', draw, { once: true });
  }
  function hueOf(r, g, b, mx, mn) {
    const d = mx - mn;
    if (!d) return 0;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function tintTarget(image, target) {
    if (!image || !target || image.dataset.tinted) return;
    image.dataset.tinted = '1';
    colorOf(image, col => { if (col) target.style.setProperty('--glow', col); });
  }
  function scanTints() {
    // баннер на «Обзоре»: цвет берём с постера, а не с размытого фона
    const hero = $('.hero');
    if (hero) tintTarget($('.in img', hero), hero);
    // страница тайтла
    const rel = $('.rel');
    if (rel) tintTarget($('.rel-left .poster', rel), rel);
  }
  let tintTimer = 0;
  const scheduleTint = () => {
    clearTimeout(tintTimer);
    tintTimer = setTimeout(scanTints, 180);
  };

  // ---------- активная вкладка всегда на виду (на узком окне вкладки прокручиваются) ----------
  function revealActiveTab() {
    const on = $('.tabs .tab.on');
    if (!on) return;
    const box = on.parentElement;
    if (!box || box.scrollWidth <= box.clientWidth + 2) return;
    const r = on.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (r.left >= br.left + 6 && r.right <= br.right - 6) return;
    const left = r.left - br.left + box.scrollLeft;
    box.scrollLeft = left - (box.clientWidth - r.width) / 2;
  }
  let tabTimer = 0;
  const scheduleTab = () => {
    clearTimeout(tabTimer);
    tabTimer = setTimeout(revealActiveTab, 140);
  };

  // ---------- следим за сменой экрана ----------
  const main = $('.main');
  if (main) {
    new MutationObserver(() => { scheduleTint(); scheduleTab(); onScroll(); }).observe(main, { childList: true, subtree: true });
  }

  // ---------- мелочи при старте ----------
  addEventListener('load', () => { moveInk(); scheduleTint(); scheduleTab(); onScroll(); });

  // «Наверх» при переходе: новый #view и так начинается сверху, но полосу прогресса сбрасываем сразу
  addEventListener('hashchange', () => {
    bar.classList.remove('on');
    document.body.classList.remove('scrolled');
  });
})();
