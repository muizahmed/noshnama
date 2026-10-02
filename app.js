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
  /* ----- PROGRESS LINES: the little moments at a quarter, half and three quarters of the day's goal
     (once a day each, lighter than the goal moments). ----- */
  const PROGRESS_LINES = {
    q25: ['A quarter of the way. Nibble nibble!', 'One little quarter, all done.'],
    q50: ['Halfway there! My ears are perking up.', 'Half a ring, and I am all smiles.'],
    q75: ['Three quarters! Nearly time to wiggle.', 'So close to my happy wiggle.']
  };
  /* Said once, on an evening (from 8 pm) when the day has entries and no note yet; never twice a day. */
  const NOTE_NUDGE = 'Want to jot down how today felt?';
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
  /* Stored data is repaired, then migrated from the schema it was saved under (v1.1.1 phones hold schema 2). */
  const stored = Store.read();
  const storedSchema = stored && stored.meta ? stored.meta.schema : undefined;
  let data = L.migrate(L.normalize(stored), storedSchema);
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
  /* Elyana, a baby bunny (redrawn for v1.2: softer, rounder, bigger eyes, a little tilt and a wave).
     All of her artwork is in these three functions. mood: sleepy | smiling | happy | sparkly.
     acc: what she wears ('' | bow | scarf | star | crown | hat). crop 'head': her head and neck, for
     the dress-up thumbnails; crop 'face': her head alone, for the home-screen icon. */
  function elyanaSvg(mood, acc, crop) {
    const headOnly = crop === 'head' || crop === 'face';
    const pink = '#F9D9DF', deep = '#F2B3C1', cream = '#FFF8F0', line = '#A47F6E', eye = '#4A3129', blush = '#F6A9B9', nose = '#DE8296', gold = '#E3B65E';
    const sw = 1.6;
    const st = 'stroke="' + line + '" stroke-width="' + sw + '" stroke-linejoin="round" stroke-linecap="round"';
    const heart = (x, y, s, fill) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 3.4C-7-1.8-3.4-7.4 0-3.4 3.4-7.4 7-1.8 0 3.4Z" fill="' + fill + '"/>';
    const star = (x, y, s, fill) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0-6Q.9-.9 6 0 .9.9 0 6-.9.9-6 0-.9-.9 0-6Z" fill="' + (fill || gold) + '"/>';
    const sleepy = mood === 'sleepy';
    let eyes, mouth, extra = '';
    if (sleepy) {
      eyes = '<path d="M55 86.5q8 6.5 16 0M89 86.5q8 6.5 16 0" fill="none" ' + st + ' stroke-width="1.9"/>' +
        '<path d="M55.5 87l-2.6 1.6M104.5 87l2.6 1.6" fill="none" ' + st + ' stroke-width="1.4"/>';
      mouth = '<path d="M76.5 100.5q3.5 2.6 7 0" fill="none" ' + st + '/>';
      extra = '<g fill="none" stroke="' + line + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".6"><path d="M126 46h7l-7 8h7"/><path d="M138 30h5l-5 6h5"/></g>';
    } else if (mood === 'happy') {
      eyes = '<path d="M55 89q8-10.5 16 0M89 89q8-10.5 16 0" fill="none" ' + st + ' stroke-width="2.1"/>';
      mouth = '<path d="M74.5 98.5q5.5 1.6 11 0q-1 6.5-5.5 6.5t-5.5-6.5Z" fill="' + nose + '" ' + st + ' stroke-width="1.4"/>';
      extra = '<g class="ely-float">' + heart(24, 58, 1.25, nose) + heart(138, 50, 1, blush) + heart(126, 24, .75, nose) + '</g>';
    } else {
      const big = mood === 'sparkly';
      const rx = big ? 10.5 : 9.8, ry = big ? 12 : 11.2;
      eyes = [63, 97].map((x) =>
        '<path d="' + (x < 80 ? 'M' + (x - rx + 1.6) + ' 80.6q-2.2-.4-3.6-2.6' : 'M' + (x + rx - 1.6) + ' 80.6q2.2-.4 3.6-2.6') + '" fill="none" ' + st + ' stroke-width="1.4"/>' +
        '<ellipse cx="' + x + '" cy="86" rx="' + rx + '" ry="' + ry + '" fill="' + eye + '"/>' +
        '<ellipse cx="' + x + '" cy="' + (90.5) + '" rx="' + (rx - 3.4) + '" ry="' + (ry - 6.2) + '" fill="#7E5646" opacity=".7"/>' +
        '<circle cx="' + (x + 3.4) + '" cy="' + (big ? 80.5 : 81) + '" r="' + (big ? 4.6 : 4.2) + '" fill="#fff"/>' +
        '<circle cx="' + (x - 3.8) + '" cy="91" r="2" fill="#fff"/>' +
        (big ? star(x - 3.6, 82, .5, '#fff') + star(x + 4.8, 92, .32, '#fff') : '<circle cx="' + (x + 4.6) + '" cy="91.6" r=".9" fill="#fff"/>')).join('');
      mouth = big
        ? '<path d="M74.5 99q5.5 1.6 11 0q-1 7-5.5 7t-5.5-7Z" fill="' + nose + '" ' + st + ' stroke-width="1.4"/>'
        : '<path d="M80 98.6q-2.4 3.6-6 1.6M80 98.6q2.4 3.6 6 1.6" fill="none" ' + st + ' stroke-width="1.5"/>';
      if (big) extra = '<g class="ely-float">' + star(22, 52, 1.5) + star(140, 56, 1.2) + star(132, 20, .9) + star(30, 22, .7) + heart(22, 92, .7, nose) + '</g>';
    }
    /* waving paw on her left (our right), unless she is asleep */
    const wave = sleepy ? '' :
      '<g class="ely-wave"><ellipse cx="104.5" cy="120" rx="7" ry="10.5" transform="rotate(34 104.5 120)" fill="' + pink + '" ' + st + '/>' +
      '<path d="M106.8 112.4q2.4-.2 3.6 1.6" fill="none" stroke="' + deep + '" stroke-width="1.5" stroke-linecap="round"/></g>' +
      '<path d="M120 104l3.4-4.4M123.5 113l5.4-1.4" fill="none" stroke="' + line + '" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>';
    const lower = sleepy
      ? '<path d="M50 133q8-5.5 15.5-1t15.5 0 15.5 0 15.5 1q6 11 .8 21.5-5 7.5-16.5 7.5H66q-11.5 0-16.5-7.5-5-10.5.5-21.5Z" fill="#F7E4DA" ' + st + '/>' +
        '<g fill="' + deep + '"><circle cx="63" cy="145" r="1.6"/><circle cx="80" cy="150" r="1.6"/><circle cx="97" cy="145" r="1.6"/><circle cx="71" cy="156" r="1.6"/><circle cx="89" cy="156" r="1.6"/></g>'
      : '<ellipse cx="69.5" cy="157.5" rx="9.5" ry="5.6" fill="' + pink + '" ' + st + '/><ellipse cx="90.5" cy="157.5" rx="9.5" ry="5.6" fill="' + pink + '" ' + st + '/>' +
        '<ellipse cx="69.5" cy="158.2" rx="3.2" ry="2" fill="' + deep + '"/><ellipse cx="90.5" cy="158.2" rx="3.2" ry="2" fill="' + deep + '"/>';
    const earL = sleepy ? 'rotate(-14 64 56)' : 'rotate(-6 64 56)';
    const earR = sleepy ? 'rotate(16 96 56)' : 'rotate(10 96 56)';
    const head =
      /* ears: the left one up, the right one with a soft fold */
      '<g transform="' + earL + '"><g class="ely-ear ely-ear-l"><path d="M58 58C49 42 45 20 52 11c6-7 15 3 18 17 2 10 2 20 1 28Z" fill="' + pink + '" ' + st + '/><path d="M60 50c-5-11-7-25-4-30 4-4 8 5 10 14 1 6 1 12 0 17Z" fill="' + deep + '"/></g></g>' +
      '<g transform="' + earR + '"><g class="ely-ear ely-ear-r"><path d="M89 56c0-9 1-19 5-27 4-9 12-14 17-9 3 3 2 9-1 15l-5 9c-3 5-6 10-8 16Z" fill="' + pink + '" ' + st + '/><path d="M94 50c1-8 3-16 6-21 3-5 7-6 8-3 1 2-1 6-3 10l-4 7Z" fill="' + deep + '"/>' +
      '</g></g>' +
      /* round head with chubby cheeks */
      '<path d="M80 44.5C102.5 44.5 118 60 119 81c.6 12.4-4.4 22.4-13.4 28C98 114.2 89.6 116 80 116s-18-1.8-25.6-7C45.4 103.4 40.4 93.4 41 81 42 60 57.5 44.5 80 44.5Z" fill="' + pink + '" ' + st + '/>' +
      '<ellipse cx="80" cy="102" rx="13" ry="8.6" fill="' + cream + '"/>' +
      '<ellipse cx="52.5" cy="99" rx="7.4" ry="4.8" fill="' + blush + '" opacity=".75"/><ellipse cx="107.5" cy="99" rx="7.4" ry="4.8" fill="' + blush + '" opacity=".75"/>' +
      eyes +
      '<path d="M77.4 95.2c0-1.4 1.2-2 2.6-2s2.6.6 2.6 2c0 1.2-1.4 2.2-2.6 2.6-1.2-.4-2.6-1.4-2.6-2.6Z" fill="' + nose + '"/>' + mouth +
      elyAccHead(acc, line);
    const svgOpen = '<svg class="ely-svg' + (headOnly ? ' ely-cropped' : '') + '" viewBox="' + (crop === 'face' ? '30 4 100 116' : headOnly ? '28 6 104 124' : '12 4 136 162') + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Elyana the baby bunny">';
    if (crop === 'face') return svgOpen + '<g class="ely-head" transform="rotate(-5 80 112)"><g class="ely-bob">' + head + '</g></g></svg>';
    return svgOpen +
      /* fluffy tail */
      '<path d="M101 140a6 6 0 0 1 9-4.5 6 6 0 0 1 8.4 5.4 6 6 0 0 1-1.8 10 6 6 0 0 1-10 1 6 6 0 0 1-5.6-11.9Z" fill="' + cream + '" ' + st + '/>' +
      /* small body and tummy */
      '<ellipse cx="80" cy="138" rx="22" ry="21" fill="' + pink + '" ' + st + '/><ellipse cx="80" cy="142" rx="13" ry="14" fill="' + cream + '"/>' +
      (sleepy ? '' : '<ellipse cx="64.5" cy="134" rx="5.6" ry="8.4" transform="rotate(-22 64.5 134)" fill="' + pink + '" ' + st + '/>') +
      elyAccNeck(acc, line) +
      lower + (headOnly ? '' : wave) +
      '<g class="ely-head" transform="rotate(-5 80 112)"><g class="ely-bob">' + head + '</g></g>' + (headOnly ? '' : extra) + '</svg>';
  }
  /* Her accessories, drawn in the same soft line art. On the head (follows its tilt): bow, crown, star, hat.
     Around the neck: scarf (drawn under the blanket when she is asleep). */
  function elyAccHead(acc, line) {
    const c = { line: line };
    const o = 'stroke="' + line + '" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"';
    if (acc === 'bow') {
      return '<g class="acc acc-bow" transform="rotate(-18 58 53)">' +
        '<path d="M58 53c-4.6-6.4-12.4-7.4-13-2-.5 4.6 6.6 6.2 13 2Z" fill="#E79AAE" ' + o + '/>' +
        '<path d="M58 53c4.6-6.4 12.4-7.4 13-2 .5 4.6-6.6 6.2-13 2Z" fill="#E79AAE" ' + o + '/>' +
        '<path d="M56.6 54.6l-3.4 6.2M59.4 54.6l3 6" fill="none" ' + o + '/>' +
        '<path d="M48.8 50.6q2.6.2 4.4 1.6M67.2 50.6q-2.6.2-4.4 1.6" fill="none" stroke="#C9768C" stroke-width="1" stroke-linecap="round"/>' +
        '<ellipse cx="58" cy="53" rx="2.8" ry="2.6" fill="#DE8296" ' + o + '/></g>';
    }
    if (acc === 'crown') {
      const flower = (x, y, fill, r) => '<g transform="translate(' + x + ' ' + y + ')">' + [0, 72, 144, 216, 288].map((a) =>
        '<circle cx="' + (Math.sin(a * Math.PI / 180) * r * 1.05).toFixed(2) + '" cy="' + (-Math.cos(a * Math.PI / 180) * r * 1.05).toFixed(2) + '" r="' + r + '" fill="' + fill + '" stroke="' + c.line + '" stroke-width=".9"/>').join('') +
        '<circle r="' + (r * .78).toFixed(2) + '" fill="#F3D27A" stroke="' + c.line + '" stroke-width=".8"/></g>';
      const leaf = (x, y, rot) => '<path transform="translate(' + x + ' ' + y + ') rotate(' + rot + ')" d="M0 0q3-3.6 6.4 0-3.4 3.6-6.4 0Z" fill="#B9D3B0" stroke="' + c.line + '" stroke-width=".9"/>';
      return '<g class="acc acc-crown"><path d="M51 59.5Q80 41 109 59.5" fill="none" stroke="#9CBF92" stroke-width="1.6" stroke-linecap="round"/>' +
        leaf(56, 55, -40) + leaf(73, 47.5, -12) + leaf(90, 47.6, 196) + leaf(104, 55.6, 222) +
        flower(52.5, 57.6, '#F7C6D2', 2.4) + flower(65, 50.2, '#E4DBF3', 2.6) + flower(80, 47.4, '#FFF4F6', 2.8) + flower(95, 50.2, '#F7C6D2', 2.6) + flower(107.5, 57.6, '#E4DBF3', 2.4) + '</g>';
    }
    if (acc === 'star') {
      return '<g class="acc acc-star" transform="translate(101 54) rotate(14)"><path d="M0-7.4 2.2-2.4 7.4-1.8 3.4 1.8 4.6 7 0 4.4-4.6 7-3.4 1.8-7.4-1.8-2.2-2.4Z" fill="#F1CF7E" ' + o + '/>' +
        '<path d="M-1.4-2.2l.8.8" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></g>';
    }
    if (acc === 'hat') {
      return '<g class="acc acc-hat" transform="rotate(-8 80 50)"><path d="M69 51.4 80.4 23 91.6 51.6Q80.4 55.4 69 51.4Z" fill="#F8E7B8" ' + o + '/>' +
        '<path d="M73.2 41.2q7.6 2.4 14.2-.2M76.6 32.8q4.4 1.4 8.2-.2" fill="none" stroke="#DE8296" stroke-width="1.6" stroke-linecap="round"/>' +
        '<circle cx="74.4" cy="47" r="1" fill="#B9A7DD"/><circle cx="86.6" cy="47.4" r="1" fill="#B9A7DD"/><circle cx="80.6" cy="37.2" r=".9" fill="#B9A7DD"/>' +
        '<circle cx="80.4" cy="21.6" r="3.4" fill="#F7C6D2" ' + o + '/></g>';
    }
    return '';
  }
  function elyAccNeck(acc, line) {
    if (acc !== 'scarf') return '';
    const c = { line: line };
    const o = 'stroke="' + line + '" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"';
    return '<g class="acc acc-scarf"><path d="M61 115.4q19 7.6 38 0l1.4 6q-20.4 8.6-40.8 0Z" fill="#DCD0F2" ' + o + '/>' +
      '<path d="M81 123.2l-.8 12.8 6 .4.6-12.4Z" fill="#DCD0F2" ' + o + '/>' +
      '<path d="M70.4 117.6q.4 3.2-.2 6.4M80 118.8v6.4M89.6 117.6q-.4 3.2.2 6.4" fill="none" stroke="#B9A7DD" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M80.6 136.2l-.3 2.4M83.2 136.4v2.4M85.8 136.4l.3 2.4" fill="none" stroke="' + c.line + '" stroke-width="1.1" stroke-linecap="round"/></g>';
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
    if (dir > 0) elyanaReacts();
    celebrateIfCrossed(before);
    progressIfCrossed(before);
    rewards();
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
    el.innerHTML = '<span class="moment-art">' + elyanaSvg(great ? 'sparkly' : 'happy', data.settings.accessory) + '</span>' +
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
  /* ---------- every log feels good (v1.2) ---------- */
  /* Elyana reacts to each entry with one of three little moves, never the same twice in a row. */
  const REACTIONS = ['ely-munch', 'ely-hop', 'ely-wiggle'];
  let lastReaction = '';
  function elyanaReacts() {
    const btn = $('#viewToday .elyana');
    if (!btn || !effectsOn()) return;
    const r = pick(REACTIONS.filter((x) => x !== lastReaction));
    lastReaction = r;
    REACTIONS.forEach((x) => btn.classList.remove(x));
    void btn.offsetWidth;
    btn.classList.add(r);
    btn.dataset.react = r;
  }
  /* The small moments at 25 %, 50 % and 75 % of the goal: once a day each, today only. When the same
     entry reaches the goal, the goal moment covers it. A short line from Elyana and a tiny flourish. */
  function progressIfCrossed(beforeTotal) {
    const goal = data.settings.goal;
    const after = L.dayTotal(data.log, today);
    const done = data.meta.celebrated[today] || { goal: false, great: false };
    let hit = '';
    [['q25', 0.25], ['q50', 0.5], ['q75', 0.75]].forEach((q) => {
      if (after >= goal * q[1] && beforeTotal < goal * q[1] && !done[q[0]]) { done[q[0]] = true; hit = q[0]; }
    });
    if (!hit) return;
    data.meta.celebrated[today] = done;
    persist();
    if (after >= goal || data.settings.celebrations === 'off' || viewDate !== today || tab !== 'today' || sheet) return;
    const sub = $('#statusSub');
    if (sub) { sub.textContent = pick(PROGRESS_LINES[hit]); sub.classList.add('said'); sub.dataset.moment = hit; }
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (!sheet && tab === 'today') render(); }, 4500);
    const ring = $('.ring');
    if (ring && effectsOn()) { ring.classList.remove('ring-glow'); void ring.offsetWidth; ring.classList.add('ring-glow'); }
    const p = arcEnd(after / goal);
    burst({ x: p.x, y: p.y, count: 12, spread: 360, speed: [1.5, 4], shape: ['star', 'dot'], colors: ['#E2B45A', '#F1D9A2', '#D9768C', '#F5C6D0'], size: 7, life: 900, gravity: 0.04 });
  }
  /* Where the ring's arc ends for a fraction of the goal, on screen. */
  function arcEnd(frac) {
    const r = $('.ring svg');
    if (!r) return ringCentre();
    const b = r.getBoundingClientRect();
    const a = (Math.min(1, frac) * 360 - 90) * Math.PI / 180;
    return { x: b.left + b.width * (60 + 52 * Math.cos(a)) / 120, y: b.top + b.height * (60 + 52 * Math.sin(a)) / 120 };
  }

  /* ---------- keepsakes (badges) ---------- */
  /* Adds every keepsake the log has earned that is not stored yet (none are ever removed). Returns the
     new ones; the caller decides whether that is a moment or quiet (imports, restores, opening the app). */
  function syncBadges() {
    const earned = L.earnedBadges(data.log, data.settings);
    const fresh = L.BADGES.map((b) => b.id).filter((id) => earned[id] && !data.badges[id]);
    if (fresh.length) data.badges = L.mergeBadges(data.badges, earned);
    return fresh;
  }
  const badgeById = (id) => L.BADGES.find((b) => b.id === id);
  /* A small moment for a new keepsake: a line on the goal card if one is showing, else its own little card. */
  function keepsakeMoment(ids) {
    if (!ids.length || data.settings.celebrations === 'off') return;
    const b = badgeById(ids[0]);
    const more = ids.length > 1 ? ' and ' + plural(ids.length - 1, 'more', 'more') : '';
    const card = $('.moment');
    if (card) {
      const line = document.createElement('span');
      line.className = 'moment-keep';
      line.innerHTML = ico(b.icon) + '<span></span>';
      $('span', line).textContent = 'New keepsake: ' + b.name + more;
      card.appendChild(line);
      return;
    }
    document.querySelectorAll('.keepsake-moment').forEach((m) => m.remove());
    /* a moment to see, not a button: taps pass through it (it sits over the top of the page for a few
       seconds); the basket is one tap away beside Elyana and on the Stats tab */
    const el = document.createElement('div');
    el.className = 'keepsake-moment';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="keep-art keep-on">' + ico(b.icon) + '</span><span class="km-text"><span class="km-small">New keepsake</span><b></b><span class="km-desc"></span></span>';
    $('b', el).textContent = b.name;
    $('.km-desc', el).textContent = b.desc + more;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
    const r = el.getBoundingClientRect();
    burst({ x: r.left + 34, y: r.top + r.height / 2, count: 14, spread: 360, speed: [2, 5], shape: 'star', colors: ['#E2B45A', '#F1D9A2', '#FFF4D6'], size: 8, life: 1000, gravity: 0.05 });
  }
  /* After anything she does that could earn one: store it and give it its moment. */
  function rewards() {
    const fresh = syncBadges();
    if (fresh.length) { persist(); keepsakeMoment(fresh); }
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
    /* never redraw under her while she is typing a note (the note saves as she types) */
    const typing = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('note-area');
    if (sheet || (drag && drag.active) || typing) { renderPill(); return; }
    document.body.className = 'celeb-' + data.settings.celebrations;
    $('#viewToday').hidden = tab !== 'today';
    $('#viewStats').hidden = tab !== 'stats';
    $('#viewFoods').hidden = tab !== 'foods';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('tab-on', b.dataset.tab === tab));
    $('.fab').setAttribute('aria-label', tab === 'foods' ? 'Add a food' : 'Add to the day');
    if (tab === 'today') renderToday(); else if (tab === 'stats') renderStats(); else renderFoods();
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
      '<g class="ring-spark" opacity="0"><circle r="5" class="spark-glow"/><path d="M0-4.2Q.6-.6 4.2 0 .6.6 0 4.2-.6.6-4.2 0-.6-.6 0-4.2Z" class="spark-star"/></g>' +
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
    if (isToday && new Date().getHours() >= 20 && entries.length && !data.dayNotes[today] && data.meta.noteNudge !== today) {
      lines[1] = NOTE_NUDGE;
      data.meta.noteNudge = today;
      persist();
    }
    const usual = L.usuals(data.foods);
    const groups = L.groupByMeal(entries);

    let h = '<h1 class="greet">' + esc(L.greeting(new Date().getHours(), data.settings.name)) + '</h1>';
    h += '<div class="daynav"><button type="button" class="navbtn" data-act="day-prev" aria-label="Previous day">' + ico('left') + '</button>' +
      '<button type="button" class="daylabel" data-act="day-pick"><b>' + esc(L.dayLabel(viewDate, today)) + '</b>' +
      (viewDate === today || viewDate === L.addDays(today, -1) ? '<small>' + esc(L.shortDate(viewDate, today)) + '</small>' : '') + '</button>' +
      '<button type="button" class="navbtn" data-act="day-next" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>' + ico('right') + '</button>' +
      '<input type="date" id="dayInput" class="ghost-input" tabindex="-1" aria-hidden="true" max="' + today + '" value="' + viewDate + '"></div>';
    const pweek = L.pregWeek(viewDate, L.pregDates(data.settings));
    if (pweek) h += '<p class="preg-line" id="pregLine">Week ' + pweek + '</p>';

    h += '<section class="card hero hero-l' + gs.level + '"><button type="button" class="basket-btn" data-act="basket" aria-label="Elyana\'s basket">' + ico('basket') + '</button>' +
      '<div class="hero-row">' + ringHtml(gs, from) +
      '<div class="hero-side"><button type="button" class="elyana mood-' + gs.mood + '" data-act="elyana" data-mood="' + gs.mood + '" aria-label="Elyana the baby bunny">' + elyanaSvg(gs.mood, data.settings.accessory) + '</button></div></div>' +
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
    h += noteBlockHtml('day', viewDate, isToday ? 'How did today feel?' : 'How did this day feel?');

    $('#viewToday').innerHTML = h;
    fillNotes();
    shown = { key: viewDate, total: total };
    if (from !== total) countUp(from, total);
  }

  /* ---------- day and week notes: free text, saved as she types, shown as plain text ---------- */
  const NOTE_MAPS = { day: 'dayNotes', week: 'weekNotes', preg: 'pregNotes' };
  const noteBlockHtml = (kind, key, title) => '<section class="block note-block" id="' + kind + 'NoteBlock"><label class="note-label" for="' + kind + 'Note">' + ico('note') +
    '<span>' + esc(title) + '</span></label><textarea class="input area note-area" id="' + kind + 'Note" data-in="note" data-kind="' + kind + '" data-key="' + esc(key) + '" rows="3" maxlength="' + L.NOTE_MAX + '" ' +
    'placeholder="' + (kind === 'day' ? 'Meals, mood, anything at all. Just for you.' : 'How the week went, meal-wise and otherwise.') + '"></textarea><span class="note-saved" id="' + kind + 'NoteSaved" aria-live="polite"></span></section>';
  /* Puts each note's text in its box (as text, never as markup). */
  function fillNotes() {
    document.querySelectorAll('.note-area').forEach((el) => { el.value = data[NOTE_MAPS[el.dataset.kind]][el.dataset.key] || ''; });
  }
  let noteTimer = 0, notePending = null;
  function saveNote(el) {
    clearTimeout(noteTimer);
    notePending = null;
    const map = data[NOTE_MAPS[el.dataset.kind]], key = el.dataset.key;
    const text = el.value.slice(0, L.NOTE_MAX);
    if ((map[key] || '') === (text.trim() ? text : '')) return;
    if (text.trim()) map[key] = text; else delete map[key];
    changed();
    const saved = $('#' + el.dataset.kind + 'NoteSaved');
    if (saved) saved.textContent = 'Saved';
  }
  function noteTyped(el) {
    notePending = el;
    const saved = $('#' + el.dataset.kind + 'NoteSaved');
    if (saved) saved.textContent = '';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveNote(el), 600);
  }

  let countRun = 0;
  function countUp(from, to) {
    const run = ++countRun;
    const num = $('.ring-num'), arc = $('.ring-arc'), arc2 = $('.ring-arc2');
    if (!num || !arc) return;
    /* a soft sparkle travels along the arc as it fills */
    const spark = to > from && effectsOn() ? $('.ring-spark') : null;
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
      if (spark) {
        const a = (s.pct * 360 - 90) * Math.PI / 180;
        spark.setAttribute('transform', 'translate(' + (60 + 52 * Math.cos(a)).toFixed(2) + ' ' + (60 + 52 * Math.sin(a)).toFixed(2) + ') rotate(' + (t * 180).toFixed(0) + ')');
        spark.setAttribute('opacity', t < 0.85 ? '1' : ((1 - t) / 0.15).toFixed(2));
        spark.classList.add('sparking');
      }
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

  /* ================= Stats: her record, motivation without shame ================= */
  /* range: week | month | all; anchor: a date in the week or month shown ('' = today); cal: the month
     on the Record calendar ('' = this month); sel: the bar tapped; sort: count | grams; by: food | category. */
  const stv = { range: 'week', anchor: '', cal: '', sel: '', sort: 'count', by: 'food', all: false };
  const RANGES = [['week', 'Week'], ['month', 'Month'], ['all', 'All']];
  const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const pct = (x) => Math.round(x * 100) + '%';
  const segHtml = (act, list, current, cls) => '<div class="seg' + (cls ? ' ' + cls : '') + '">' + list.map((x) =>
    '<button type="button" class="seg-btn' + (x[0] === current ? ' seg-on' : '') + '" data-act="' + act + '" data-v="' + x[0] + '" aria-pressed="' + (x[0] === current) + '">' + esc(x[1]) + '</button>').join('') + '</div>';

  /* The bar chart: one bar per item ({ key, value, label, kind, tip }), hand-drawn in SVG with thin guide
     lines at the goal and the great goal. Bars at the goal are rose, at the great goal butter-gold, the rest
     a soft sand colour. wide: a fixed slot per bar, scrolling sideways (Month, All). */
  function barsHtml(items, wide) {
    const s = data.settings;
    const slot = wide ? 26 : 44, H = 132, top = 12, labelH = 22, pad = 16;
    const W = items.length * slot + pad * 2;
    const max = Math.max(s.greatGoal * 1.15, ...items.map((x) => x.value * 1.06), 1);
    const y = (v) => top + H - (v / max) * H;
    const bw = Math.round(slot * (wide ? 0.62 : 0.5));
    let h = '<svg class="bars" ' + (wide ? 'width="' + W + '" height="' + (top + H + labelH) + '"' : 'width="100%"') + ' viewBox="0 0 ' + W + ' ' + (top + H + labelH) + '" role="img" aria-label="Protein per bar">';
    [[s.goal, 'guide-goal'], [s.greatGoal, 'guide-great']].forEach((gl) => { h += '<line class="guide ' + gl[1] + '" x1="0" x2="' + W + '" y1="' + y(gl[0]).toFixed(1) + '" y2="' + y(gl[0]).toFixed(1) + '"/>'; });
    h += '<line class="baseline" x1="0" x2="' + W + '" y1="' + (top + H) + '" y2="' + (top + H) + '"/>';
    items.forEach((it, i) => {
      const x = pad + i * slot;
      const lvl = it.value > 0 ? L.levelOf(it.value, s) : -1;
      h += '<g class="bar' + (it.key === stv.sel ? ' bar-on' : '') + (it.future ? ' bar-future' : '') + '" data-act="bar" data-key="' + esc(it.key) + '" data-kind="' + it.kind + '"' +
        (it.future ? '' : ' tabindex="0" role="button" aria-label="' + esc(it.aria || it.label) + '"') + '>' +
        '<rect class="bar-hit" x="' + x + '" y="0" width="' + slot + '" height="' + (top + H + labelH) + '"/>';
      if (lvl >= 0) {
        const yy = y(it.value), hh = Math.max(3, top + H - yy);
        h += '<rect class="bar-fill bar-l' + lvl + '" x="' + (x + (slot - bw) / 2) + '" y="' + (top + H - hh).toFixed(1) + '" width="' + bw + '" height="' + hh.toFixed(1) + '" rx="' + Math.min(4, bw / 2) + '"/>';
      } else if (!it.future && it.logged !== false) {
        h += '<circle class="bar-none" cx="' + (x + slot / 2) + '" cy="' + (top + H - 2) + '" r="1.6"/>';
      }
      if (it.label) h += '<text class="bar-label' + (it.key === today ? ' bar-today' : '') + '" x="' + (x + slot / 2) + '" y="' + (top + H + 15) + '" text-anchor="middle">' + esc(it.label) + '</text>';
      h += '</g>';
    });
    return h + '</svg>';
  }
  /* The line under the chart: what the tapped bar holds, with a way to open it. */
  function barTipHtml(item) {
    if (!item) return '<span class="tip-hint">Tap a bar to see its day</span>';
    if (item.kind === 'day') {
      return '<span class="tip-text"><b>' + esc(L.shortDate(item.key, today)) + '</b>' + (item.value > 0 || item.logged ? g(item.value) + ' g' : 'Nothing logged') + '</span>' +
        '<button type="button" class="btn text" data-act="view-day" data-key="' + esc(item.key) + '">View day</button>';
    }
    return '<span class="tip-text tip-stack"><b>' + esc(item.title) + '</b>' + esc(item.detail) + '</span>' +
      (item.action ? '<button type="button" class="btn text" data-act="' + item.action + '" data-key="' + esc(item.key) + '">' + esc(item.actionLabel) + '</button>' : '');
  }
  let barItems = [];
  function statsBars(r, totals) {
    const first = L.firstDay(data.log);
    let items, wide = stv.range !== 'week', title = 'Protein each day';
    if (stv.range === 'all' && L.daysBetween(r.from, r.to) > 62) {
      title = 'Average per logged day, by week';
      items = L.weekGroups(totals, data.settings, r.from, r.to).map((w, i, all) => ({
        key: 'w' + w.from, kind: 'week', value: w.avg, logged: w.logged > 0,
        label: i % 2 === all.length % 2 ? '' : L.parseKey(w.from).getDate() + ' ' + L.shortDate(w.from).split(' ')[2],
        title: 'Week of ' + L.shortDate(w.from, today), aria: 'Week of ' + L.shortDate(w.from, today),
        detail: w.logged ? g(w.avg) + ' g a logged day · ' + plural(w.logged, 'day', 'days') + ' logged · ' + plural(w.goal, 'goal day', 'goal days') : 'A quiet week',
        action: 'view-week', actionLabel: 'View week'
      }));
    } else {
      items = L.dayList(r.from, r.to).map((k) => {
        const d = L.parseKey(k);
        return {
          key: k, kind: 'day', value: totals[k] || 0, logged: totals[k] !== undefined && k >= first, future: k > today,
          label: stv.range === 'week' ? WEEKDAY_LETTERS[(d.getDay() + 6) % 7] : stv.range === 'month' ? String(d.getDate()) : (d.getDay() === 1 ? d.getDate() + ' ' + L.shortDate(k).split(' ')[2] : ''),
          aria: L.shortDate(k, today) + ', ' + g(totals[k] || 0) + ' g'
        };
      });
    }
    return chartHtml(title, items, wide);
  }
  function chartHtml(title, items, wide) {
    barItems = items;
    const sel = items.find((x) => x.key === stv.sel);
    return '<section class="block"><div class="block-head"><h2 class="block-title">' + title + '</h2></div><div class="card chart">' +
      '<div class="bars-wrap' + (wide ? ' bars-scroll' : '') + '" id="barsWrap">' + barsHtml(items, wide) + '</div>' +
      '<div class="chart-key"><span class="key key-goal">' + g(data.settings.goal) + ' g goal</span><span class="key key-great">' + g(data.settings.greatGoal) + ' g great</span></div>' +
      '<div class="bar-tip" id="barTip">' + barTipHtml(sel) + '</div></div></section>';
  }
  function selectBar(el) {
    const item = barItems.find((x) => x.key === el.dataset.key);
    if (!item || item.future) return;
    stv.sel = item.key;
    document.querySelectorAll('#barsWrap .bar').forEach((b) => b.classList.toggle('bar-on', b === el));
    $('#barTip').innerHTML = barTipHtml(item);
    const pn = $('#pregNoteBlock');
    if (pn && item.kind === 'preg') {
      if (notePending) saveNote(notePending);
      pn.outerHTML = pregNoteHtml(0);
      fillNotes();
    }
  }

  function calendarHtml(totals) {
    const month = stv.cal || L.monthStart(today);
    const rows = L.monthGrid(month);
    const head = '<div class="cal-head"><button type="button" class="navbtn" data-act="cal-prev" aria-label="Previous month">' + ico('left') + '</button>' +
      '<b>' + esc(L.monthLabel(month)) + '</b>' +
      '<button type="button" class="navbtn" data-act="cal-next" aria-label="Next month"' + (month >= L.monthStart(today) ? ' disabled' : '') + '>' + ico('right') + '</button></div>';
    const cells = rows.map((row) => row.map((k) => {
      if (!k) return '<span class="cal-pad"></span>';
      const t = totals[k], lvl = t !== undefined ? L.levelOf(t, data.settings) : -1;
      const fill = t ? Math.min(1, t / data.settings.goal) : 0;
      return '<button type="button" class="cal-day' + (lvl >= 0 ? ' cal-l' + lvl : '') + (k === today ? ' cal-today' : '') + '" data-act="cal-day" data-key="' + k + '"' +
        (k > today ? ' disabled' : '') + (lvl === 0 ? ' style="--fill:' + fill.toFixed(2) + '"' : '') +
        ' aria-label="' + esc(L.shortDate(k, today) + (t !== undefined ? ', ' + g(t) + ' g' : '') + (data.dayNotes[k] ? ', with a note' : '')) + '"><span>' + L.parseKey(k).getDate() + '</span>' +
        (data.dayNotes[k] ? '<i class="cal-note" aria-hidden="true"></i>' : '') + '</button>';
    }).join('')).join('');
    return '<section class="block"><div class="block-head"><h2 class="block-title">Record</h2></div><div class="card cal">' + head +
      '<div class="cal-grid">' + WEEKDAY_LETTERS.map((d) => '<i>' + d + '</i>').join('') + cells + '</div></div></section>';
  }

  function sourcesHtml(r) {
    const list = L.rankSources(L.sources(data.log, data.foods, r.from, r.to, stv.by), stv.sort);
    const top = list[0] ? (stv.sort === 'grams' ? list[0].grams : list[0].count) : 1;
    const shownList = stv.all ? list : list.slice(0, 8);
    let h = '<section class="block"><div class="block-head"><h2 class="block-title">Sources</h2></div>' +
      '<div class="src-toggles">' + segHtml('src-sort', [['count', 'Most often'], ['grams', 'Most protein']], stv.sort, 'seg-sm') +
      segHtml('src-by', [['food', 'By food'], ['category', 'By category']], stv.by, 'seg-sm') + '</div>';
    if (!list.length) return h + '<div class="empty">Nothing logged in these days. The list fills in as you go.</div></section>';
    h += '<div class="card src-list" id="srcList">' + shownList.map((x) => {
      const v = stv.sort === 'grams' ? x.grams : x.count;
      return '<div class="src-row">' + bubble(x.icon, 'sm') + '<span class="src-main"><span class="src-name">' + esc(x.name) + '</span>' +
        '<span class="src-track"><span class="src-fill" style="width:' + Math.max(3, Math.round(v / top * 100)) + '%"></span></span></span>' +
        '<span class="src-val">' + (stv.sort === 'grams' ? g(x.grams) + ' g<small>' + pct(x.share) + '</small>' : x.count + '<small>' + (x.count === 1 ? 'time' : 'times') + '</small>') + '</span></div>';
    }).join('') + '</div>';
    if (list.length > 8) h += '<button type="button" class="btn text show-all" data-act="src-all">' + (stv.all ? 'Show the top 8' : 'Show all ' + list.length) + '</button>';
    return h + '</section>';
  }

  function figuresHtml(totals, r) {
    const sm = L.summary(totals, data.settings, r.from, r.to);
    const runs = L.goalRuns(totals, data.settings, today);
    const fig = (label, value, sub, cls) => '<div class="fig' + (cls ? ' ' + cls : '') + '"><span class="fig-label">' + label + '</span><span class="fig-value">' + value + '</span><span class="fig-sub">' + sub + '</span></div>';
    return '<section class="card figs" id="figs">' +
      fig('Days logged', String(sm.logged), sm.logged === 1 ? 'day with a bite' : 'days with a bite') +
      fig('Goal days', sm.goal + '<small> of ' + sm.logged + '</small>', sm.logged ? pct(sm.rate) + ' of logged days' : 'Ready when you are', 'fig-goal') +
      fig('Current run', String(runs.current), runs.current === 1 ? 'goal day in a row' : 'goal days in a row') +
      fig('Best run', String(runs.best), runs.best === 1 ? 'goal day in a row' : 'goal days in a row') + '</section>';
  }

  /* Pregnancy weeks: one bar per week since the start date, the average per logged day. */
  function pregBars(p, totals) {
    const weeks = L.pregWeeks(totals, data.settings, p, today);
    const items = weeks.map((w) => ({
      key: 'p' + w.week, kind: 'preg', value: w.avg, logged: w.logged > 0, label: String(w.week),
      aria: 'Week ' + w.week + ', ' + g(w.avg) + ' g a logged day',
      title: 'Week ' + w.week + ' · ' + L.rangeLabel(w.from, w.to, today),
      detail: w.logged ? g(w.avg) + ' g a logged day · ' + plural(w.logged, 'day', 'days') + ' logged · ' + plural(w.goal, 'goal day', 'goal days') : 'A quiet week'
    }));
    return chartHtml('Average per logged day, by pregnancy week', items, items.length > 8);
  }
  /* In Pregnancy weeks the week note belongs to that pregnancy week: the one tapped, else this week. */
  const pregNoteHtml = (now) => { const n = /^p\d+$/.test(stv.sel) ? Number(stv.sel.slice(1)) : now; return noteBlockHtml('preg', String(n), 'How did week ' + n + ' feel?'); };
  const TRI_NAMES = ['First trimester', 'Second trimester', 'Third trimester'];
  function trimestersHtml(p, totals) {
    return '<section class="block" id="trimesters">' + L.trimesters(data.log, data.foods, totals, data.settings, p, today).map((t) => {
      let h = '<div class="card tri' + (t.started ? '' : ' tri-later') + '"><div class="tri-head"><h3>' + TRI_NAMES[t.trimester - 1] + '</h3><span>Weeks ' + t.fromWeek + ' – ' + t.toWeek + '</span></div>';
      if (!t.started) return h + '<p class="tri-note">Begins in week ' + t.fromWeek + ', on ' + esc(L.shortDate(t.from, today)) + '</p></div>';
      if (!t.logged) return h + '<p class="tri-note">A quiet stretch so far</p></div>';
      h += '<div class="tri-figs"><div><b>' + t.logged + '</b><span>days logged</span></div><div><b>' + g(t.avg) + '<small> g</small></b><span>per logged day</span></div>' +
        '<div><b>' + t.goal + '<small> of ' + t.logged + '</small></b><span>goal days · ' + pct(t.rate) + '</span></div></div>';
      return h + '<div class="tri-top"><span class="tri-top-title">Top sources</span>' + t.top.map((x) => '<span class="tri-src">' + bubble(x.icon, 'sm') + '<span>' + esc(x.name) + '</span><i>' + g(x.grams) + ' g</i></span>').join('') + '</div></div>';
    }).join('') + '</section>';
  }

  function renderStats() {
    const v = $('#viewStats');
    let h = '<div class="view-head"><h1 class="greet">My record</h1></div>';
    if (!data.log.length) {
      v.innerHTML = h + '<div class="stats-empty"><div class="stats-empty-art">' + elyanaSvg('sleepy') + '</div>' +
        '<p class="stats-empty-title">Your record starts with your first bite</p>' +
        '<p>Log something on Today and your days will bloom here, one by one.</p>' +
        '<button type="button" class="btn soft" data-act="tab" data-tab="today">Go to Today</button></div>';
      return;
    }
    const totals = L.totalsByDay(data.log);
    const cs = L.carrots(totals, data.settings);
    h += '<button type="button" class="card basket-card" data-act="basket"><span class="bubble">' + ico('basket') + '</span><span class="entry-text"><span class="entry-name">Elyana\'s basket</span>' +
      '<span class="entry-sub">' + esc(plural(cs.total, 'carrot', 'carrots') + ' · ' + plural(Object.keys(data.badges).length, 'keepsake', 'keepsakes')) + '</span></span>' + ico('right') + '</button>';
    const p = L.pregDates(data.settings);
    if (!p && (stv.range === 'pweeks' || stv.range === 'tri')) stv.range = 'week';
    h += segHtml('st-range', RANGES, stv.range, 'range-seg');
    if (p) h += segHtml('st-range', [['pweeks', 'Pregnancy weeks'], ['tri', 'Trimesters']], stv.range, 'range-seg preg-seg');
    if (p && (stv.range === 'pweeks' || stv.range === 'tri')) {
      if (today < p.start) {
        v.innerHTML = h + '<div class="empty">Week 1 begins on ' + esc(L.shortDate(p.start, today)) + '. The weeks will gather here from then.</div>';
        return;
      }
      const pr = { from: p.start, to: today > p.due ? p.due : today };
      const now = L.pregWeek(pr.to, p);
      h += '<div class="period"><span class="period-label">' + (stv.range === 'pweeks' ? 'Weeks 1 – ' + now : esc(L.rangeLabel(p.start, p.due, today))) + '</span></div>';
      h += stv.range === 'pweeks' ? figuresHtml(totals, pr) + pregBars(p, totals) + pregNoteHtml(now) + calendarHtml(totals) + sourcesHtml(pr) : trimestersHtml(p, totals) + calendarHtml(totals);
      v.innerHTML = h;
      fillNotes();
      scrollBars();
      return;
    }
    const r = L.statsRange(stv.range, stv.anchor || today, today, L.firstDay(data.log));
    if (stv.range === 'all') h += '<div class="period"><span class="period-label">Since ' + esc(L.shortDate(r.from, today)) + '</span></div>';
    else {
      h += '<div class="period"><button type="button" class="navbtn" data-act="range-prev" aria-label="Earlier">' + ico('left') + '</button>' +
        '<span class="period-label">' + esc(stv.range === 'month' ? L.monthLabel(r.from) : L.rangeLabel(r.from, r.to, today)) + '</span>' +
        '<button type="button" class="navbtn" data-act="range-next" aria-label="Later"' + (r.to >= today ? ' disabled' : '') + '>' + ico('right') + '</button></div>';
    }
    h += figuresHtml(totals, r) + statsBars(r, totals) + (stv.range === 'week' ? noteBlockHtml('week', r.from, 'How did this week feel?') : '') + calendarHtml(totals) + sourcesHtml(r);
    v.innerHTML = h;
    fillNotes();
    scrollBars();
  }
  /* A sideways chart opens at its newest bars (or keeps the tapped one in view). */
  function scrollBars() {
    const wrap = $('#barsWrap');
    if (wrap && wrap.classList.contains('bars-scroll')) {
      const on = $('.bar-on', wrap);
      wrap.scrollLeft = on ? Math.max(0, on.getBBox().x - wrap.clientWidth / 2) : wrap.scrollWidth;
    }
  }
  function openDay(key) {
    if (!L.isDateKey(key) || key > today) return;
    viewDate = key;
    tab = 'today';
    window.scrollTo(0, 0);
    render();
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
  /* A small dialog. Resolves true for the main button, false for cancel, and 'alt' for the optional
     second choice (o.alt), which stacks the buttons with the main one first. */
  function ask(o) {
    if (modalDone) modalDone(false);
    return new Promise((resolve) => {
      const m = $('#modal');
      const cancel = '<button type="button" class="btn ghost" data-act="modal-cancel">' + esc(o.cancel || 'Cancel') + '</button>';
      const ok = '<button type="button" class="btn primary" data-act="modal-ok">' + esc(o.ok || 'OK') + '</button>';
      m.innerHTML = '<div class="backdrop" data-act="modal-cancel"></div><div class="modal-card" role="alertdialog" aria-modal="true">' +
        '<h2>' + esc(o.title) + '</h2><p>' + esc(o.body) + '</p>' +
        (o.alt ? '<div class="modal-btns modal-stack">' + ok + '<button type="button" class="btn soft" data-act="modal-alt">' + esc(o.alt) + '</button>' + cancel + '</div></div>'
          : '<div class="modal-btns">' + cancel + ok + '</div></div>');
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
  /* "How much": a count stepper and an amount box, kept in step with each other. The amount is held in
     the serving's unit; a weight serving (g or oz) can be shown and typed in either, with a g / oz switch. */
  const shownUnit = (unit, serving) => L.otherWeight(unit, serving.unit) || serving.unit;
  const amountText = (amount, serving, unit) => (L.otherWeight(unit, serving.unit) ? L.fmtWeight(L.convertAmount(amount, serving.unit, unit)) : n2(amount));
  const unitSwitch = (act, current, extra) => '<div class="unitsw" role="group" aria-label="Weigh in grams or ounces">' + ['g', 'oz'].map((u) =>
    '<button type="button" class="unitsw-btn' + (L.weightUnit(current) === u ? ' unitsw-on' : '') + '" data-act="' + act + '" data-unit="' + u + '"' + (extra || '') +
    ' aria-pressed="' + (L.weightUnit(current) === u) + '">' + u + '</button>').join('') + '</div>';
  const amountHtml = (prefix, amount, serving, unit) =>
    '<div class="qty-row"><div class="stepper"><button type="button" class="step" data-act="' + prefix + '-minus" aria-label="Less">' + ico('minus') + '</button>' +
    '<output id="' + prefix + 'Qty">' + n2(L.countOf(amount, serving.amount)) + '</output>' +
    '<button type="button" class="step" data-act="' + prefix + '-plus" aria-label="More">' + ico('plus') + '</button></div>' +
    '<span class="qty-or">or</span>' +
    '<label class="amount"><input class="input" id="' + prefix + 'Amount" data-in="' + prefix + '-amount" type="number" inputmode="decimal" min="0" step="any" aria-label="Amount" value="' + esc(amountText(amount, serving, unit)) + '">' +
    '<span class="amount-unit" id="' + prefix + 'Unit">' + esc(shownUnit(unit, serving)) + '</span></label>' +
    (L.isWeight(serving.unit) ? unitSwitch(prefix + '-unit', shownUnit(unit, serving)) : '') + '</div>';
  /* A typed number in the unit on screen, as an amount in the serving's unit (NaN when the box is empty). */
  const typedInServing = (el, serving, unit) => { const v = typedAmount(el, NaN); return Number.isFinite(v) ? L.convertAmount(v, shownUnit(unit, serving), serving.unit) : NaN; };
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
    qa = { mode: 'list', q: '', foodId: '', servingId: '', amount: 1, unit: '', time: L.timeKey(new Date()), date: viewDate, other: { name: '', svAmount: '1', svUnit: 'serving', protein: '', save: false } };
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
  /* "Something else" has its own serving, typed in like the food editor's (1 serving = the protein by default). */
  const otherServing = () => {
    const a = parseFloat(qa.other.svAmount);
    return { amount: Number.isFinite(a) && a > 0 ? L.round2(a) : 1, unit: qa.other.svUnit.trim() || 'serving', protein: L.round2(Math.max(0, L.num(qa.other.protein))) };
  };
  const qaServing = () => { if (qa.mode === 'other') return otherServing(); const f = qaFood(); return f.servings.find((s) => s.id === qa.servingId) || f.servings[0]; };
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
        '<div class="field"><span>Serving</span><div class="serving-row serving-head sv-solo"><i>Amount</i><i>Unit</i><i>Protein g</i></div>' +
        '<div class="serving-row sv-solo"><input class="input sv-amount" id="qaSvAmount" data-in="qa-sv" type="number" inputmode="decimal" min="0" step="any" placeholder="1" aria-label="Amount" value="' + esc(qa.other.svAmount) + '">' +
        '<input class="input sv-unit" id="qaSvUnit" data-in="qa-sv" type="text" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="serving" aria-label="Unit" value="' + esc(qa.other.svUnit) + '">' +
        '<input class="input sv-protein" id="qaGrams" data-in="qa-sv" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" aria-label="Protein in grams" value="' + esc(qa.other.protein) + '"></div>' +
        '<small class="hint">For example 1 plate = 8 g, or 100 g = 31 g.</small></div>' +
        '<div class="field"><span>How much</span><div id="qaHow">' + amountHtml('qa', qa.amount, otherServing(), qa.unit) + '</div>' +
        '<div class="live" id="qaLive">' + g(qaProtein()) + ' g protein</div></div>' +
        iconPickerHtml(iconNow) +
        '<label class="tick"><input type="checkbox" id="qaSave"' + (qa.other.save ? ' checked' : '') + '><span>Save to my foods</span></label>' +
        whenFields('qa', qa.time, qa.date) +
        '<button type="button" class="btn primary wide" data-act="qa-add-other" id="qaAdd">Add ' + g(qaProtein()) + ' g</button>';
    }
    const f = qaFood(), s = qaServing();
    return back + '<div class="picked">' + bubble(f.icon, 'big') + '<h2 class="sheet-title">' + esc(f.name) + '</h2></div>' +
      (f.servings.length > 1 ? '<div class="field"><span>Serving</span><div class="chips">' + f.servings.map((x) =>
        '<button type="button" class="chip' + (x.id === s.id ? ' chip-on' : '') + '" data-act="qa-serving" data-id="' + esc(x.id) + '">' + esc(L.servingLabel(x)) + '<span class="chip-g">' + g(x.protein) + ' g</span></button>').join('') + '</div></div>' : '') +
      '<div class="field"><span class="split">How much <i class="per">' + esc(L.servingLabel(s)) + ' = ' + g(s.protein) + ' g protein</i></span>' + amountHtml('qa', qa.amount, s, qa.unit) +
      '<div class="live" id="qaLive">' + g(qaProtein()) + ' g protein</div></div>' +
      whenFields('qa', qa.time, qa.date) +
      '<button type="button" class="btn primary wide" data-act="qa-add" id="qaAdd">Add ' + g(qaProtein()) + ' g</button>';
  }
  function qaSync() {
    const w = readWhen('qa', qa.time, qa.date);
    qa.time = w.time; qa.date = w.date;
    if ($('#qaName')) {
      qa.other.name = $('#qaName').value; qa.other.svAmount = $('#qaSvAmount').value; qa.other.svUnit = $('#qaSvUnit').value;
      qa.other.protein = $('#qaGrams').value; qa.other.save = $('#qaSave').checked;
    }
  }
  /* Typing in the one-off's serving: the count stays as it was (1 serving of 1 plate becomes 1 serving of
     2 plates), the g / oz switch comes and goes with the unit, and the protein line follows. */
  function qaServingTyped() {
    const before = otherServing(), count = L.countOf(qa.amount, before.amount);
    qa.other.svAmount = $('#qaSvAmount').value; qa.other.svUnit = $('#qaSvUnit').value; qa.other.protein = $('#qaGrams').value;
    const s = otherServing();
    if (s.amount !== before.amount) qa.amount = L.round2(count * s.amount);
    if (!L.isWeight(s.unit)) qa.unit = '';
    $('#qaHow').innerHTML = amountHtml('qa', qa.amount, s, qa.unit);
    qaLive(false);
  }
  function qaRedraw() { qaSync(); $('#sheetBody').innerHTML = quickAddHtml(); }
  /* Refreshes the count, amount and protein; the amount box is left alone while she is typing in it. */
  function qaLive(fromBox) {
    const p = g(qaProtein());
    $('#qaQty').textContent = n2(L.countOf(qa.amount, qaServing().amount));
    if (!fromBox) $('#qaAmount').value = amountText(qa.amount, qaServing(), qa.unit);
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
    elyanaReacts();
    celebrateIfCrossed(before);
    progressIfCrossed(before);
    rewards();
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
    ed = { id: id, amount: e.amount, unit: L.otherWeight(e.enteredUnit, e.unit), options: options, sel: sel };
    openSheet('edit', '<div class="picked">' + bubble(e.icon, 'big') + '<h2 class="sheet-title">' + esc(e.name) + '</h2></div>' +
      (options.length > 1 ? '<div class="field"><span>Serving</span><div class="chips" id="edServings">' + options.map((o, i) =>
        '<button type="button" class="chip' + (i === sel ? ' chip-on' : '') + '" data-act="ed-serving" data-i="' + i + '">' + esc(L.servingLabel(o)) + '<span class="chip-g">' + g(o.protein) + ' g</span></button>').join('') + '</div></div>' : '') +
      '<div class="field"><span>How much</span><div id="edHow">' + amountHtml('ed', e.amount, options[sel], ed.unit) + '</div></div>' +
      '<label class="field"><span>Protein (g)</span><input class="input" id="edProtein" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(g(e.protein)) + '"></label>' +
      whenFields('ed', e.time, e.date) +
      '<label class="field"><span>Note</span><input class="input" id="edNote" type="text" maxlength="80" autocomplete="off" placeholder="Anything to remember" value="' + esc(e.note) + '"></label>' +
      '<button type="button" class="btn primary wide" data-act="ed-save">Save</button>' +
      '<button type="button" class="btn ghost wide" data-act="ed-delete">Delete</button>');
  }
  function edRecalc(fromBox) {
    const o = ed.options[ed.sel];
    if (!fromBox) $('#edHow').innerHTML = amountHtml('ed', ed.amount, o, ed.unit);
    $('#edQty').textContent = n2(L.countOf(ed.amount, o.amount));
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
    e.servingAmount = o.amount; e.unit = o.unit; e.proteinPer = o.protein; e.amount = ed.amount; e.enteredUnit = L.otherWeight(ed.unit, o.unit);
    e.protein = Number.isFinite(typed) && typed >= 0 ? L.round2(typed) : L.proteinFor(ed.amount, o.amount, o.protein);
    e.time = w.time; e.date = w.date;
    e.note = $('#edNote').value.trim();
    e.updated = new Date().toISOString();
    changed();
    viewDate = e.date;
    closeSheet();
    toast('Saved');
    celebrateIfCrossed(before);
    progressIfCrossed(before);
    rewards();
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
        '<input class="input sv-unit" data-in="fd-unit" type="text" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="bowl" aria-label="Unit" value="' + esc(s.unit) + '">' +
        '<input class="input sv-protein" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" aria-label="Protein in grams" value="' + esc(s.protein) + '">' +
        '<button type="button" class="iconbtn sv-x" data-act="fd-serving-x" data-i="' + i + '" aria-label="Remove serving"' + (fd.servings.length < 2 ? ' disabled' : '') + '>' + ico('close') + '</button>' +
        '<div class="sv-weight"' + (L.isWeight(s.unit) ? '' : ' hidden') + '><span>Weighed in</span>' + unitSwitch('fd-weight', s.unit, ' data-i="' + i + '"') + '</div></div>').join('') +
      '</div><button type="button" class="btn text" data-act="fd-serving-add">' + ico('plus') + 'Add serving</button>' +
      '<small class="hint">For example 350 ml = 10 g, or 1 roti = 6 g. A weight in g or oz can be logged in either. The first serving is the one a single tap logs.</small></div>' +
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

  /* ---------- Elyana's basket: carrots, keepsakes, dress-up ---------- */
  const CARROT_KINDS = [['plain', 'everyday'], ['golden', 'golden'], ['sparkly', 'sparkly']];
  function openBasket() {
    if (syncBadges().length) persist();
    openSheet('basket', basketHtml());
  }
  function basketHtml() {
    const c = L.carrots(L.totalsByDay(data.log), data.settings);
    const mood = L.goalState(L.dayTotal(data.log, today), data.settings).mood;
    const have = L.BADGES.filter((b) => data.badges[b.id]).length;
    return '<h2 class="sheet-title">Elyana\'s basket</h2>' +
      '<div class="basket-top"><div class="basket-ely" id="basketEly">' + elyanaSvg(mood, data.settings.accessory) + '</div>' +
      '<div class="carrots">' + CARROT_KINDS.map((k) => '<div class="carrot carrot-' + k[0] + '"><span class="carrot-art">' + ico('carrot') + (k[0] === 'sparkly' ? '<i class="carrot-spark"></i>' : '') + '</span>' +
        '<b>' + c[k[0]] + '</b><span>' + k[1] + '</span></div>').join('') + '</div></div>' +
      '<p class="hint center basket-note">A carrot for every day with a bite: golden on goal days, sparkly on great days.</p>' +
      '<h3 class="sheet-sub split-sub">Keepsakes<small>' + have + ' of ' + L.BADGES.length + '</small></h3>' +
      '<div class="shelf" id="shelf">' + L.BADGES.map((b) => '<button type="button" class="keep ' + (data.badges[b.id] ? 'keep-on' : 'keep-soon') + '" data-act="keep" data-id="' + b.id + '" aria-label="' + esc(b.name) + '">' +
        '<span class="keep-art">' + ico(b.icon) + '</span><span class="keep-name">' + esc(b.name) + '</span></button>').join('') + '</div>' +
      '<div class="keep-info" id="keepInfo"><span class="tip-hint">Tap a keepsake to read about it</span></div>' +
      '<h3 class="sheet-sub">Dress-up</h3><p class="hint">Pick what Elyana wears. It is saved with your data.</p>' +
      '<div class="wardrobe" id="wardrobe">' + wardrobeHtml(c) + '</div>';
  }
  function wardrobeHtml(c) {
    return [{ id: '', name: 'Just Elyana', hint: '' }].concat(L.ACCESSORIES).map((a) => {
      const open = !a.id || L.accessoryOpen(a, c, data.badges);
      const on = (data.settings.accessory || '') === a.id;
      return '<button type="button" class="ward' + (on ? ' ward-on' : '') + (open ? '' : ' ward-soon') + '" data-act="wear" data-id="' + a.id + '" aria-pressed="' + on + '">' +
        '<span class="ward-art">' + elyanaSvg('smiling', a.id, 'head') + '</span><span class="ward-name">' + esc(a.name) + '</span>' +
        '<span class="ward-hint">' + esc(open ? (on ? 'Wearing' : '') : a.hint) + '</span></button>';
    }).join('');
  }
  function showKeepsake(id) {
    const b = badgeById(id);
    if (!b) return;
    const when = data.badges[id];
    const box = $('#keepInfo');
    box.innerHTML = '<span class="keep-art ' + (when ? 'keep-on' : 'keep-soon') + '">' + ico(b.icon) + '</span><span class="tip-text tip-stack"><b></b><span></span></span>';
    $('b', box).textContent = b.name;
    $('.tip-stack span', box).textContent = when ? b.desc + ' Earned ' + L.shortDate(when, today) + '.' : b.hint;
    document.querySelectorAll('#shelf .keep').forEach((k) => k.classList.toggle('keep-sel', k.dataset.id === id));
  }
  function wear(id) {
    const a = L.accessoryById(id);
    const c = L.carrots(L.totalsByDay(data.log), data.settings);
    if (id && !L.accessoryOpen(a, c, data.badges)) { toast(a.hint); return; }
    if ((data.settings.accessory || '') === id) return;
    data.settings.accessory = id;
    changed();
    const mood = L.goalState(L.dayTotal(data.log, today), data.settings).mood;
    $('#basketEly').innerHTML = elyanaSvg(mood, id);
    $('#wardrobe').innerHTML = wardrobeHtml(c);
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
      '<h3 class="sheet-sub">Pregnancy</h3><p class="hint">Optional. With a date here, Today shows the week and Stats can show pregnancy weeks and trimesters.</p>' +
      '<div class="row2"><label class="field"><span>Start date</span><input class="input" id="stPregStart" data-in="settings" type="date" value="' + esc(s.pregStart) + '"></label>' +
      '<label class="field"><span>Due date</span><input class="input" id="stPregDue" data-in="settings" type="date" value="' + esc(s.pregDue) + '"></label></div>' +
      '<div id="pregOffer">' + pregOfferHtml() + '</div>' +
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
    const date = (sel) => { const v = $(sel).value; return L.isDateKey(v) ? v : ''; };
    const next = { name: name.value.trim(), goal: L.num($('#stGoal').value, s.goal), greatGoal: L.num($('#stGreat').value, s.greatGoal), pregStart: date('#stPregStart'), pregDue: date('#stPregDue') };
    if (!(next.goal > 0)) next.goal = s.goal;
    if (!(next.greatGoal > 0)) next.greatGoal = s.greatGoal;
    $('#pregOffer').innerHTML = pregOfferHtml(next);
    if (['name', 'goal', 'greatGoal', 'pregStart', 'pregDue'].every((k) => next[k] === s[k])) return;
    Object.assign(s, next);
    changed();
  }
  /* With one pregnancy date filled and the other empty, offer the other at 280 days (editable after). */
  function pregOfferHtml(v) {
    const o = v || data.settings;
    if (o.pregStart && !o.pregDue) return '<button type="button" class="btn text" data-act="st-preg-fill" data-field="stPregDue" data-v="' + L.addDays(o.pregStart, L.PREG_DAYS) + '">Fill the due date: ' + esc(L.shortDate(L.addDays(o.pregStart, L.PREG_DAYS), today)) + '</button>';
    if (o.pregDue && !o.pregStart) return '<button type="button" class="btn text" data-act="st-preg-fill" data-field="stPregStart" data-v="' + L.addDays(o.pregDue, -L.PREG_DAYS) + '">Fill the start date: ' + esc(L.shortDate(L.addDays(o.pregDue, -L.PREG_DAYS), today)) + '</button>';
    return '';
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
    data.dayNotes = incoming.dayNotes || {};
    data.weekNotes = incoming.weekNotes || {};
    data.pregNotes = incoming.pregNotes || {};
    data.badges = incoming.badges || {};
    syncBadges();
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
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  /* Import asks how: "Add to what's here" (the default) merges without taking anything away;
     "Replace everything" swaps all the data for the file's, after a second confirm. Neither ever
     fires a goal moment: imported days are past days, and nothing here compares totals. */
  async function importFile(file) {
    let incoming;
    try { incoming = L.importDoc(JSON.parse(await file.text())); }
    catch (e) { toast('That file does not look like a Noshnama export.'); return; }
    const n = incoming.log.length, nf = incoming.foods.length;
    const choice = await ask({
      title: 'Import this file?',
      body: 'It has ' + plural(n, 'entry', 'entries') + (nf ? ' and ' + plural(nf, 'food', 'foods') : '') + '. Add it to what is on this phone, or replace everything?',
      ok: "Add to what's here", alt: 'Replace everything'
    });
    if (!choice) return;
    if (choice === 'alt') {
      if (!nf) { toast('This file has entries and no foods, so use Add to bring them in'); return; }
      const sure = await ask({ title: 'Replace everything?', body: 'The file has ' + plural(n, 'entry', 'entries') + ' and ' + plural(nf, 'food', 'foods') + '. It replaces what is on this phone now.', ok: 'Replace everything' });
      if (!sure) return;
      replaceData(incoming);
      changed();
      closeSheet(true);
      render();
      toast('Imported');
      return;
    }
    const merged = L.mergeImport(data, incoming);
    const a = merged.added;
    if (!a.entries && !a.foods && !a.notes) { toast('Everything in that file is already here'); return; }
    data.foods = merged.foods;
    data.log = merged.log;
    data.dayNotes = merged.dayNotes; data.weekNotes = merged.weekNotes; data.pregNotes = merged.pregNotes;
    const keeps = syncBadges();
    shown = { key: '', total: 0 };
    changed();
    closeSheet(true);
    render();
    const parts = [];
    if (a.entries) parts.push(plural(a.entries, 'entry', 'entries') + ' from ' + plural(a.days, 'day', 'days'));
    if (a.foods) parts.push(plural(a.foods, 'food', 'foods'));
    if (a.notes) parts.push(plural(a.notes, 'note', 'notes'));
    /* one quiet toast; keepsakes the imported days earned join the basket without their own moments */
    toast('Added ' + parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + (keeps.length ? '. ' + plural(keeps.length, 'keepsake', 'keepsakes') + ' joined Elyana\'s basket' : ''), { ms: 5000 });
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
  /* Reads the tabs that exist (a backup made before v1.2 has no Notes tab). */
  async function readSheets(id) {
    const info = await api(SHEETS_API + '/' + id + '?fields=sheets.properties.title');
    const have = (info.sheets || []).map((x) => x.properties && x.properties.title);
    const names = L.TABS.filter((t) => have.includes(t));
    const tabs = {};
    if (names.length) {
      const r = await api(SHEETS_API + '/' + id + '/values:batchGet?' + names.map((t) => 'ranges=' + t).join('&') + '&valueRenderOption=UNFORMATTED_VALUE');
      names.forEach((t, i) => { tabs[t] = (r.valueRanges && r.valueRanges[i] && r.valueRanges[i].values) || []; });
    }
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
    'st-range': (el) => { stv.range = el.dataset.v; stv.anchor = ''; stv.sel = ''; stv.all = false; render(); },
    'range-prev': () => { const a = stv.anchor || today; stv.anchor = stv.range === 'month' ? L.addMonths(a, -1) : L.addDays(a, -7); stv.sel = ''; render(); },
    'range-next': () => {
      const a = stv.anchor || today, next = stv.range === 'month' ? L.addMonths(a, 1) : L.addDays(a, 7);
      stv.anchor = next >= today ? '' : next; stv.sel = ''; render();
    },
    'bar': (el) => selectBar(el),
    'view-day': (el) => openDay(el.dataset.key),
    'view-week': (el) => { stv.range = 'week'; stv.anchor = el.dataset.key.slice(1); stv.sel = ''; render(); window.scrollTo(0, 0); },
    'cal-prev': () => { stv.cal = L.addMonths(stv.cal || today, -1); render(); },
    'cal-next': () => { const n = L.addMonths(stv.cal || today, 1); stv.cal = n >= L.monthStart(today) ? '' : n; render(); },
    'cal-day': (el) => openDay(el.dataset.key),
    'src-sort': (el) => { stv.sort = el.dataset.v; render(); },
    'src-by': (el) => { stv.by = el.dataset.v; render(); },
    'src-all': () => { stv.all = !stv.all; render(); },
    'fab': () => (tab === 'foods' ? openFood('') : openQuickAdd()),
    'settings': () => openSettings(),
    'pill': () => pillTap(),
    'sheet-close': () => closeSheet(false),
    'modal-ok': () => modalDone && modalDone(true),
    'modal-cancel': () => modalDone && modalDone(false),
    'modal-alt': () => modalDone && modalDone('alt'),
    'day-prev': () => { viewDate = L.addDays(viewDate, -1); render(); },
    'day-next': () => { if (viewDate < today) { viewDate = L.addDays(viewDate, 1); render(); } },
    'day-pick': () => { const i = $('#dayInput'); i.max = today; i.value = viewDate; try { i.showPicker(); } catch (e) { i.focus(); i.click(); } },
    'elyana': (el) => elyanaTap(el),
    'usual': (el) => logUsual(el.dataset.id, el),
    'toast-minus': () => toastStep(-1),
    'toast-plus': () => toastStep(1),
    'entry': (el) => openEdit(el.dataset.id),
    'qa-food': (el) => { qa.mode = 'food'; qa.foodId = el.dataset.id; qa.servingId = ''; qa.unit = ''; qa.amount = qaServing().amount; qaRedraw(); },
    'qa-other': () => { qa.mode = 'other'; iconNow = L.DEFAULT_ICON; qa.unit = ''; qa.amount = otherServing().amount; qaRedraw(); },
    'qa-back': () => { qa.mode = 'list'; qaRedraw(); },
    'qa-serving': (el) => {
      const count = L.countOf(qa.amount, qaServing().amount);
      qa.servingId = el.dataset.id;
      qa.amount = L.round2(count * qaServing().amount);
      if (!L.isWeight(qaServing().unit)) qa.unit = '';
      qaRedraw();
    },
    'qa-unit': (el) => { qa.unit = el.dataset.unit; qaRedraw(); },
    'qa-minus': () => qaStep(-1),
    'qa-plus': () => qaStep(1),
    'qa-add': (el) => {
      qaSync();
      const s = qaServing(), unit = shownUnit(qa.unit, s);
      addEntry(L.makeEntry({ food: qaFood(), serving: s, amount: L.convertAmount(qa.amount, s.unit, unit), enteredUnit: unit, date: qa.date, time: qa.time, now: new Date().toISOString() }), el);
    },
    'qa-add-other': (el) => {
      qaSync();
      const name = qa.other.name.trim();
      const grams = parseFloat(qa.other.protein);
      if (!name) { toast('What was it? Give it a little name.'); return; }
      if (!Number.isFinite(grams) || grams < 0) { toast('Add the grams of protein.'); return; }
      const svAmount = parseFloat(qa.other.svAmount);
      if (!Number.isFinite(svAmount) || svAmount <= 0) { toast('Give the serving an amount, like 1 plate.'); return; }
      if (!(qa.amount > 0)) { toast('How much was it? Add an amount.'); return; }
      const stamp = new Date().toISOString();
      const s = otherServing(), unit = shownUnit(qa.unit, s);
      const serving = { id: L.uid('s'), amount: s.amount, unit: s.unit, protein: s.protein };
      let food = null;
      if (qa.other.save) {
        food = { id: L.uid('f'), name: name, icon: iconNow, category: 'Other', servings: [serving], archived: false, usual: true, created: stamp };
        data.foods.push(food);
      }
      addEntry(L.makeEntry({ food: food, serving: serving, name: name, icon: iconNow, amount: L.convertAmount(qa.amount, s.unit, unit), enteredUnit: unit, date: qa.date, time: qa.time, now: stamp }), el);
    },
    'ed-minus': () => edStep(-1),
    'ed-plus': () => edStep(1),
    'ed-serving': (el) => {
      const count = L.countOf(ed.amount, ed.options[ed.sel].amount);
      ed.sel = Number(el.dataset.i);
      ed.amount = L.round2(count * ed.options[ed.sel].amount);
      if (!L.isWeight(ed.options[ed.sel].unit)) ed.unit = '';
      document.querySelectorAll('#edServings .chip').forEach((c, i) => c.classList.toggle('chip-on', i === ed.sel));
      edRecalc(false);
    },
    'ed-unit': (el) => { ed.unit = el.dataset.unit; edRecalc(false); },
    'fd-weight': (el) => {
      fdSync();
      const sv = fd.servings[Number(el.dataset.i)], to = el.dataset.unit;
      const from = sv ? L.weightUnit(sv.unit) : '';
      if (!from || from === to) return;
      const amount = L.num(sv.amount, 1);
      sv.amount = n2(L.convertAmount(amount > 0 ? amount : 1, from, to));
      sv.unit = to;
      fdRedraw();
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
    'basket': () => openBasket(),
    'keep': (el) => showKeepsake(el.dataset.id),
    'wear': (el) => wear(el.dataset.id),
    'st-preg-fill': (el) => { $('#' + el.dataset.field).value = el.dataset.v; syncSettings(); },
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
    else if (kind === 'note') noteTyped(ev.target);
    else if (kind === 'qa-sv') qaServingTyped();
    else if (kind === 'qa-amount') { const a = typedInServing(ev.target, qaServing(), qa.unit); if (Number.isFinite(a)) qa.amount = a; qaLive(true); }
    else if (kind === 'ed-amount') { const a = typedInServing(ev.target, ed.options[ed.sel], ed.unit); if (Number.isFinite(a)) ed.amount = a; edRecalc(true); }
    else if (kind === 'fd-unit') {
      /* the g / oz switch under a serving shows while its unit is a weight */
      const row = ev.target.closest('.serving-row'), w = row && $('.sv-weight', row);
      if (w) { w.hidden = !L.isWeight(ev.target.value); w.querySelectorAll('.unitsw-btn').forEach((b) => { const on = L.weightUnit(ev.target.value) === b.dataset.unit; b.classList.toggle('unitsw-on', on); b.setAttribute('aria-pressed', String(on)); }); }
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dayInput') {
      if (L.isDateKey(t.value)) { viewDate = t.value > today ? today : t.value; render(); }
    } else if (t.id === 'importFile') {
      if (t.files && t.files[0]) importFile(t.files[0]);
    } else if (t.dataset && t.dataset.in === 'settings') syncSettings();
    else if (t.dataset && t.dataset.in === 'note') saveNote(t);
  });
  /* leaving a note box saves straight away (then a redraw that waited for her can happen) */
  document.addEventListener('focusout', (ev) => { if (ev.target.classList && ev.target.classList.contains('note-area') && notePending === ev.target) saveNote(ev.target); });
  document.addEventListener('keydown', (ev) => {
    /* a bar in the Stats chart is an SVG group: Enter or Space picks it like a tap */
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('.bar[tabindex]')) { ev.preventDefault(); selectBar(ev.target); return; }
    if (ev.key !== 'Escape') return;
    if (modalDone) modalDone(false); else if (sheet) closeSheet(false);
  });
  window.addEventListener('focus', checkDay);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDay(); renderPill(); } });
  setInterval(() => { checkDay(); renderPill(); }, 60000);

  /* ================= start ================= */
  document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  if (L.num(storedSchema, L.SCHEMA) < L.SCHEMA) persist();
  /* keepsakes already earned by her history (for example on the first open of v1.2) join quietly */
  if (syncBadges().length) changed();
  if (!data.meta.seeded) {
    data.foods = L.seedFoods(new Date().toISOString()).concat(data.foods);
    data.meta.seeded = true;
    persist();
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not available */ }
  if (curtainPassed()) enterApp(); else showCurtain('signin');
})();
