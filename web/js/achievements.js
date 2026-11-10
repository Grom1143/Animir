'use strict';
// Анимир - достижения. Считаются на месте, из своих же данных: ничего не отправляется и не требует сети.
// Полученные запоминаются в S.achievements (id -> когда), новые показываются одной строкой-сообщением.

const ACHIEVEMENTS = [
  { id: 'first', ic: '👣', n: 'Первый шаг', d: 'Отметить первую серию', goal: 1, val: s => s.eps },
  { id: 'ep10', ic: '🎬', n: 'Во вкусе', d: '10 отмеченных серий', goal: 10, val: s => s.eps },
  { id: 'ep50', ic: '📺', n: 'Серийный зритель', d: '50 отмеченных серий', goal: 50, val: s => s.eps },
  { id: 'ep500', ic: '🚀', n: 'Марафонец', d: '500 отмеченных серий', goal: 500, val: s => s.eps },
  { id: 'ep1000', ic: '👑', n: 'Тысячник', d: '1000 отмеченных серий', goal: 1000, val: s => s.eps },
  { id: 'done1', ic: '🏁', n: 'До конца', d: 'Досмотреть первый тайтл', goal: 1, val: s => s.done },
  { id: 'done10', ic: '🏆', n: 'Коллекционер итогов', d: '10 досмотренных тайтлов', goal: 10, val: s => s.done },
  { id: 'done50', ic: '📚', n: 'Полка', d: '50 досмотренных тайтлов', goal: 50, val: s => s.done },
  { id: 'score20', ic: '⭐', n: 'С чувством', d: '20 поставленных оценок', goal: 20, val: s => s.scored },
  { id: 'score100', ic: '🌟', n: 'Критик', d: '100 поставленных оценок', goal: 100, val: s => s.scored },
  { id: 'night20', ic: '🌙', n: 'Ночная сова', d: '20 серий после полуночи', goal: 20, val: s => s.night },
  { id: 'streak7', ic: '🔥', n: 'Неделя подряд', d: '7 дней просмотра без пропусков', goal: 7, val: s => s.streak },
  { id: 'streak30', ic: '☄️', n: 'Месяц подряд', d: '30 дней подряд', goal: 30, val: s => s.streak },
  { id: 'days100', ic: '🗓', n: 'Свой график', d: 'Смотрел в 100 разных дней', goal: 100, val: s => s.days },
  { id: 'drop5', ic: '🫡', n: 'Честно бросил', d: '5 брошенных тайтлов - тоже опыт', goal: 5, val: s => s.dropped },
  { id: 'coll5', ic: '🗂', n: 'Собиратель', d: '5 своих коллекций', goal: 5, val: s => s.collections },
  { id: 'comm10', ic: '💬', n: 'Разговорчивый', d: '10 комментариев', goal: 10, val: s => s.comments },
  { id: 'review1', ic: '✍️', n: 'Есть мнение', d: 'Первый отзыв', goal: 1, val: s => s.reviews },
];

function achiStats() {
  const log = S.watchLog || [];
  const entries = Object.values(S.list || {});
  const nums = [...new Set(log.map(w => {
    const d = new Date(w.at);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }))].sort((a, b) => a - b);
  let streak = 0, run = 0;
  nums.forEach((d, i) => {
    run = i && d === nums[i - 1] + 1 ? run + 1 : 1;
    streak = Math.max(streak, run);
  });
  return {
    eps: log.length,
    days: nums.length,
    streak,
    night: log.filter(w => new Date(w.at).getHours() < 5).length,
    done: entries.filter(e => e.status === 'completed').length,
    dropped: entries.filter(e => e.status === 'dropped').length,
    scored: entries.filter(e => e.score).length,
    collections: (S.collections || []).length,
    comments: (S.myComments || []).length,
    reviews: (S.myReviews || []).length,
  };
}

function achiList() {
  const st = achiStats();
  return ACHIEVEMENTS.map(a => ({ ...a, got: a.val(st) >= a.goal, cur: Math.min(a.val(st), a.goal) }));
}

// Проверка новых достижений: вызывается при запуске и после отметок серий.
// Новые показываем по одному сообщению, полученные запоминаем в S.achievements.
function checkAchievements(quiet = false) {
  S.achievements = S.achievements || {};
  const fresh = achiList().filter(a => a.got && !S.achievements[a.id]);
  if (!fresh.length) return [];
  fresh.forEach(a => { S.achievements[a.id] = Date.now(); });
  save();
  if (!quiet) fresh.slice(0, 2).forEach(a => toast(`${a.ic} Достижение: ${a.n}`, 'ok'));
  return fresh;
}

// Блок для страницы профиля: полученные цветные, остальные с прогрессом
function achievementsBlock() {
  const list = achiList();
  const got = list.filter(a => a.got).length;
  return `<div class="sec-head"><h2>Достижения</h2><span class="sub">${got} из ${list.length}</span></div>
    <div class="achi-grid">${list.map(a => `<div class="achi ${a.got ? 'got' : ''}" title="${esc(a.d)}">
      <span class="ic">${a.got ? a.ic : '🔒'}</span>
      <b>${esc(a.n)}</b>
      <small>${a.got ? 'получено' : `${a.cur} из ${a.goal}`}</small></div>`).join('')}</div>`;
}
