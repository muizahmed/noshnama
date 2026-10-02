/* Noshnama: UI, storage, Google sign-in and backup. Pure logic lives in logic.js (NoshLogic),
   the line icons in icons.js (NoshIcons). */
(() => {
  'use strict';
  const L = window.NoshLogic;
  const I = window.NoshIcons;

  /* ================= constants ================= */
  const CLIENT_ID = '829299043445-qvkjmmcbc2mb6res5ri8pgj0kllofid8.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  /* SHA-256 of the lowercased, trimmed email of each account allowed past the sign-in screen.
     This is a browser-side curtain, not security. */
  const ALLOWED = ['339b83f38ef378cc8bd76804134cd5473437e985eb9931e0f316c188dd11e51c'];
  const SHEET_NAME = 'Noshnama backup';
  const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
  const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
  const BACKUP_DELAY = 1500;
  const HOLD_MS = 380;   /* how long a usual is held before it can be dragged */
  /* On a developer machine the sign-in screen is skipped; add ?curtain=1 to see it there. */
  const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
  const FORCE_CURTAIN = DEV && /[?&]curtain=1(&|$)/.test(location.search);

  /* ----- WELCOME TEXT: shown after the first sign-in, in Elyana's own voice. These are the built-in
     words; her own welcome (Settings > Little notes) is kept in her data and replaces WELCOME_LINES. ----- */
  const WELCOME_TITLE = "Hi, I'm Elyana!";
  /* The first line greets her by the name she typed in Settings (kept in her data, never here):
     hello, comma, her name, "!" and then WELCOME_FIRST; with no name set, just hello and "!". */
  const WELCOME_HELLO = 'Seylam';
  const WELCOME_FIRST = 'This cosy little diary is my diet tracker.';
  const WELCOME_LINES = [
    'Whenever you log something yummy, I do a happy wiggle.',
    "There's no rush here. I'll be snuggled up, ready whenever you are."
  ];
  const WELCOME_BUTTON = "Let's begin";

  /* ----- ELYANA'S LINES: what she says when tapped. Soft and forward-looking; never about a
     shortfall. Her own notes (Settings > Little notes) are mixed in and favoured. ----- */
  const ELYANA_LINES = {
    any: [
      'Boop! That tickles.', 'Sending you a bunny hug.', "You're my favourite person.", 'I saved you the comfiest spot.',
      'My ears are all yours.', 'Wiggle wiggle!', 'I like it here with you.', 'Nose boops are the best.'
    ],
    sleepy: ['Snuggled up, ready whenever you are.', 'Dreaming of something yummy...', 'A tiny bunny yawn. Excuse me!', 'Five more cosy minutes?'],
    smiling: ['Waiting for my next little bite.', 'Every little bite makes me wiggle.', "Ooh, what's next?", 'That was a lovely bite.'],
    happy: ['Happy wiggle time!', 'My little heart is full.', 'So cosy, so happy.'],
    sparkly: ["I'm all sparkles today!", 'Bouncy, bouncy, bouncy!', 'What a lovely day.'],
    morning: ['Good morning! My ears woke up first.', 'Morning stretch... and boing!'],
    afternoon: ['Afternoon snuggles are the best.', 'Sunny afternoon, sunny bunny.'],
    evening: ["The evening feels cosy, doesn't it?", 'Evening cuddles, please.'],
    night: ['The stars are out. Sleepy bunny time soon.', 'Night night, sweet dreams.']
  };
  /* Said now and then right after one of these was logged (matched on the food's name). */
  const FOOD_LINES = [
    ['roti', 'Warm roti is my favourite smell.'], ['milk', 'Milk moustache! Do I have one too?'], ['fish', 'Fish! How fancy of us.'],
    ['date', 'Dates are sweet, like you.'], ['egg', 'Eggs-cellent choice. Hee hee.'], ['yog', 'Yoghurt is so cool and creamy.'],
    ['nut', 'Crunch crunch. I love nuts.'], ['cheese', 'Say cheese!'], ['corn', 'Corn looks like tiny suns.'], ['kabab', 'Mmm, that kabab smelled so good.']
  ];

  /* ================= tiny helpers ================= */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = (n) => L.fmtG(n);
  const n2 = (n) => L.fmtN(n);
  const ico = (key, cls) => I.svg(key, cls);
  const bubble = (key, cls) => '<span class="bubble' + (cls ? ' ' + cls : '') + '">' + ico(key) + '</span>';
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* ================= store: the one place that touches storage ================= */
  const Store = (() => {
    const KEY = L.STORE_KEY;
    let memory = null;
    return {
      read() {
        try {
          const raw = localStorage.getItem(KEY);
          return raw ? JSON.parse(raw) : memory;
        } catch (e) { return memory; }
      },
      write(doc) {
        memory = doc;
        try { localStorage.setItem(KEY, JSON.stringify(doc)); return true; } catch (e) { return false; }
      }
    };
  })();

  /* ================= state ================= */
  let data = L.normalize(Store.read());
  let today = L.dateKey(new Date());
  let viewDate = today;
  let tab = 'today';
  let sheet = null;            /* name of the open bottom sheet */
  let drag = null;             /* a usual being held or dragged */
  let shown = { key: '', total: 0 };
  let storageWarned = false;
  let token = { value: '', exp: 0 };   /* Google access token: memory only, never stored */
  let tokenClient = null;
  const bk = { running: false, again: false, error: false, timer: 0, hold: null, tabs: null, tabsId: '' };

  function persist() {
    const cutoff = L.addDays(today, -14);
    Object.keys(data.meta.celebrated).forEach((k) => { if (k < cutoff) delete data.meta.celebrated[k]; });
    if (!Store.write(data) && !storageWarned) {
      storageWarned = true;
      toast('This phone could not save just now. Use Export file in Settings to keep a copy.');
    }
  }
  function changed() {
    data.meta.rev += 1;
    persist();
    scheduleBackup();
  }

  /* ================= mascot ================= */
  /* Elyana, a baby bunny. All of her artwork is in this one function: swap the drawing here and
     nothing else changes. mood: sleepy | smiling | happy | sparkly. */
  function elyanaSvg(mood) {
    const pink = '#F9D6DC', deep = '#F3AEBC', cream = '#FFF7EE', line = '#8A6857', eye = '#4B332B', blush = '#F5A3B4', nose = '#D9768C', gold = '#E2B45A';
    const st = 'stroke="' + line + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
    const heart = (x, y, s, fill) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 3.4C-7-1.8-3.4-7.4 0-3.4 3.4-7.4 7-1.8 0 3.4Z" fill="' + fill + '"/>';
    const star = (x, y, s) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0-6Q.9-.9 6 0 .9.9 0 6-.9.9-6 0-.9-.9 0-6Z" fill="' + gold + '"/>';
    const sleepy = mood === 'sleepy';
    let eyes, mouth, extra = '';
    if (sleepy) {
      eyes = '<path d="M51 83q8.5 6 17 0M92 83q8.5 6 17 0" fill="none" ' + st + '/>';
      mouth = '<path d="M76.5 93.5q3.5 3 7 0" fill="none" stroke="' + line + '" stroke-width="2" stroke-linecap="round"/>';
      extra = '<g fill="none" stroke="' + line + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".7"><path d="M128 40h8l-8 9h8"/><path d="M141 24h5.5l-5.5 6.5h5.5"/></g>';
    } else if (mood === 'happy') {
      eyes = '<path d="M51 84q8.5-10 17 0M92 84q8.5-10 17 0" fill="none" ' + st + '/>';
      mouth = '<path d="M74 92.5q6 9 12 0Z" fill="' + nose + '" stroke="' + line + '" stroke-width="2" stroke-linejoin="round"/>';
      extra = '<g class="ely-float">' + heart(22, 52, 1.3, nose) + heart(140, 44, 1, blush) + heart(128, 18, .750, nose) + '</g>';
    } else {
      const big = mood === 'sparkly';
      const rx = big ? 9.5 : 8.5, ry = big ? 11 : 10;
      eyes = [60, 100].map((x) => '<ellipse cx="' + x + '" cy="82" rx="' + rx + '" ry="' + ry + '" fill="' + eye + '"/>' +
        '<ellipse cx="' + x + '" cy="85.5" rx="' + (rx - 3) + '" ry="' + (ry - 5.5) + '" fill="#8A5F4E" opacity=".55"/>' +
        '<circle cx="' + (x + 3) + '" cy="' + (big ? 76.5 : 77) + '" r="' + (big ? 3.8 : 3.3) + '" fill="#fff"/>' +
        '<circle cx="' + (x - 3.5) + '" cy="85.5" r="1.6" fill="#fff"/>' +
        (big ? '<path transform="translate(' + (x - 3) + ' 78) scale(.42)" d="M0-6Q.9-.9 6 0 .9.9 0 6-.9.9-6 0-.9-.9 0-6Z" fill="#fff"/>' : '')).join('');
      mouth = big
        ? '<path d="M74.5 92.5q5.5 8 11 0Z" fill="' + nose + '" stroke="' + line + '" stroke-width="2" stroke-linejoin="round"/>'
        : '<path d="M80 91q-3.5 4.5-8 1.5M80 91q3.5 4.5 8 1.5" fill="none" stroke="' + line + '" stroke-width="2" stroke-linecap="round"/>';
      if (big) extra = '<g class="ely-float">' + star(20, 46, 1.5) + star(142, 50, 1.2) + star(132, 16, .900) + star(34, 18, .700) + heart(24, 86, .700, nose) + '</g>';
    }
    /* arm on her left (our right): waving unless she is asleep */
    const wave = sleepy
      ? ''
      : '<g class="ely-wave"><ellipse cx="119" cy="104" rx="7.5" ry="13.5" transform="rotate(40 119 104)" fill="' + pink + '" ' + st + '/></g>' +
        '<path d="M137 84l4-5.5M142 94l6.5-2.5" fill="none" stroke="' + line + '" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>';
    const lower = sleepy
      /* tucked under a soft blanket */
      ? '<path d="M45 129q9-6 17.5-1t17.5 0 17.5 0 17.5 1q7 13 1 25-6 9-19 9H63q-13 0-19-9-6-12 1-25Z" fill="#F7E3D8" ' + st + '/>' +
        '<g fill="' + deep + '"><circle cx="60" cy="143" r="1.8"/><circle cx="80" cy="149" r="1.8"/><circle cx="100" cy="143" r="1.8"/><circle cx="70" cy="155" r="1.8"/><circle cx="91" cy="156" r="1.8"/></g>'
      : '<ellipse cx="66" cy="158" rx="11.5" ry="6.5" fill="' + pink + '" ' + st + '/><ellipse cx="94" cy="158" rx="11.5" ry="6.5" fill="' + pink + '" ' + st + '/>';
    return '<svg class="ely-svg" viewBox="0 0 160 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Elyana the baby bunny">' +
      /* fluffy tail */
      '<path d="M107 134a6.5 6.5 0 0 1 10-5 6.5 6.5 0 0 1 9 6 6.5 6.5 0 0 1-2 11 6.5 6.5 0 0 1-11 1 6.5 6.5 0 0 1-6-13Z" fill="' + cream + '" ' + st + '/>' +
      /* ears */
      '<path d="M60 52C46 34 42 10 53 5c11-4 19 18 21 42Z" fill="' + pink + '" ' + st + '/><path d="M60 42C53 30 50 16 55 13c5-2 9 12 11 27Z" fill="' + deep + '"/>' +
      '<path d="M87 46c3-24 14-44 24-38 9 6 1 30-11 45Z" fill="' + pink + '" ' + st + '/><path d="M94 40c2-14 8-25 13-22 4 3 0 16-6 25Z" fill="' + deep + '"/>' +
      /* body, tummy */
      '<ellipse cx="80" cy="132" rx="27" ry="27" fill="' + pink + '" ' + st + '/><ellipse cx="80" cy="137" rx="16" ry="18" fill="' + cream + '"/>' +
      (sleepy ? '' : '<ellipse cx="54" cy="126" rx="7.5" ry="11.5" transform="rotate(22 54 126)" fill="' + pink + '" ' + st + '/>') +
      lower +
      wave +
      /* big head */
      '<ellipse cx="80" cy="78" rx="45" ry="37" fill="' + pink + '" ' + st + '/>' +
      '<ellipse cx="80" cy="93" rx="17" ry="11.5" fill="' + cream + '"/>' +
      '<ellipse cx="44" cy="95" rx="8.5" ry="5" fill="' + blush + '" opacity=".8"/><ellipse cx="116" cy="95" rx="8.5" ry="5" fill="' + blush + '" opacity=".8"/>' +
      eyes +
      '<ellipse cx="80" cy="88.5" rx="3.3" ry="2.4" fill="' + nose + '"/>' + mouth +
      extra + '</svg>';
  }

  /* ================= toasts, moments, particles ================= */
  let toastTimer = 0;
  let toastEntry = '';   /* id of the entry the toast's - / + buttons change */
  function toast(msg, opts) {
    const o = opts || {};
    const box = $('#toasts');
    clearTimeout(toastTimer);
    toastEntry = o.entryId || '';
    box.innerHTML = '<div class="toast">' + (o.icon ? '<span class="toast-ico">' + ico(o.icon) + '</span>' : '') + '<span class="toast-msg"></span>' +
      (o.entryId ? '<button type="button" class="toast-step" data-act="toast-minus" aria-label="One less">' + ico('minus') + '</button>' +
        '<button type="button" class="toast-step" data-act="toast-plus" aria-label="One more">' + ico('plus') + '</button>' : '') +
      (o.undo ? '<button type="button" class="toast-undo">Undo</button>' : '') + '</div>';
    $('.toast-msg', box).textContent = msg;
    if (o.undo) $('.toast-undo', box).addEventListener('click', () => { hideToast(); o.undo(); });
    toastTimer = setTimeout(hideToast, o.ms || (o.undo ? 6500 : 3500));
  }
  function hideToast() { clearTimeout(toastTimer); toastEntry = ''; $('#toasts').innerHTML = ''; }
  const logLine = (e) => 'Yum! ' + e.name + ' × ' + n2(L.entryCount(e)) + ' · ' + g(e.protein) + ' g';
  /* The toast after logging: says what was logged, with - / + to change how many, and Undo. */
  function logToast(entry) {
    toast(logLine(entry), {
      icon: entry.icon, entryId: entry.id,
      undo: () => { data.log = data.log.filter((e) => e.id !== entry.id); changed(); render(); }
    });
  }
  /* - / + on the toast change that same entry (never a second one). */
  function toastStep(dir) {
    const e = data.log.find((x) => x.id === toastEntry);
    if (!e) { hideToast(); return; }
    const before = L.dayTotal(data.log, today);
    e.amount = L.round2(L.stepWhole(L.entryCount(e), dir) * e.servingAmount);
    e.protein = L.proteinFor(e.amount, e.servingAmount, e.proteinPer);
    e.updated = new Date().toISOString();
    changed();
    render();
    $('.toast-msg').textContent = logLine(e);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6500);
    celebrateIfCrossed(before);
  }
  const particlesOn = () => data.settings.celebrations === 'full' && !reducedMotion();
  const effectsOn = () => data.settings.celebrations !== 'off' && !reducedMotion();

  /* One particle engine for hearts, stars and dots, on a throwaway canvas that removes itself. */
  function burst(o) {
    if (!particlesOn()) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = o.colors || ['#D9768C', '#F5C6D0', '#E4DBF3', '#F1D9A2', '#CFE3D6'];
    const speed = o.speed || [4, 9];
    const parts = [];
    for (let i = 0; i < (o.count || 30); i++) {
      const a = ((o.angle === undefined ? -90 : o.angle) + (Math.random() - 0.5) * (o.spread === undefined ? 90 : o.spread)) * Math.PI / 180;
      const v = speed[0] + Math.random() * (speed[1] - speed[0]);
      parts.push({
        x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
        size: (o.size || 9) * (0.7 + Math.random() * 0.6), color: pick(colors), shape: Array.isArray(o.shape) ? pick(o.shape) : (o.shape || 'heart')
      });
    }
    const life = o.life || 1500, gravity = o.gravity === undefined ? 0.22 : o.gravity;
    const start = performance.now();
    (function frame(now) {
      const t = (now - start) / life;
      if (t >= 1 || !cv.isConnected) { cv.remove(); return; }
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach((p) => {
        p.vy += gravity; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t * t);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        const s = p.size;
        ctx.beginPath();
        if (p.shape === 'dot') ctx.arc(0, 0, s / 2.5, 0, 6.29);
        else if (p.shape === 'star') {
          for (let k = 0; k < 8; k++) { const r = k % 2 ? s * 0.28 : s * 0.7, an = k * Math.PI / 4; ctx.lineTo(Math.sin(an) * r, -Math.cos(an) * r); }
        } else {
          const u = s / 10;
          ctx.moveTo(0, 3.4 * u); ctx.bezierCurveTo(-7 * u, -1.8 * u, -3.4 * u, -7.4 * u, 0, -3.4 * u); ctx.bezierCurveTo(3.4 * u, -7.4 * u, 7 * u, -1.8 * u, 0, 3.4 * u);
        }
        ctx.fill(); ctx.restore();
      });
      requestAnimationFrame(frame);
    })(start);
  }
  function ringCentre() {
    const r = $('.ring');
    if (!r) return { x: innerWidth / 2, y: innerHeight / 3 };
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  /* The goal moments: a card that pops in, plus confetti on the Full setting. */
  function moment(kind) {
    if (data.settings.celebrations === 'off') return;
    document.querySelectorAll('.moment').forEach((m) => m.remove());
    const great = kind === 'great';
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'moment ' + (great ? 'moment-great' : 'moment-goal');
    el.innerHTML = '<span class="moment-art">' + elyanaSvg(great ? 'sparkly' : 'happy') + '</span>' +
      '<span class="moment-title">' + (great ? 'Amazing!' : 'Goal reached!') + '</span>' +
      '<span class="moment-sub">' + (great ? g(data.settings.greatGoal) + ' g today. Elyana is all sparkles.' : g(data.settings.goal) + ' g today. Elyana is doing a happy wiggle.') + '</span>';
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), great ? 5200 : 3800);
    const c = ringCentre();
    if (great) {
      burst({ x: c.x, y: c.y, count: 46, spread: 360, speed: [5, 12], shape: ['heart', 'star'], size: 13, life: 2000, gravity: 0.16 });
      setTimeout(() => burst({ x: innerWidth * 0.2, y: innerHeight * 0.35, count: 26, spread: 360, speed: [3, 9], shape: 'star', colors: ['#E2B45A', '#F1D9A2', '#D9768C'], size: 12, gravity: 0.12 }), 350);
      setTimeout(() => burst({ x: innerWidth * 0.8, y: innerHeight * 0.3, count: 26, spread: 360, speed: [3, 9], shape: ['heart', 'star'], colors: ['#E2B45A', '#E4DBF3', '#D9768C'], size: 12, gravity: 0.12 }), 700);
    } else {
      burst({ x: c.x, y: c.y, count: 34, spread: 150, speed: [5, 11], shape: 'heart', colors: ['#D9768C', '#F5C6D0', '#E2B45A', '#F1D9A2'], size: 12, life: 1700 });
    }
    if (effectsOn()) {
      const ring = $('.ring');
      if (ring) { ring.classList.remove('ring-pulse'); void ring.offsetWidth; ring.classList.add('ring-pulse'); }
    }
  }
  /* The food's icon floats up from where it was tapped. */
  function popIcon(key, fromEl) {
    if (!effectsOn() || !fromEl || !fromEl.isConnected) return;
    const b = fromEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'icon-pop';
    el.innerHTML = ico(key);
    el.style.left = (b.left + b.width / 2) + 'px';
    el.style.top = (b.top + Math.min(b.height / 2, 28)) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
  /* Celebrate when today's total crosses a goal: once per day for each goal. */
  function celebrateIfCrossed(beforeTotal) {
    const before = L.goalState(beforeTotal, data.settings).level;
    const after = L.goalState(L.dayTotal(data.log, today), data.settings).level;
    const done = data.meta.celebrated[today] || { goal: false, great: false };
    let kind = '';
    if (after >= 2 && before < 2 && !done.great) { kind = 'great'; done.goal = true; done.great = true; }
    else if (after >= 1 && before < 1 && !done.goal) { kind = 'goal'; done.goal = true; }
    if (!kind) return;
    data.meta.celebrated[today] = done;
    persist();
    moment(kind);
  }

  /* ================= rendering ================= */
  function render() {
    if (sheet || (drag && drag.active)) { renderPill(); return; }
    document.body.className = 'celeb-' + data.settings.celebrations;
    $('#viewToday').hidden = tab !== 'today';
    $('#viewFoods').hidden = tab !== 'foods';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('tab-on', b.dataset.tab === tab));
    $('.fab').setAttribute('aria-label', tab === 'foods' ? 'Add a food' : 'Add to the day');
    if (tab === 'today') renderToday(); else renderFoods();
    renderPill();
  }

  function statusLines(gs, isToday) {
    if (gs.level === 2) return ['Amazing!', isToday ? 'Elyana is all sparkles today' : 'A sparkly day'];
    if (gs.level === 1) return ['Goal reached!', isToday ? 'Elyana is doing a happy wiggle' : 'A happy goal day'];
    if (!isToday) return [gs.total > 0 ? g(gs.total) + ' g logged' : 'A quiet page', gs.total > 0 ? 'Elyana remembers this day' : 'Add something here any time'];
    if (gs.total > 0) return [g(gs.toGo) + ' g to go', 'Elyana is waiting for her next little bite'];
    return ['Hello, little day', 'Elyana is snuggled up, ready whenever you are'];
  }

  function ringHtml(gs, shownTotal) {
    const C = 2 * Math.PI * 52, C2 = 2 * Math.PI * 57;
    const sg = L.goalState(shownTotal, data.settings);
    return '<div class="ring ring-l' + gs.level + '" data-total="' + gs.total + '" data-level="' + gs.level + '">' +
      '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle class="ring-track" cx="60" cy="60" r="52"/>' +
      '<circle class="ring-arc" cx="60" cy="60" r="52" transform="rotate(-90 60 60)" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - sg.pct)).toFixed(2) + '" data-c="' + C.toFixed(2) + '"/>' +
      '<circle class="ring-arc2" cx="60" cy="60" r="57" transform="rotate(-90 60 60)" stroke-dasharray="' + C2.toFixed(2) + '" stroke-dashoffset="' + (C2 * (1 - sg.greatPct)).toFixed(2) + '" data-c="' + C2.toFixed(2) + '"/>' +
      '</svg>' +
      '<div class="ring-mid"><div class="ring-big"><span class="ring-num">' + g(shownTotal) + '</span><span class="ring-g">g</span></div>' +
      '<div class="ring-sub">of ' + g(gs.level >= 1 ? gs.greatGoal : gs.goal) + ' g</div></div></div>';
  }

  function renderToday() {
    const isToday = viewDate === today;
    const entries = L.dayEntries(data.log, viewDate);
    const total = L.sumProtein(entries);
    const gs = L.goalState(total, data.settings);
    const from = shown.key === viewDate && !reducedMotion() ? shown.total : total;
    const lines = statusLines(gs, isToday);
    const usual = L.usuals(data.foods);
    const groups = L.groupByMeal(entries);

    let h = '<h1 class="greet">' + esc(L.greeting(new Date().getHours(), data.settings.name)) + '</h1>';
    h += '<div class="daynav"><button type="button" class="navbtn" data-act="day-prev" aria-label="Previous day">' + ico('left') + '</button>' +
      '<button type="button" class="daylabel" data-act="day-pick"><b>' + esc(L.dayLabel(viewDate, today)) + '</b>' +
      (viewDate === today || viewDate === L.addDays(today, -1) ? '<small>' + esc(L.shortDate(viewDate, today)) + '</small>' : '') + '</button>' +
      '<button type="button" class="navbtn" data-act="day-next" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>' + ico('right') + '</button>' +
      '<input type="date" id="dayInput" class="ghost-input" tabindex="-1" aria-hidden="true" max="' + today + '" value="' + viewDate + '"></div>';

    h += '<section class="card hero hero-l' + gs.level + '">' +
      '<div class="hero-row">' + ringHtml(gs, from) +
      '<div class="hero-side"><button type="button" class="elyana mood-' + gs.mood + '" data-act="elyana" data-mood="' + gs.mood + '" aria-label="Elyana the baby bunny">' + elyanaSvg(gs.mood) + '</button></div></div>' +
      '<div class="hero-status"><b id="statusMain">' + esc(lines[0]) + '</b><span id="statusSub">' + esc(lines[1]) + '</span></div>' +
      '</section>';

    h += '<section class="block"><h2 class="block-title">Usuals</h2>';
    if (usual.length) {
      h += '<div class="usuals" id="usuals">' + usual.map((f) => '<button type="button" class="usual" data-act="usual" data-id="' + esc(f.id) + '">' + bubble(f.icon) +
        '<span class="usual-name">' + esc(f.name) + '</span><span class="usual-g">' + g(f.servings[0].protein) + ' g</span></button>').join('') + '</div>' +
        (usual.length > 1 ? '<p class="hint center-hint">Tap to log. Hold and drag to rearrange.</p>' : '');
    } else h += '<div class="empty">Your usuals will sit here. Add a food from the Foods tab.</div>';
    h += '</section>';

    h += '<section class="block" id="entries">';
    if (!groups.length) {
      h += '<div class="empty">' + (isToday ? 'Tap a usual or the + button to log your first bite of the day.' : 'Tap a usual or the + button to add something to this day.') + '</div>';
    }
    groups.forEach((grp) => {
      h += '<div class="meal"><div class="meal-head"><h2 class="block-title">' + grp.meal + '</h2><span class="meal-total">' + g(grp.total) + ' g</span></div><div class="card list">' +
        grp.entries.map((e) => '<button type="button" class="entry" data-act="entry" data-id="' + esc(e.id) + '">' + bubble(e.icon) +
          '<span class="entry-text"><span class="entry-name">' + esc(e.name) + '</span>' +
          '<span class="entry-sub">' + esc(L.entryLine(e) + ' · ' + L.fmtTime(e.time)) + (e.note ? ' · ' + esc(e.note) : '') + '</span></span>' +
          '<span class="entry-g">' + g(e.protein) + '<small> g</small></span></button>').join('') +
        '</div></div>';
    });
    h += '</section>';

    $('#viewToday').innerHTML = h;
    shown = { key: viewDate, total: total };
    if (from !== total) countUp(from, total);
  }

  let countRun = 0;
  function countUp(from, to) {
    const run = ++countRun;
    const num = $('.ring-num'), arc = $('.ring-arc'), arc2 = $('.ring-arc2');
    if (!num || !arc) return;
    const start = performance.now(), dur = 700;
    (function step(now) {
      if (run !== countRun || !num.isConnected) return;
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * e;
      const s = L.goalState(v, data.settings);
      num.textContent = t === 1 ? g(to) : g(Math.round(v));
      arc.setAttribute('stroke-dashoffset', (Number(arc.dataset.c) * (1 - s.pct)).toFixed(2));
      arc2.setAttribute('stroke-dashoffset', (Number(arc2.dataset.c) * (1 - s.greatPct)).toFixed(2));
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  function foodRow(f) {
    const s = f.servings[0];
    return '<button type="button" class="entry foodrow" data-act="food-edit" data-id="' + esc(f.id) + '">' + bubble(f.icon) +
      '<span class="entry-text"><span class="entry-name">' + esc(f.name) + '</span><span class="entry-sub">' + esc(L.servingLabel(s)) +
      (f.servings.length > 1 ? ' · +' + (f.servings.length - 1) + ' more' : '') + '</span></span>' +
      '<span class="entry-g">' + g(s.protein) + '<small> g</small></span></button>';
  }
  function renderFoods() {
    let h = '<div class="view-head"><h1 class="greet">My foods</h1></div>';
    const active = data.foods.filter((f) => !f.archived);
    L.CATEGORIES.forEach((cat) => {
      const list = active.filter((f) => f.category === cat);
      if (!list.length) return;
      h += '<section class="block"><h2 class="block-title">' + esc(cat) + '</h2><div class="card list">' + list.map(foodRow).join('') + '</div></section>';
    });
    if (!active.length) h += '<div class="empty">Your food list is ready for its first entry. Tap the + button.</div>';
    const archived = data.foods.filter((f) => f.archived);
    if (archived.length) {
      h += '<details class="block archived"><summary>Archived (' + archived.length + ')</summary><div class="card list">' + archived.map(foodRow).join('') + '</div></details>';
    }
    $('#viewFoods').innerHTML = h;
  }

  function pillInfo() {
    if (bk.running) return ['busy', 'Backing up…', ''];
    if (bk.error) return ['error', 'Backup failed', 'tap to retry'];
    if (data.meta.rev !== data.meta.backedRev) return ['pending', 'Backup pending', ''];
    const d = new Date(data.meta.lastBackup);
    const when = L.dateKey(d) === today ? L.fmtTime(L.timeKey(d)) : L.shortDate(L.dateKey(d), today);
    return ['ok', 'Backed up', when];
  }
  function renderPill() {
    const p = pillInfo();
    const pill = $('#pill');
    pill.className = 'pill pill-' + p[0];
    pill.dataset.state = p[0];
    pill.innerHTML = '<span class="pill-dot"></span><span>' + p[1] + '</span>' + (p[2] ? '<span class="pill-more">' + esc(p[2]) + '</span>' : '');
    const line = $('#backupLine');
    if (line) line.textContent = p[1] + (p[2] ? ' · ' + p[2] : '');
  }

  /* ================= usuals: hold and drag to rearrange ================= */
  /* A plain tap logs (the click handler). Holding a usual for a moment lifts it; while lifted it
     slips into the place of whichever usual the finger is over. Letting go saves her order, and the
     click that follows a drag is swallowed so a drag can never log anything. */
  let swallowClickUntil = 0;
  function dragStop(commit) {
    if (!drag) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    if (!d.active) return;
    d.el.classList.remove('lifted');
    const grid = $('#usuals');
    if (grid) grid.classList.remove('sorting');
    swallowClickUntil = Date.now() + 450;
    const ids = grid ? Array.from(grid.querySelectorAll('.usual')).map((el) => el.dataset.id) : [];
    if (commit && ids.join() !== d.before) {
      data.foods = L.reorderUsuals(data.foods, ids);
      changed();
    }
    render();
  }
  document.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest && ev.target.closest('.usual');
    if (!el || sheet || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    dragStop(false);
    const grid = $('#usuals');
    drag = { el: el, x: ev.clientX, y: ev.clientY, active: false, before: Array.from(grid.querySelectorAll('.usual')).map((u) => u.dataset.id).join() };
    drag.timer = setTimeout(() => {
      if (!drag || drag.el !== el) return;
      drag.active = true;
      el.classList.add('lifted');
      grid.classList.add('sorting');
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* not available */ }
    }, HOLD_MS);
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.active) {
      /* moved before the hold finished: this is a scroll or a stray move, not a drag */
      if (Math.abs(ev.clientX - drag.x) > 8 || Math.abs(ev.clientY - drag.y) > 8) { clearTimeout(drag.timer); drag = null; }
      return;
    }
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = over && over.closest ? over.closest('.usual') : null;
    if (!target || target === drag.el) return;
    const all = Array.from(target.parentNode.children);
    if (all.indexOf(drag.el) < all.indexOf(target)) target.after(drag.el); else target.before(drag.el);
  });
  document.addEventListener('pointerup', () => dragStop(true));
  document.addEventListener('pointercancel', () => dragStop(false));
  /* while a usual is lifted the page must not scroll under the finger */
  document.addEventListener('touchmove', (ev) => { if (drag && drag.active && ev.cancelable) ev.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (ev) => { if (ev.target.closest && ev.target.closest('.usual')) ev.preventDefault(); });

  /* ================= sheets and modal ================= */
  function openSheet(name, html) {
    checkDay();
    sheet = name;
    $('#sheetBody').innerHTML = html;
    const wrap = $('#sheetWrap');
    wrap.hidden = false;
    void wrap.offsetWidth;
    wrap.classList.add('open');
    $('#toasts').classList.add('toasts-top');
    $('.sheet', wrap).scrollTop = 0;
  }
  /* dropFields: the data was just replaced (restore, import), so the Settings fields on screen are stale. */
  function closeSheet(dropFields) {
    if (!sheet) return;
    if (sheet === 'settings' && dropFields !== true) syncSettings();
    sheet = null;
    const wrap = $('#sheetWrap');
    wrap.classList.remove('open');
    $('#toasts').classList.remove('toasts-top');
    setTimeout(() => { if (!sheet) { wrap.hidden = true; $('#sheetBody').innerHTML = ''; } }, reducedMotion() ? 0 : 240);
    render();
  }
  let modalDone = null;
  function ask(o) {
    if (modalDone) modalDone(false);
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = '<div class="backdrop" data-act="modal-cancel"></div><div class="modal-card" role="alertdialog" aria-modal="true">' +
        '<h2>' + esc(o.title) + '</h2><p>' + esc(o.body) + '</p><div class="modal-btns">' +
        '<button type="button" class="btn ghost" data-act="modal-cancel">' + esc(o.cancel || 'Cancel') + '</button>' +
        '<button type="button" class="btn primary" data-act="modal-ok">' + esc(o.ok || 'OK') + '</button></div></div>';
      m.hidden = false;
      modalDone = (v) => { modalDone = null; m.hidden = true; m.innerHTML = ''; resolve(v); };
    });
  }

  const whenFields = (prefix, time, date) =>
    '<div class="row2"><label class="field"><span>Time</span><input class="input" type="time" id="' + prefix + 'Time" value="' + esc(time) + '"></label>' +
    '<label class="field"><span>Date</span><input class="input" type="date" id="' + prefix + 'Date" max="' + today + '" value="' + esc(date) + '"></label></div>';
  function readWhen(prefix, fallbackTime, fallbackDate) {
    const t = $('#' + prefix + 'Time'), d = $('#' + prefix + 'Date');
    const time = t && L.isTimeKey(t.value) ? t.value : fallbackTime;
    let date = d && L.isDateKey(d.value) ? d.value : fallbackDate;
    if (date > today) date = today;
    return { time: time, date: date };
  }
  /* "How much": a count stepper and an amount box in the serving's unit, kept in step with each other. */
  const amountHtml = (prefix, amount, serving) =>
    '<div class="qty-row"><div class="stepper"><button type="button" class="step" data-act="' + prefix + '-minus" aria-label="Less">' + ico('minus') + '</button>' +
    '<output id="' + prefix + 'Qty">' + n2(L.countOf(amount, serving.amount)) + '</output>' +
    '<button type="button" class="step" data-act="' + prefix + '-plus" aria-label="More">' + ico('plus') + '</button></div>' +
    '<span class="qty-or">or</span>' +
    '<label class="amount"><input class="input" id="' + prefix + 'Amount" data-in="' + prefix + '-amount" type="number" inputmode="decimal" min="0" step="any" aria-label="Amount" value="' + esc(n2(amount)) + '">' +
    '<span class="amount-unit" id="' + prefix + 'Unit">' + esc(serving.unit) + '</span></label></div>';
  const typedAmount = (el, fallback) => { const v = parseFloat(el.value); return Number.isFinite(v) && v > 0 ? L.round2(v) : fallback; };

  let iconNow = L.DEFAULT_ICON;
  function iconPickerHtml(current) {
    iconNow = current || L.DEFAULT_ICON;
    return '<div class="field"><span>Icon</span><button type="button" class="icon-btn" id="iconBtn" data-act="icon-toggle" aria-label="Choose an icon">' + bubble(iconNow) + '<em>Change</em></button>' +
      '<div class="icon-grid" id="iconGrid" hidden>' + I.FOOD.map((k) => '<button type="button" class="icon-cell' + (k === iconNow ? ' icon-on' : '') + '" data-act="icon-pick" data-icon="' + k + '" aria-label="' + k + '">' + ico(k) + '</button>').join('') + '</div></div>';
  }

  /* ---------- quick add ---------- */
  let qa = null;
  function openQuickAdd() {
    checkDay();
    qa = { mode: 'list', q: '', foodId: '', servingId: '', amount: 1, time: L.timeKey(new Date()), date: viewDate, other: { name: '', protein: '', save: false } };
    openSheet('qa', quickAddHtml());
  }
  function qaListHtml() {
    const q = qa.q.trim().toLowerCase();
    const foods = data.foods.filter((f) => !f.archived && (!q || f.name.toLowerCase().includes(q)));
    return '<button type="button" class="pickrow pick-other" data-act="qa-other">' + bubble('sparkles') + '<span class="entry-text"><span class="entry-name">Something else</span><span class="entry-sub">A one-off, with your own grams</span></span></button>' +
      foods.map((f) => '<button type="button" class="pickrow" data-act="qa-food" data-id="' + esc(f.id) + '">' + bubble(f.icon) +
        '<span class="entry-text"><span class="entry-name">' + esc(f.name) + '</span><span class="entry-sub">' + esc(L.servingLabel(f.servings[0])) + '</span></span>' +
        '<span class="entry-g">' + g(f.servings[0].protein) + '<small> g</small></span></button>').join('') +
      (foods.length ? '' : '<div class="empty">Nothing by that name yet. Try "Something else" above.</div>');
  }
  const qaFood = () => data.foods.find((f) => f.id === qa.foodId);
  const qaServing = () => { const f = qaFood(); return f.servings.find((s) => s.id === qa.servingId) || f.servings[0]; };
  const qaProtein = () => { const s = qaServing(); return L.proteinFor(qa.amount, s.amount, s.protein); };
  function quickAddHtml() {
    if (qa.mode === 'list') {
      return '<h2 class="sheet-title">Add something yummy</h2>' +
        '<label class="search">' + ico('search') + '<input class="input" id="qaSearch" data-in="qa-search" type="search" autocomplete="off" placeholder="Search your foods" aria-label="Search your foods" value="' + esc(qa.q) + '"></label>' +
        '<div class="picklist" id="qaList">' + qaListHtml() + '</div>';
    }
    const back = '<button type="button" class="back" data-act="qa-back">' + ico('left') + 'All foods</button>';
    if (qa.mode === 'other') {
      return back + '<h2 class="sheet-title">Something else</h2>' +
        '<label class="field"><span>What was it?</span><input class="input" id="qaName" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Chana chaat" value="' + esc(qa.other.name) + '"></label>' +
        '<label class="field"><span>Protein (g)</span><input class="input" id="qaGrams" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" value="' + esc(qa.other.protein) + '"></label>' +
        iconPickerHtml(iconNow) +
        '<label class="tick"><input type="checkbox" id="qaSave"' + (qa.other.save ? ' checked' : '') + '><span>Save to my foods</span></label>' +
        whenFields('qa', qa.time, qa.date) +
        '<button type="button" class="btn primary wide" data-act="qa-add-other">Add</button>';
    }
    const f = qaFood(), s = qaServing();
    return back + '<div class="picked">' + bubble(f.icon, 'big') + '<h2 class="sheet-title">' + esc(f.name) + '</h2></div>' +
      (f.servings.length > 1 ? '<div class="field"><span>Serving</span><div class="chips">' + f.servings.map((x) =>
        '<button type="button" class="chip' + (x.id === s.id ? ' chip-on' : '') + '" data-act="qa-serving" data-id="' + esc(x.id) + '">' + esc(L.servingLabel(x)) + '<span class="chip-g">' + g(x.protein) + ' g</span></button>').join('') + '</div></div>' : '') +
      '<div class="field"><span class="split">How much <i class="per">' + esc(L.servingLabel(s)) + ' = ' + g(s.protein) + ' g protein</i></span>' + amountHtml('qa', qa.amount, s) +
      '<div class="live" id="qaLive">' + g(qaProtein()) + ' g protein</div></div>' +
      whenFields('qa', qa.time, qa.date) +
      '<button type="button" class="btn primary wide" data-act="qa-add" id="qaAdd">Add ' + g(qaProtein()) + ' g</button>';
  }
  function qaSync() {
    const w = readWhen('qa', qa.time, qa.date);
    qa.time = w.time; qa.date = w.date;
    if ($('#qaName')) { qa.other.name = $('#qaName').value; qa.other.protein = $('#qaGrams').value; qa.other.save = $('#qaSave').checked; }
  }
  function qaRedraw() { qaSync(); $('#sheetBody').innerHTML = quickAddHtml(); }
  /* Refreshes the count, amount and protein; the amount box is left alone while she is typing in it. */
  function qaLive(fromBox) {
    const p = g(qaProtein());
    $('#qaQty').textContent = n2(L.countOf(qa.amount, qaServing().amount));
    if (!fromBox) $('#qaAmount').value = n2(qa.amount);
    $('#qaLive').textContent = p + ' g protein';
    $('#qaAdd').textContent = 'Add ' + p + ' g';
  }
  function qaStep(dir) {
    const s = qaServing();
    qa.amount = L.round2(L.stepCount(L.countOf(qa.amount, s.amount), dir) * s.amount);
    qaLive(false);
  }

  /* ---------- logging ---------- */
  function addEntry(entry, fromEl) {
    const before = L.dayTotal(data.log, today);
    data.log.push(entry);
    changed();
    popIcon(entry.icon, fromEl);
    if (sheet) { viewDate = entry.date; closeSheet(); } else render();
    logToast(entry);
    celebrateIfCrossed(before);
  }
  function logUsual(id, el) {
    checkDay();
    const food = data.foods.find((f) => f.id === id);
    if (!food) return;
    const now = new Date();
    addEntry(L.makeEntry({ food: food, serving: food.servings[0], count: 1, date: viewDate, time: L.timeKey(now), now: now.toISOString() }), el);
  }

  /* ---------- edit entry ---------- */
  let ed = null;
  function openEdit(id) {
    const e = data.log.find((x) => x.id === id);
    if (!e) return;
    const food = data.foods.find((f) => f.id === e.foodId);
    const options = food ? food.servings.map((s) => ({ amount: s.amount, unit: s.unit, protein: s.protein })) : [];
    let sel = options.findIndex((o) => o.amount === e.servingAmount && o.unit === e.unit && o.protein === e.proteinPer);
    if (sel < 0) { options.unshift({ amount: e.servingAmount, unit: e.unit, protein: e.proteinPer }); sel = 0; }
    ed = { id: id, amount: e.amount, options: options, sel: sel };
    openSheet('edit', '<div class="picked">' + bubble(e.icon, 'big') + '<h2 class="sheet-title">' + esc(e.name) + '</h2></div>' +
      (options.length > 1 ? '<div class="field"><span>Serving</span><div class="chips" id="edServings">' + options.map((o, i) =>
        '<button type="button" class="chip' + (i === sel ? ' chip-on' : '') + '" data-act="ed-serving" data-i="' + i + '">' + esc(L.servingLabel(o)) + '<span class="chip-g">' + g(o.protein) + ' g</span></button>').join('') + '</div></div>' : '') +
      '<div class="field"><span>How much</span>' + amountHtml('ed', e.amount, options[sel]) + '</div>' +
      '<label class="field"><span>Protein (g)</span><input class="input" id="edProtein" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(g(e.protein)) + '"></label>' +
      whenFields('ed', e.time, e.date) +
      '<label class="field"><span>Note</span><input class="input" id="edNote" type="text" maxlength="80" autocomplete="off" placeholder="Anything to remember" value="' + esc(e.note) + '"></label>' +
      '<button type="button" class="btn primary wide" data-act="ed-save">Save</button>' +
      '<button type="button" class="btn ghost wide" data-act="ed-delete">Delete</button>');
  }
  function edRecalc(fromBox) {
    const o = ed.options[ed.sel];
    $('#edQty').textContent = n2(L.countOf(ed.amount, o.amount));
    if (!fromBox) $('#edAmount').value = n2(ed.amount);
    $('#edUnit').textContent = o.unit;
    $('#edProtein').value = g(L.proteinFor(ed.amount, o.amount, o.protein));
  }
  function edStep(dir) {
    const o = ed.options[ed.sel];
    ed.amount = L.round2(L.stepCount(L.countOf(ed.amount, o.amount), dir) * o.amount);
    edRecalc(false);
  }
  function saveEdit() {
    const e = data.log.find((x) => x.id === ed.id);
    if (!e) { closeSheet(); return; }
    const before = L.dayTotal(data.log, today);
    const w = readWhen('ed', e.time, e.date);
    const o = ed.options[ed.sel];
    const typed = parseFloat($('#edProtein').value);
    e.servingAmount = o.amount; e.unit = o.unit; e.proteinPer = o.protein; e.amount = ed.amount;
    e.protein = Number.isFinite(typed) && typed >= 0 ? L.round2(typed) : L.proteinFor(ed.amount, o.amount, o.protein);
    e.time = w.time; e.date = w.date;
    e.note = $('#edNote').value.trim();
    e.updated = new Date().toISOString();
    changed();
    viewDate = e.date;
    closeSheet();
    toast('Saved');
    celebrateIfCrossed(before);
  }
  function deleteEdit() {
    const i = data.log.findIndex((x) => x.id === ed.id);
    if (i < 0) { closeSheet(); return; }
    const gone = data.log.splice(i, 1)[0];
    changed();
    closeSheet();
    toast('Removed ' + gone.name, { undo: () => { data.log.splice(Math.min(i, data.log.length), 0, gone); changed(); render(); } });
  }

  /* ---------- food editor ---------- */
  let fd = null;
  function openFood(id) {
    const f = id ? data.foods.find((x) => x.id === id) : null;
    fd = f ? { id: f.id, name: f.name, category: f.category, archived: f.archived, usual: f.usual !== false, servings: f.servings.map((s) => ({ id: s.id, amount: n2(s.amount), unit: s.unit, protein: String(s.protein) })) }
      : { id: '', name: '', category: 'Other', archived: false, usual: true, servings: [{ id: L.uid('s'), amount: '1', unit: '', protein: '' }] };
    iconNow = f ? f.icon : L.DEFAULT_ICON;
    openSheet('food', foodHtml());
  }
  function foodHtml() {
    return '<h2 class="sheet-title">' + (fd.id ? 'Edit food' : 'New food') + '</h2>' +
      '<label class="field"><span>Name</span><input class="input" id="fdName" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Daal" value="' + esc(fd.name) + '"></label>' +
      iconPickerHtml(iconNow) +
      '<div class="field"><span>Category</span><div class="chips">' + L.CATEGORIES.map((c) =>
        '<button type="button" class="chip' + (c === fd.category ? ' chip-on' : '') + '" data-act="fd-cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div></div>' +
      '<div class="field"><span>Servings</span>' +
      '<div class="serving-row serving-head"><i>Amount</i><i>Unit</i><i>Protein g</i><i></i></div><div id="fdServings">' + fd.servings.map((s, i) =>
        '<div class="serving-row"><input class="input sv-amount" type="number" inputmode="decimal" min="0" step="any" placeholder="1" aria-label="Amount" value="' + esc(s.amount) + '">' +
        '<input class="input sv-unit" type="text" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="bowl" aria-label="Unit" value="' + esc(s.unit) + '">' +
        '<input class="input sv-protein" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" aria-label="Protein in grams" value="' + esc(s.protein) + '">' +
        '<button type="button" class="iconbtn sv-x" data-act="fd-serving-x" data-i="' + i + '" aria-label="Remove serving"' + (fd.servings.length < 2 ? ' disabled' : '') + '>' + ico('close') + '</button></div>').join('') +
      '</div><button type="button" class="btn text" data-act="fd-serving-add">' + ico('plus') + 'Add serving</button>' +
      '<small class="hint">For example 350 ml = 10 g, or 1 roti = 6 g. The first serving is the one a single tap logs.</small></div>' +
      '<label class="tick"><input type="checkbox" id="fdUsual"' + (fd.usual ? ' checked' : '') + '><span>Show in usuals</span></label>' +
      '<button type="button" class="btn primary wide" data-act="fd-save">Save</button>' +
      (fd.id ? '<button type="button" class="btn ghost wide" data-act="fd-archive">' + (fd.archived ? 'Bring back from archive' : 'Archive') + '</button>' : '');
  }
  function fdSync() {
    fd.name = $('#fdName').value;
    fd.usual = $('#fdUsual').checked;
    document.querySelectorAll('#fdServings .serving-row').forEach((row, i) => {
      fd.servings[i].amount = $('.sv-amount', row).value;
      fd.servings[i].unit = $('.sv-unit', row).value;
      fd.servings[i].protein = $('.sv-protein', row).value;
    });
  }
  function fdRedraw() { const open = !$('#iconGrid').hidden; $('#sheetBody').innerHTML = foodHtml(); $('#iconGrid').hidden = !open; }
  function saveFood() {
    fdSync();
    const name = fd.name.trim();
    const servings = fd.servings.filter((s) => s.unit.trim()).map((s) => {
      const amount = L.num(s.amount, 1);
      return { id: s.id, amount: amount > 0 ? L.round2(amount) : 1, unit: s.unit.trim(), protein: Math.max(0, L.num(s.protein)) };
    });
    if (!name) { toast('Give it a name first'); return; }
    if (!servings.length) { toast('Add a serving with a unit, like 1 bowl'); return; }
    let f = data.foods.find((x) => x.id === fd.id);
    if (!f) {
      f = { id: L.uid('f'), name: '', icon: '', category: 'Other', servings: [], archived: false, usual: true, created: new Date().toISOString() };
      data.foods.push(f);
    }
    f.name = name; f.icon = iconNow; f.category = fd.category; f.servings = servings; f.usual = fd.usual;
    changed();
    closeSheet();
    toast('Saved ' + name);
  }

  /* ---------- settings ---------- */
  function openSettings() {
    const s = data.settings;
    const p = pillInfo();
    openSheet('settings', '<h2 class="sheet-title">Settings</h2>' +
      '<label class="field"><span>Your name</span><input class="input" id="stName" data-in="settings" type="text" maxlength="30" autocomplete="off" placeholder="For the greeting" value="' + esc(s.name) + '"></label>' +
      '<div class="row2"><label class="field"><span>Goal (g)</span><input class="input" id="stGoal" data-in="settings" type="number" inputmode="decimal" min="1" step="1" value="' + esc(g(s.goal)) + '"></label>' +
      '<label class="field"><span>Great goal (g)</span><input class="input" id="stGreat" data-in="settings" type="number" inputmode="decimal" min="1" step="1" value="' + esc(g(s.greatGoal)) + '"></label></div>' +
      '<div class="field"><span>Celebrations</span><div class="seg" id="stCeleb">' + L.CELEBRATION_LEVELS.map((c) =>
        '<button type="button" class="seg-btn' + (c === s.celebrations ? ' seg-on' : '') + '" data-act="st-celeb" data-level="' + c + '">' + c.charAt(0).toUpperCase() + c.slice(1) + '</button>').join('') + '</div></div>' +
      '<h3 class="sheet-sub">Backup</h3><p class="hint">Saved to a spreadsheet called "' + SHEET_NAME + '" in your own Google Drive. <b id="backupLine">' + esc(p[1] + (p[2] ? ' · ' + p[2] : '')) + '</b></p>' +
      '<div class="btn-grid"><button type="button" class="btn soft" data-act="st-backup">Back up now</button><button type="button" class="btn soft" data-act="st-restore">Restore from backup</button>' +
      '<button type="button" class="btn soft" data-act="st-export">Export file</button><button type="button" class="btn soft" data-act="st-import">Import file</button></div>' +
      '<button type="button" class="btn ghost wide" data-act="st-signout">Sign out</button>' +
      '<p class="tiny center">Noshnama ' + L.APP_VERSION + '</p>' +
      '<button type="button" class="quiet-link" data-act="st-notes">Little notes</button>');
  }
  function syncSettings() {
    const name = $('#stName');
    if (!name) return;
    const s = data.settings;
    const next = { name: name.value.trim(), goal: L.num($('#stGoal').value, s.goal), greatGoal: L.num($('#stGreat').value, s.greatGoal) };
    if (!(next.goal > 0)) next.goal = s.goal;
    if (!(next.greatGoal > 0)) next.greatGoal = s.greatGoal;
    if (next.name === s.name && next.goal === s.goal && next.greatGoal === s.greatGoal) return;
    s.name = next.name; s.goal = next.goal; s.greatGoal = next.greatGoal;
    changed();
  }

  /* ---------- little notes: her own welcome message and lines for Elyana (kept in her data) ---------- */
  function openNotes() {
    syncSettings();
    sheet = null;
    openSheet('notes', '<h2 class="sheet-title">Little notes</h2>' +
      '<label class="field"><span>Welcome message</span><textarea class="input area" id="lnWelcome" rows="4" placeholder="One line per row. Leave empty for the built-in welcome."></textarea></label>' +
      '<label class="field"><span>Things Elyana says when tapped</span><textarea class="input area" id="lnNotes" rows="6" placeholder="One note per row. They are mixed in with her built-in lines."></textarea></label>' +
      '<button type="button" class="btn primary wide" data-act="ln-save">Save</button>' +
      '<button type="button" class="btn ghost wide" data-act="ln-welcome">Show welcome again</button>');
    $('#lnWelcome').value = data.settings.welcomeLines.join('\n');
    $('#lnNotes').value = data.settings.notes.join('\n');
  }
  function saveNotes() {
    const w = L.normLines($('#lnWelcome').value.split('\n'));
    const n = L.normLines($('#lnNotes').value.split('\n'));
    const s = data.settings;
    if (JSON.stringify([w, n]) === JSON.stringify([s.welcomeLines, s.notes])) return;
    s.welcomeLines = w; s.notes = n;
    changed();
  }

  function replaceData(incoming) {
    data.foods = incoming.foods;
    data.log = incoming.log;
    data.settings = incoming.settings;
    data.meta.celebrated = incoming.celebrated || {};
    shown = { key: '', total: 0 };
  }
  function exportFile() {
    const doc = L.exportDoc(data, new Date().toISOString());
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'noshnama-' + today + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Export file saved');
  }
  async function importFile(file) {
    let incoming;
    try { incoming = L.importDoc(JSON.parse(await file.text())); }
    catch (e) { toast('That file does not look like a Noshnama export.'); return; }
    const n = incoming.log.length;
    const ok = await ask({ title: 'Import this file?', body: 'It has ' + n + (n === 1 ? ' entry' : ' entries') + ' and ' + incoming.foods.length + ' foods. It replaces what is on this phone now.', ok: 'Import' });
    if (!ok) return;
    replaceData(incoming);
    changed();
    closeSheet(true);
    render();
    toast('Imported');
  }

  /* ================= Google: token, sign-in curtain ================= */
  const tokenValid = () => !!token.value && Date.now() < token.exp - 60000;
  async function sha256(text) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  /* Opens Google's window, so this must be called straight from a tap: never on load or a timer. */
  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        if (!(window.google && google.accounts && google.accounts.oauth2)) { reject(new Error('Google has not loaded. Check the internet and try again.')); return; }
        tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: () => {} });
      }
      tokenClient.callback = (resp) => {
        if (!resp || resp.error || !resp.access_token) { reject(new Error('Google sign-in did not finish. Please try again.')); return; }
        token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        resolve();
      };
      tokenClient.error_callback = () => reject(new Error('The Google window closed before finishing. Please try again.'));
      const options = {};
      if (prompt !== undefined) options.prompt = prompt;
      tokenClient.requestAccessToken(options);
    });
  }
  async function api(url, options) {
    const opts = options || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + token.value }, opts.body ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) token = { value: '', exp: 0 };
      const err = new Error((body.error && body.error.message) || ('Google answered ' + res.status));
      err.status = res.status;
      throw err;
    }
    return body;
  }
  async function accountHash() {
    const me = await api(USERINFO_API);
    return sha256(String(me.email || '').trim().toLowerCase());
  }
  /* For backup taps: get a fresh pass if the old one ran out, and make sure it is the same account. */
  async function tokenFromTap() {
    if (tokenValid()) return;
    await requestToken('');
    if (data.meta.curtain && (await accountHash()) !== data.meta.curtain) {
      token = { value: '', exp: 0 };
      throw new Error('That is a different Google account. Please pick the one this app was set up with.');
    }
  }

  const curtainPassed = () => (DEV && !FORCE_CURTAIN) || ALLOWED.includes(data.meta.curtain);
  function showCurtain(mode, hash) {
    $('#app').hidden = true;
    $('#welcome').hidden = true;
    const c = $('#curtain');
    c.hidden = false;
    if (mode === 'other') {
      c.innerHTML = '<div class="curtain-card"><div class="curtain-art">' + elyanaSvg('sleepy') + '</div>' +
        '<h1 class="curtain-title">This little app is just for one person</h1>' +
        '<p>If it was shared with you, send this code to the person who shared it and they can add you.</p>' +
        '<code class="hash" id="curtainHash">' + esc(hash) + '</code>' +
        '<button type="button" class="btn primary wide" data-act="sign-in-other">Try another account</button><p class="tiny" id="curtainNote"></p></div>';
    } else {
      c.innerHTML = '<div class="curtain-card"><div class="curtain-art">' + elyanaSvg('smiling') + '</div>' +
        '<h1 class="brand brand-big">Noshnama</h1><p>A cosy little protein diary.</p>' +
        '<button type="button" class="btn primary wide" data-act="sign-in">Sign in with Google</button><p class="tiny" id="curtainNote"></p></div>';
    }
  }
  async function signIn(prompt) {
    const note = () => $('#curtainNote');
    try {
      const wait = requestToken(prompt);
      if (note()) note().textContent = 'Waiting for Google…';
      await wait;
      const hash = await accountHash();
      if (ALLOWED.includes(hash)) {
        data.meta.curtain = hash;
        persist();
        enterApp();
      } else {
        token = { value: '', exp: 0 };
        showCurtain('other', hash);
      }
    } catch (e) {
      if (note()) note().textContent = e.message;
    }
  }
  function signOut() {
    data.meta.curtain = '';
    token = { value: '', exp: 0 };
    persist();
    sheet = null;
    $('#sheetWrap').classList.remove('open');
    $('#sheetWrap').hidden = true;
    $('#toasts').classList.remove('toasts-top');
    hideToast();
    showCurtain('signin');
  }
  function enterApp() {
    $('#curtain').hidden = true;
    $('#curtain').innerHTML = '';
    if (!data.meta.welcomed) {
      const w = $('#welcome');
      w.innerHTML = '<div class="curtain-card"><div class="curtain-art">' + elyanaSvg('smiling') + '</div>' +
        '<h1 class="curtain-title"></h1><div id="welcomeLines"></div>' +
        '<button type="button" class="btn primary wide" data-act="welcome-done"></button></div>';
      $('.curtain-title', w).textContent = WELCOME_TITLE;
      $('.btn', w).textContent = WELCOME_BUTTON;
      const own = data.settings.welcomeLines;
      const name = data.settings.name.trim();
      const builtIn = [WELCOME_HELLO + (name ? ', ' + name : '') + '! ' + WELCOME_FIRST].concat(WELCOME_LINES);
      (own.length ? own : builtIn).forEach((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        $('#welcomeLines', w).appendChild(p);
      });
      $('#app').hidden = true;
      w.hidden = false;
      return;
    }
    $('#welcome').hidden = true;
    $('#app').hidden = false;
    render();
    if (tokenValid()) runBackup();
  }

  /* ================= backup to her own Drive ================= */
  function scheduleBackup() {
    renderPill();
    clearTimeout(bk.timer);
    if (!tokenValid() || bk.hold) return;
    bk.timer = setTimeout(runBackup, BACKUP_DELAY);
  }
  async function findSheet() {
    const q = encodeURIComponent("name='" + SHEET_NAME + "' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const found = await api(DRIVE_API + '?q=' + q + '&fields=files(id,name)&orderBy=modifiedTime%20desc');
    return found.files && found.files.length ? found.files[0].id : '';
  }
  async function readSheets(id) {
    const r = await api(SHEETS_API + '/' + id + '/values:batchGet?' + L.TABS.map((t) => 'ranges=' + t).join('&') + '&valueRenderOption=UNFORMATTED_VALUE');
    const tabs = {};
    L.TABS.forEach((t, i) => { tabs[t] = (r.valueRanges && r.valueRanges[i] && r.valueRanges[i].values) || []; });
    return L.fromSheets(tabs);
  }
  /* Which spreadsheet to write to. An existing backup that this phone has never written is not
     overwritten: the user is asked first (bk.hold), and null is returned. */
  async function linkSheet() {
    if (data.meta.sheetId) return data.meta.sheetId;
    if (bk.hold) return null;
    const found = await findSheet();
    if (found) {
      let remote = null;
      try { remote = await readSheets(found); } catch (e) { if (e.status === 401) throw e; }
      if (remote && remote.log.length) {
        bk.hold = { id: found, remote: remote };
        offerRestore();
        return null;
      }
      data.meta.sheetId = found;
    } else {
      const made = await api(SHEETS_API, { method: 'POST', body: JSON.stringify({ properties: { title: SHEET_NAME }, sheets: L.TABS.map((t) => ({ properties: { title: t } })) }) });
      data.meta.sheetId = made.spreadsheetId;
    }
    persist();
    return data.meta.sheetId;
  }
  /* Makes sure the three tabs exist and are tall enough for what is about to be written. */
  async function prepareTabs(id, rows) {
    if (!bk.tabs || bk.tabsId !== id) {
      const info = await api(SHEETS_API + '/' + id + '?fields=sheets.properties(sheetId,title,gridProperties.rowCount)');
      bk.tabs = {}; bk.tabsId = id;
      (info.sheets || []).forEach((s) => { bk.tabs[s.properties.title] = { sheetId: s.properties.sheetId, rows: (s.properties.gridProperties || {}).rowCount || 1000 }; });
    }
    const requests = [];
    L.TABS.forEach((t) => {
      const have = bk.tabs[t], want = rows[t].length;
      if (!have) requests.push({ addSheet: { properties: { title: t, gridProperties: { rowCount: Math.max(1000, want + 1000) } } } });
      else if (have.rows < want) requests.push({ updateSheetProperties: { properties: { sheetId: have.sheetId, gridProperties: { rowCount: want + 1000 } }, fields: 'gridProperties.rowCount' } });
    });
    if (requests.length) {
      bk.tabs = null;
      await api(SHEETS_API + '/' + id + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: requests }) });
    }
  }
  async function writeBackup() {
    const id = await linkSheet();
    if (!id) return false;
    const rows = L.toSheets(data, new Date().toISOString());
    await prepareTabs(id, rows);
    await api(SHEETS_API + '/' + id + '/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges: L.TABS }) });
    await api(SHEETS_API + '/' + id + '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: L.TABS.map((t) => ({ range: t + '!A1', values: rows[t] })) }) });
    return true;
  }
  /* Rewrites the backup tabs from local data. Runs when a valid token is in memory; it never asks for one. */
  async function runBackup() {
    clearTimeout(bk.timer);
    if (bk.running) { bk.again = true; return; }
    if (!tokenValid()) { renderPill(); return; }
    bk.running = true; bk.error = false;
    renderPill();
    const rev = data.meta.rev;
    let written = false;
    try {
      try { written = await writeBackup(); }
      catch (e) {
        /* the remembered spreadsheet is gone: forget it and start a new one */
        if (e.status !== 404 || !data.meta.sheetId) throw e;
        data.meta.sheetId = ''; bk.tabs = null;
        written = await writeBackup();
      }
      if (written) { data.meta.backedRev = rev; data.meta.lastBackup = Date.now(); persist(); }
    } catch (e) {
      bk.error = true;
      bk.tabs = null;
    }
    bk.running = false;
    renderPill();
    const more = bk.again || data.meta.rev !== rev;
    bk.again = false;
    if (more && written && !bk.error) scheduleBackup();
  }
  function applyRestore(remote, id) {
    replaceData(remote);
    data.meta.sheetId = id;
    data.meta.rev += 1;
    data.meta.backedRev = data.meta.rev;
    if (!data.meta.lastBackup) data.meta.lastBackup = Date.parse(remote.savedAt) || Date.now();
    bk.hold = null; bk.error = false;
    persist();
    if (sheet) closeSheet(true); else render();
    toast('Restored from backup');
  }
  async function offerRestore() {
    const h = bk.hold;
    if (!h) return;
    const n = h.remote.log.length;
    const ok = await ask({
      title: 'Welcome back!',
      body: 'There is a Noshnama backup in this Google account with ' + n + (n === 1 ? ' entry' : ' entries') + '. Restore it onto this phone?' +
        (data.log.length ? ' It replaces what is on this phone now.' : ''),
      ok: 'Restore from backup', cancel: 'Not now'
    });
    if (ok && bk.hold === h) applyRestore(h.remote, h.id);
    else renderPill();
  }
  async function pillTap() {
    if (bk.running) return;
    try { await tokenFromTap(); } catch (e) { toast(e.message); return; }
    if (bk.hold) { offerRestore(); return; }
    runBackup();
  }
  async function backupNow() {
    if (bk.running) return;
    try { await tokenFromTap(); } catch (e) { toast(e.message); return; }
    if (bk.hold) {
      const ok = await ask({ title: 'Replace the backup?', body: 'The backup in Google Drive has ' + bk.hold.remote.log.length + ' entries from before. Backing up now replaces it with what is on this phone.', ok: 'Replace backup' });
      if (!ok) return;
      data.meta.sheetId = bk.hold.id;
      bk.hold = null;
      persist();
    }
    await runBackup();
    toast(bk.error ? 'Backup did not go through. Please try again in a moment.' : 'Backed up');
  }
  async function restoreNow() {
    try {
      await tokenFromTap();
      const id = data.meta.sheetId || (bk.hold && bk.hold.id) || await findSheet();
      if (!id) { toast('There is no backup in this Google account yet.'); return; }
      const remote = await readSheets(id);
      if (!remote.foods.length && !remote.log.length) { toast('That backup is empty, so nothing was changed.'); return; }
      const n = remote.log.length;
      const ok = await ask({ title: 'Restore from backup?', body: 'The backup has ' + n + (n === 1 ? ' entry' : ' entries') + '. It replaces what is on this phone now.', ok: 'Restore' });
      if (ok) applyRestore(remote, id);
    } catch (e) {
      toast(e.status ? 'Could not read the backup just now. Please try again.' : e.message);
    }
  }

  /* ================= keeping "today" right in an app left open ================= */
  function checkDay() {
    const now = L.dateKey(new Date());
    if (now === today) return;
    const wasToday = viewDate === today;
    today = now;
    if (wasToday) viewDate = today;
    render();
  }

  /* ================= Elyana taps ================= */
  let lastLine = '';
  function elyanaLine(mood) {
    const hour = new Date().getHours();
    const part = hour < 5 || hour >= 21 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const own = data.settings.notes;
    const latest = L.dayEntries(data.log, today).sort((a, b) => (a.created < b.created ? 1 : -1))[0];
    const food = latest && FOOD_LINES.find((f) => latest.name.toLowerCase().includes(f[0]));
    const r = Math.random();
    let pool;
    if (own.length && r < 0.6) pool = own;
    else if (food && r > 0.8) pool = [food[1]];
    else pool = (ELYANA_LINES[mood] || []).concat(ELYANA_LINES[mood] || [], ELYANA_LINES[part], ELYANA_LINES.any);
    const fresh = pool.filter((t) => t !== lastLine);
    lastLine = pick(fresh.length ? fresh : pool);
    return lastLine;
  }
  let elyTaps = [];
  let sayTimer = 0;
  function elyanaTap(btn) {
    const now = Date.now();
    elyTaps = elyTaps.filter((t) => now - t < 2500);
    elyTaps.push(now);
    const mood = btn.dataset.mood;
    const sub = $('#statusSub');
    if (elyTaps.length >= 5) {
      elyTaps = [];
      if (effectsOn()) { btn.classList.remove('ely-spin'); void btn.offsetWidth; btn.classList.add('ely-spin'); }
      const b = btn.getBoundingClientRect();
      burst({ x: b.left + b.width / 2, y: b.top + b.height / 2, count: 28, spread: 360, speed: [3, 8], shape: 'heart', size: 12, gravity: 0.100 });
      if (sub) sub.textContent = 'Wheee! Elyana loves a twirl.';
    } else {
      if (effectsOn()) { btn.classList.remove('ely-boop'); void btn.offsetWidth; btn.classList.add('ely-boop'); }
      if (sub) sub.textContent = elyanaLine(mood);
    }
    if (sub) sub.classList.add('said');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (!sheet && tab === 'today') render(); }, 4500);
  }

  /* ================= events ================= */
  const acts = {
    'tab': (el) => { tab = el.dataset.tab; window.scrollTo(0, 0); render(); },
    'fab': () => (tab === 'foods' ? openFood('') : openQuickAdd()),
    'settings': () => openSettings(),
    'pill': () => pillTap(),
    'sheet-close': () => closeSheet(false),
    'modal-ok': () => modalDone && modalDone(true),
    'modal-cancel': () => modalDone && modalDone(false),
    'day-prev': () => { viewDate = L.addDays(viewDate, -1); render(); },
    'day-next': () => { if (viewDate < today) { viewDate = L.addDays(viewDate, 1); render(); } },
    'day-pick': () => { const i = $('#dayInput'); i.max = today; i.value = viewDate; try { i.showPicker(); } catch (e) { i.focus(); i.click(); } },
    'elyana': (el) => elyanaTap(el),
    'usual': (el) => logUsual(el.dataset.id, el),
    'toast-minus': () => toastStep(-1),
    'toast-plus': () => toastStep(1),
    'entry': (el) => openEdit(el.dataset.id),
    'qa-food': (el) => { qa.mode = 'food'; qa.foodId = el.dataset.id; qa.servingId = ''; qa.amount = qaServing().amount; qaRedraw(); },
    'qa-other': () => { qa.mode = 'other'; iconNow = L.DEFAULT_ICON; qaRedraw(); },
    'qa-back': () => { qa.mode = 'list'; qaRedraw(); },
    'qa-serving': (el) => {
      const count = L.countOf(qa.amount, qaServing().amount);
      qa.servingId = el.dataset.id;
      qa.amount = L.round2(count * qaServing().amount);
      qaRedraw();
    },
    'qa-minus': () => qaStep(-1),
    'qa-plus': () => qaStep(1),
    'qa-add': (el) => {
      qaSync();
      addEntry(L.makeEntry({ food: qaFood(), serving: qaServing(), amount: qa.amount, date: qa.date, time: qa.time, now: new Date().toISOString() }), el);
    },
    'qa-add-other': (el) => {
      qaSync();
      const name = qa.other.name.trim();
      const grams = parseFloat(qa.other.protein);
      if (!name) { toast('What was it? Give it a little name.'); return; }
      if (!Number.isFinite(grams) || grams < 0) { toast('Add the grams of protein.'); return; }
      const stamp = new Date().toISOString();
      const serving = { id: L.uid('s'), amount: 1, unit: 'serving', protein: L.round2(grams) };
      let food = null;
      if (qa.other.save) {
        food = { id: L.uid('f'), name: name, icon: iconNow, category: 'Other', servings: [serving], archived: false, usual: true, created: stamp };
        data.foods.push(food);
      }
      addEntry(L.makeEntry({ food: food, serving: serving, name: name, icon: iconNow, count: 1, date: qa.date, time: qa.time, now: stamp }), el);
    },
    'ed-minus': () => edStep(-1),
    'ed-plus': () => edStep(1),
    'ed-serving': (el) => {
      const count = L.countOf(ed.amount, ed.options[ed.sel].amount);
      ed.sel = Number(el.dataset.i);
      ed.amount = L.round2(count * ed.options[ed.sel].amount);
      document.querySelectorAll('#edServings .chip').forEach((c, i) => c.classList.toggle('chip-on', i === ed.sel));
      edRecalc(false);
    },
    'ed-save': () => saveEdit(),
    'ed-delete': () => deleteEdit(),
    'food-edit': (el) => openFood(el.dataset.id),
    'fd-cat': (el) => { fdSync(); fd.category = el.dataset.cat; fdRedraw(); },
    'fd-serving-add': () => { fdSync(); fd.servings.push({ id: L.uid('s'), amount: '1', unit: '', protein: '' }); fdRedraw(); const rows = document.querySelectorAll('#fdServings .sv-unit'); rows[rows.length - 1].focus(); },
    'fd-serving-x': (el) => { fdSync(); if (fd.servings.length > 1) { fd.servings.splice(Number(el.dataset.i), 1); fdRedraw(); } },
    'fd-save': () => saveFood(),
    'fd-archive': () => {
      const f = data.foods.find((x) => x.id === fd.id);
      if (!f) return;
      f.archived = !f.archived;
      changed();
      closeSheet();
      toast(f.archived ? f.name + ' is tucked away in the archive' : f.name + ' is back in your foods');
    },
    'icon-toggle': () => { const grid = $('#iconGrid'); grid.hidden = !grid.hidden; },
    'icon-pick': (el) => {
      iconNow = el.dataset.icon;
      $('#iconBtn .bubble').innerHTML = ico(iconNow);
      document.querySelectorAll('.icon-cell').forEach((c) => c.classList.toggle('icon-on', c === el));
      $('#iconGrid').hidden = true;
    },
    'st-celeb': (el) => {
      data.settings.celebrations = el.dataset.level;
      document.querySelectorAll('#stCeleb .seg-btn').forEach((b) => b.classList.toggle('seg-on', b === el));
      changed();
    },
    'st-backup': () => { syncSettings(); backupNow(); },
    'st-restore': () => restoreNow(),
    'st-export': () => { syncSettings(); exportFile(); },
    'st-import': () => { const i = $('#importFile'); i.value = ''; i.click(); },
    'st-signout': () => { syncSettings(); signOut(); },
    'st-notes': () => openNotes(),
    'ln-save': () => { saveNotes(); closeSheet(); toast('Little notes saved'); },
    'ln-welcome': () => { saveNotes(); data.meta.welcomed = false; persist(); closeSheet(); enterApp(); },
    'sign-in': () => signIn(),
    'sign-in-other': () => signIn('select_account'),
    'welcome-done': () => { data.meta.welcomed = true; persist(); enterApp(); }
  };

  /* a click that ends a drag is swallowed here, before anything else sees it */
  document.addEventListener('click', (ev) => {
    if (Date.now() < swallowClickUntil) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = acts[el.dataset.act];
    if (fn) fn(el, ev);
  });
  document.addEventListener('input', (ev) => {
    const kind = ev.target.dataset && ev.target.dataset.in;
    if (kind === 'qa-search') { qa.q = ev.target.value; $('#qaList').innerHTML = qaListHtml(); }
    else if (kind === 'qa-amount') { qa.amount = typedAmount(ev.target, qa.amount); qaLive(true); }
    else if (kind === 'ed-amount') { ed.amount = typedAmount(ev.target, ed.amount); edRecalc(true); }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dayInput') {
      if (L.isDateKey(t.value)) { viewDate = t.value > today ? today : t.value; render(); }
    } else if (t.id === 'importFile') {
      if (t.files && t.files[0]) importFile(t.files[0]);
    } else if (t.dataset && t.dataset.in === 'settings') syncSettings();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (modalDone) modalDone(false); else if (sheet) closeSheet(false);
  });
  window.addEventListener('focus', checkDay);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDay(); renderPill(); } });
  setInterval(() => { checkDay(); renderPill(); }, 60000);

  /* ================= start ================= */
  document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  $('#gear').innerHTML = ico('settings');
  if (!data.meta.seeded) {
    data.foods = L.seedFoods(new Date().toISOString()).concat(data.foods);
    data.meta.seeded = true;
    persist();
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not available */ }
  if (curtainPassed()) enterApp(); else showCurtain('signin');
})();
