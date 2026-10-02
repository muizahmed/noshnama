/* Noshnama: pure logic. No DOM, no storage, no network.
   Loaded by the page as window.NoshLogic and by Node (tests) through require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoshLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Bump on every release. index.html must reference each local asset as file?v=<this>. */
  const APP_VERSION = '1.2.0';
  /* Shape of the stored document. 2: servings are amount + unit, foods have an icon key, entries store amounts.
     3 (v1.2): entries may remember the weight unit she typed in (enteredUnit), day and week notes, keepsakes,
     and the seed Kabab is weighed in ounces (migrate() moves an untouched v2 Kabab over).
     The storage key stays 'noshnama.v2' so data already on her phone is kept. */
  const SCHEMA = 3;
  const STORE_KEY = 'noshnama.v2';
  /* Older document shapes that can still be read (and are migrated). */
  const READS_SCHEMAS = [2, 3];

  const CATEGORIES = ['Dairy', 'Meat & fish', 'Eggs', 'Grains', 'Nuts & fruit', 'Other'];
  const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
  const CELEBRATION_LEVELS = ['full', 'subtle', 'off'];
  const DEFAULT_ICON = 'utensils';

  /* id, name, icon, category, serving amount, unit, protein in that serving */
  const SEED = [
    ['roti', 'Roti', 'roti', 'Grains', 1, 'roti', 6],
    ['milk', 'Milk', 'milk', 'Dairy', 350, 'ml', 10],
    ['fish', 'Fish', 'fish', 'Meat & fish', 1, 'oz', 7],
    ['yoghurt', 'Yoghurt', 'yoghurt', 'Dairy', 250, 'g', 8],
    ['corn', 'Corn', 'corn', 'Grains', 1, 'cob', 4],
    ['eggs', 'Eggs', 'egg', 'Eggs', 1, 'egg', 6],
    ['nuts', 'Mixed nuts', 'nut', 'Nuts & fruit', 1, 'oz', 5],
    ['cheese', 'Cheese', 'cheese', 'Dairy', 1, 'oz', 7],
    ['dates', 'Dates', 'dates', 'Nuts & fruit', 1, 'date', 0.2],
    ['kabab', 'Kabab', 'kabab', 'Meat & fish', 1, 'oz', 7]
  ];

  /* ---------- small helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  /* Grams of protein for display: one decimal at most, no trailing ".0". */
  function fmtG(n) { return String(Math.round(num(n) * 10) / 10); }
  /* Amounts and counts for display: two decimals at most. */
  function fmtN(n) { return String(round2(num(n))); }
  let uidCount = 0;
  function uid(prefix) {
    uidCount += 1;
    return (prefix || 'x') + Date.now().toString(36) + uidCount.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- dates: always the phone's local date, built from date parts ---------- */
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeKey(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function isDateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(key))) return false;
    return dateKey(parseKey(key)) === key;
  }
  function isTimeKey(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(str(t)); }
  /* Local noon, so daylight-saving shifts can never move the calendar day. */
  function parseKey(key) {
    const p = String(key).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  }
  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(key, todayKey) {
    const d = parseKey(key);
    const year = todayKey && key.slice(0, 4) !== todayKey.slice(0, 4) ? ' ' + d.getFullYear() : '';
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + year;
  }
  function dayLabel(key, todayKey) {
    if (key === todayKey) return 'Today';
    if (key === addDays(todayKey, -1)) return 'Yesterday';
    return shortDate(key, todayKey);
  }
  function fmtTime(t) {
    if (!isTimeKey(t)) return str(t);
    const h = Number(t.slice(0, 2));
    return ((h % 12) || 12) + ':' + t.slice(3) + (h < 12 ? ' am' : ' pm');
  }
  function greeting(hour, name) {
    let g = 'Good evening';
    if (hour < 5) g = 'Cosy night';
    else if (hour < 12) g = 'Good morning';
    else if (hour < 17) g = 'Good afternoon';
    else if (hour >= 21) g = 'Good night';
    const n = str(name).trim();
    return n ? g + ', ' + n : g;
  }

  /* ---------- meals (derived from the time, never stored) ---------- */
  function mealOf(time) {
    const h = Number(str(time).slice(0, 2));
    if (h < 11) return 'Breakfast';
    if (h < 16) return 'Lunch';
    if (h < 19) return 'Snack';
    return 'Dinner';
  }

  /* ---------- servings: an amount of a unit holds so much protein (350 ml -> 10 g) ---------- */
  function servingLabel(s) { return fmtN(s.amount) + ' ' + s.unit; }
  /* Protein in any amount of that unit: 500 ml of a 350 ml -> 10 g serving is 14.29 g. */
  function proteinFor(amount, servingAmount, proteinPer) {
    const base = num(servingAmount, 1) > 0 ? num(servingAmount, 1) : 1;
    return round2(num(amount) / base * num(proteinPer));
  }
  /* ---------- weights: a serving in g or oz can be logged in either (1 oz = 28.3495 g) ---------- */
  const OZ_IN_G = 28.3495;
  const WEIGHT = { g: 1, oz: OZ_IN_G };
  const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
  /* 'g' or 'oz' for a weight unit (any case), '' for anything else (ml, roti, egg, cob...). */
  function weightUnit(u) { const k = str(u).trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(WEIGHT, k) ? k : ''; }
  const isWeight = (u) => !!weightUnit(u);
  /* An amount in one weight unit expressed in the other, kept to 6 decimals so a typed 25 g comes back
     as 25 g. Units that are not both weights are returned unchanged (no ml <-> oz). */
  function convertAmount(amount, from, to) {
    const a = weightUnit(from), b = weightUnit(to);
    if (!a || !b || a === b) return num(amount);
    return round6(num(amount) * WEIGHT[a] / WEIGHT[b]);
  }
  /* A weight for display: one decimal at most (0.88 oz -> "0.9"). */
  function fmtWeight(n) { return String(Math.round(num(n) * 10) / 10); }
  /* The weight unit an entry or amount box shows: her typed unit when it is the other weight unit, else ''. */
  function otherWeight(typed, servingUnit) { const t = weightUnit(typed), s = weightUnit(servingUnit); return t && s && t !== s ? t : ''; }

  /* How many servings an amount is (525 ml of 350 ml = 1.5). */
  function countOf(amount, servingAmount) {
    const base = num(servingAmount, 1) > 0 ? num(servingAmount, 1) : 1;
    return round2(num(amount) / base);
  }
  /* The count one half-step up or down, landing on halves, never below a half. */
  function stepCount(count, dir) {
    const c = num(count, 1);
    const next = dir > 0 ? Math.floor(c * 2 + 1e-6) / 2 + 0.5 : Math.ceil(c * 2 - 1e-6) / 2 - 0.5;
    return Math.min(99, Math.max(0.5, round2(next)));
  }
  /* Whole steps for the quick − / + on the toast: 1 -> 2 -> 3, and 1 -> a half. */
  function stepWhole(count, dir) {
    const c = num(count, 1);
    if (dir > 0) return Math.min(99, c < 1 ? 1 : Math.floor(c + 1e-6) + 1);
    return c > 1 ? Math.max(1, Math.ceil(c - 1e-6) - 1) : 0.5;
  }

  /* ---------- data shapes ---------- */
  function defaultSettings() { return { goal: 75, greatGoal: 100, name: '', celebrations: 'full', welcomeLines: [], notes: [], pregStart: '', pregDue: '', accessory: '' }; }
  /* Her own text (welcome message, Elyana's notes): short lines, blanks dropped. */
  function normLines(list) {
    return (Array.isArray(list) ? list : []).map((t) => str(t).trim().slice(0, 300)).filter(Boolean).slice(0, 60);
  }
  function defaultMeta() { return { schema: SCHEMA, curtain: '', sheetId: '', lastBackup: 0, rev: 0, backedRev: -1, celebrated: {}, seeded: false, welcomed: false, noteNudge: '' }; }
  function seedFoods(nowIso) {
    return SEED.map((s) => ({
      id: 'f-' + s[0], name: s[1], icon: s[2], category: s[3],
      servings: [{ id: 's1', amount: s[4], unit: s[5], protein: s[6] }],
      archived: false, usual: true, created: nowIso || ''
    }));
  }
  function newData(nowIso) {
    const meta = defaultMeta();
    meta.seeded = true;
    return { foods: seedFoods(nowIso), log: [], settings: defaultSettings(), meta: meta, dayNotes: {}, weekNotes: {}, pregNotes: {}, badges: {} };
  }

  function normServing(s, i) {
    const o = s && typeof s === 'object' ? s : {};
    const amount = num(o.amount, 1);
    return { id: str(o.id) || 's' + (i + 1), amount: amount > 0 ? amount : 1, unit: str(o.unit).trim() || 'serving', protein: Math.max(0, num(o.protein)) };
  }
  function normFood(f) {
    const o = f && typeof f === 'object' ? f : {};
    if (!str(o.id)) return null;
    const servings = (Array.isArray(o.servings) ? o.servings : []).map(normServing);
    return {
      id: str(o.id), name: str(o.name) || 'Food', icon: str(o.icon) || DEFAULT_ICON,
      category: CATEGORIES.indexOf(o.category) >= 0 ? o.category : 'Other',
      servings: servings.length ? servings : [normServing({}, 0)],
      archived: !!o.archived, usual: o.usual !== false, created: str(o.created)
    };
  }
  function normEntry(e) {
    const o = e && typeof e === 'object' ? e : {};
    if (!str(o.id) || !isDateKey(o.date)) return null;
    const servingAmount = num(o.servingAmount, 1) > 0 ? num(o.servingAmount, 1) : 1;
    const amount = num(o.amount, servingAmount);
    return {
      id: str(o.id), date: o.date, time: isTimeKey(o.time) ? o.time : '12:00', foodId: str(o.foodId),
      name: str(o.name) || 'Food', icon: str(o.icon) || DEFAULT_ICON,
      category: CATEGORIES.indexOf(o.category) >= 0 ? o.category : 'Other',
      servingAmount: servingAmount, unit: str(o.unit) || 'serving', proteinPer: Math.max(0, num(o.proteinPer)),
      amount: amount > 0 ? amount : servingAmount, protein: Math.max(0, num(o.protein)),
      note: str(o.note), created: str(o.created), updated: str(o.updated),
      enteredUnit: otherWeight(o.enteredUnit, o.unit)
    };
  }
  function normSettings(s) {
    const o = s && typeof s === 'object' ? s : {};
    const d = defaultSettings();
    const goal = num(o.goal, d.goal), great = num(o.greatGoal, d.greatGoal);
    return {
      goal: goal > 0 ? goal : d.goal,
      greatGoal: great > 0 ? great : d.greatGoal,
      name: str(o.name),
      celebrations: CELEBRATION_LEVELS.indexOf(o.celebrations) >= 0 ? o.celebrations : d.celebrations,
      welcomeLines: normLines(o.welcomeLines), notes: normLines(o.notes),
      pregStart: isDateKey(o.pregStart) ? o.pregStart : '', pregDue: isDateKey(o.pregDue) ? o.pregDue : '',
      accessory: ['bow', 'scarf', 'star', 'crown', 'hat'].indexOf(o.accessory) >= 0 ? o.accessory : ''
    };
  }
  function normCelebrated(c) {
    const out = {};
    if (c && typeof c === 'object') {
      Object.keys(c).forEach((k) => {
        if (isDateKey(k) && c[k] && typeof c[k] === 'object') {
          out[k] = { goal: !!c[k].goal, great: !!c[k].great };
          /* v1.2: the little moments at a quarter, half and three quarters of the goal */
          ['q25', 'q50', 'q75'].forEach((q) => { if (c[k][q]) out[k][q] = true; });
        }
      });
    }
    return out;
  }
  function normMeta(m) {
    const o = m && typeof m === 'object' ? m : {};
    const d = defaultMeta();
    return {
      schema: SCHEMA, curtain: str(o.curtain), sheetId: str(o.sheetId), lastBackup: num(o.lastBackup, 0),
      rev: num(o.rev, d.rev), backedRev: num(o.backedRev, d.backedRev), celebrated: normCelebrated(o.celebrated),
      seeded: !!o.seeded, welcomed: !!o.welcomed, noteNudge: isDateKey(o.noteNudge) ? o.noteNudge : ''
    };
  }
  /* Notes (v1.2): dayNotes { 'YYYY-MM-DD': text }, weekNotes { Monday 'YYYY-MM-DD': text } for calendar
     weeks, pregNotes { 'N': text } for pregnancy week N. Two kinds of week note, kept apart. Empty notes
     are dropped; a note is at most 4000 characters. */
  /* Keepsakes earned: { badgeId: 'YYYY-MM-DD' }. */
  function normBadges(b) {
    const out = {};
    if (b && typeof b === 'object') Object.keys(b).forEach((id) => { if (BADGES.some((x) => x.id === id) && isDateKey(b[id])) out[id] = b[id]; });
    return out;
  }
  const NOTE_MAX = 4000;
  const NOTE_KINDS = [['dayNotes', 'day', isDateKey], ['weekNotes', 'week', isDateKey], ['pregNotes', 'pregnancy week', (k) => /^[1-9]\d?$/.test(k)]];
  function normNotes(map, valid) {
    const out = {};
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      Object.keys(map).forEach((k) => { const t = str(map[k]).slice(0, NOTE_MAX); if (valid(k) && t.trim()) out[k] = t; });
    }
    return out;
  }
  /* Makes any stored / imported / restored document safe to use. Valid data comes back unchanged. */
  function normalize(doc) {
    const o = doc && typeof doc === 'object' ? doc : {};
    return {
      foods: (Array.isArray(o.foods) ? o.foods : []).map(normFood).filter(Boolean),
      log: (Array.isArray(o.log) ? o.log : []).map(normEntry).filter(Boolean),
      settings: normSettings(o.settings),
      meta: normMeta(o.meta),
      dayNotes: normNotes(o.dayNotes, isDateKey), weekNotes: normNotes(o.weekNotes, isDateKey), pregNotes: normNotes(o.pregNotes, NOTE_KINDS[2][2]),
      badges: normBadges(o.badges)
    };
  }

  /* ---------- migration of older documents (on her phone, in a backup or an export file) ---------- */
  /* v1.2: the seed Kabab is weighed in ounces (1 oz = 7 g). Only a Kabab that is still exactly the
     untouched v1.1 seed (1 kabab = 8 g) is switched; one she edited is left alone. Entries keep their
     snapshots, so past days do not change. */
  function untouchedOldKabab(f) {
    const s = f.servings || [];
    return f.id === 'f-kabab' && f.name === 'Kabab' && f.icon === 'kabab' && f.category === 'Meat & fish' &&
      s.length === 1 && s[0].amount === 1 && s[0].unit === 'kabab' && s[0].protein === 8;
  }
  function migrateFoods(foods, fromSchema) {
    if (num(fromSchema, SCHEMA) >= 3) return foods;
    return foods.map((f) => (untouchedOldKabab(f) ? Object.assign({}, f, { servings: [{ id: f.servings[0].id, amount: 1, unit: 'oz', protein: 7 }] }) : f));
  }
  /* A normalized document read with the schema it was stored under (missing = current). */
  function migrate(doc, fromSchema) {
    doc.foods = migrateFoods(doc.foods, fromSchema);
    if (doc.meta) doc.meta.schema = SCHEMA;
    return doc;
  }

  /* ---------- log entries ---------- */
  /* A log entry keeps its own copy (snapshot) of the food's name, icon, category and the serving it
     was measured against, so editing or archiving the food later never changes past days.
     Give either o.amount (in the serving's unit) or o.count (servings); count 1 if neither.
     Optional o.enteredUnit ('g' or 'oz'): the weight unit she typed in. When it is the other weight unit
     than the serving's, o.amount is read in that unit and stored converted to the serving's unit; the entry
     remembers enteredUnit and shows itself that way. Every other option works as before. */
  function makeEntry(o) {
    const food = o.food || null;
    const serving = normServing(o.serving || (food && food.servings[0]) || { amount: 1, unit: 'serving', protein: 0 }, 0);
    const typedIn = otherWeight(o.enteredUnit, serving.unit);
    const given = o.amount !== undefined && o.amount !== null && o.amount !== '';
    const raw = num(o.amount, NaN);
    const amount = !given ? round2(num(o.count, 1) * serving.amount) : !Number.isFinite(raw) ? serving.amount : typedIn ? convertAmount(raw, typedIn, serving.unit) : raw;
    const stamp = o.now || '';
    return {
      id: o.id || uid('e'), date: o.date, time: o.time, foodId: food ? food.id : '',
      name: food ? food.name : str(o.name) || 'Something yummy',
      icon: food ? food.icon : str(o.icon) || DEFAULT_ICON,
      category: food ? food.category : 'Other',
      servingAmount: serving.amount, unit: serving.unit, proteinPer: serving.protein, amount: amount,
      protein: o.protein === undefined || o.protein === null || o.protein === '' ? proteinFor(amount, serving.amount, serving.protein) : Math.max(0, round2(num(o.protein))),
      note: str(o.note), created: stamp, updated: stamp, enteredUnit: typedIn
    };
  }
  const entryCount = (e) => countOf(e.amount, e.servingAmount);
  /* "2 x roti" for things counted by name, "525 ml" or "4 oz" for things measured. */
  const MEASURE = /^(g|kg|mg|ml|l|oz|lb|cup|cups|tbsp|tsp|glass|bowl|plate|slice|piece|handful|scoop|spoon)$/i;
  function entryLine(e) {
    const typed = otherWeight(e.enteredUnit, e.unit);
    if (typed) return fmtWeight(convertAmount(e.amount, e.unit, typed)) + ' ' + typed;
    return e.servingAmount === 1 && !MEASURE.test(e.unit) ? fmtN(e.amount) + ' × ' + e.unit : fmtN(e.amount) + ' ' + e.unit;
  }
  function dayEntries(log, date) {
    return log.filter((e) => e.date === date).sort((a, b) =>
      a.time < b.time ? -1 : a.time > b.time ? 1 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0);
  }
  function sumProtein(entries) { return round2(entries.reduce((t, e) => t + num(e.protein), 0)); }
  function dayTotal(log, date) { return sumProtein(log.filter((e) => e.date === date)); }
  function groupByMeal(entries) {
    return MEALS.map((meal) => {
      const list = entries.filter((e) => mealOf(e.time) === meal);
      return { meal: meal, entries: list, total: sumProtein(list) };
    }).filter((g) => g.entries.length);
  }

  /* ---------- sums for history and stats (phase 2 screens use these) ---------- */
  function inRange(e, from, to) { return (!from || e.date >= from) && (!to || e.date <= to); }
  function totalsByDay(log, from, to) {
    const out = {};
    log.forEach((e) => { if (inRange(e, from, to)) out[e.date] = round2((out[e.date] || 0) + num(e.protein)); });
    return out;
  }
  function sumsBy(log, from, to, keyOf, valueOf) {
    const out = {};
    log.forEach((e) => { if (inRange(e, from, to)) { const k = keyOf(e); out[k] = round2((out[k] || 0) + valueOf(e)); } });
    return out;
  }
  const grams = (e) => num(e.protein);
  const sumsByFood = (log, from, to) => sumsBy(log, from, to, (e) => e.name, grams);
  const sumsByCategory = (log, from, to) => sumsBy(log, from, to, (e) => e.category, grams);
  const sumsByMeal = (log, from, to) => sumsBy(log, from, to, (e) => mealOf(e.time), grams);
  /* Times logged per food (the "most frequent" ranking). */
  const countsByFood = (log, from, to) => sumsBy(log, from, to, (e) => e.name, () => 1);

  /* ---------- stats (v1.2): her record, worked out from the log; nothing here is stored ---------- */
  /* Whole calendar days from a to b (b - a). Counted on UTC dates built from the date parts, so a
     daylight-saving change in between can never make a day 23 or 25 hours long here. */
  function daysBetween(a, b) {
    const p = String(a).split('-').map(Number), q = String(b).split('-').map(Number);
    return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 86400000);
  }
  /* Weeks run Monday to Sunday. */
  function weekStart(key) { return addDays(key, -((parseKey(key).getDay() + 6) % 7)); }
  function monthStart(key) { return String(key).slice(0, 8) + '01'; }
  function monthEnd(key) { const d = parseKey(monthStart(key)); return dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); }
  function addMonths(key, n) { const d = parseKey(monthStart(key)); return dateKey(new Date(d.getFullYear(), d.getMonth() + n, 1, 12)); }
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthLabel(key) { const d = parseKey(key); return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(); }
  /* "28 Sep – 4 Oct", "1 – 31 Oct", with the year when it is not the year of todayKey. */
  function rangeLabel(from, to, todayKey) {
    const a = parseKey(from), b = parseKey(to);
    const yr = (d) => (todayKey && d.getFullYear() !== parseKey(todayKey).getFullYear() ? ' ' + d.getFullYear() : '');
    if (from === to) return a.getDate() + ' ' + MONTHS[a.getMonth()] + yr(a);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return a.getDate() + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + yr(b);
    return a.getDate() + ' ' + MONTHS[a.getMonth()] + (a.getFullYear() !== b.getFullYear() ? yr(a) || ' ' + a.getFullYear() : '') + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + yr(b);
  }
  /* Every date from one key to another, both included. */
  function dayList(from, to) {
    const out = [];
    for (let k = from, i = 0; k <= to && i < 5000; k = addDays(k, 1), i++) out.push(k);
    return out;
  }
  function firstDay(log) { return log.reduce((m, e) => (!m || e.date < m ? e.date : m), ''); }
  /* 0 under the goal, 1 at the goal, 2 at the great goal (with today's goal settings). */
  const levelOf = (total, settings) => goalState(num(total), settings).level;
  /* Days she logged anything in [from, to] (either end may be empty), goal days, great days,
     the hit rate (goal days of logged days) and the average per logged day. */
  function summary(totals, settings, from, to) {
    let logged = 0, goal = 0, great = 0, grams = 0;
    Object.keys(totals).forEach((k) => {
      if ((from && k < from) || (to && k > to)) return;
      logged += 1; grams += num(totals[k]);
      const l = levelOf(totals[k], settings);
      if (l >= 1) goal += 1;
      if (l >= 2) great += 1;
    });
    return { logged: logged, goal: goal, great: great, rate: logged ? goal / logged : 0, avg: logged ? round2(grams / logged) : 0, grams: round2(grams) };
  }
  /* Runs of goal days in a row. current: the run that reaches today, or yesterday while today is not a
     goal day yet (an unfinished today never breaks it); best: the longest ever. A day with nothing logged
     is not a goal day, so a gap ends a run; there is no "lost" anything, the count just starts again. */
  function goalRuns(totals, settings, today) {
    const isGoal = (k) => totals[k] !== undefined && levelOf(totals[k], settings) >= 1;
    let best = 0, run = 0, prev = '';
    Object.keys(totals).filter(isGoal).sort().forEach((k) => {
      run = prev && addDays(prev, 1) === k ? run + 1 : 1;
      if (run > best) best = run;
      prev = k;
    });
    let k = isGoal(today) ? today : addDays(today, -1), current = 0;
    while (isGoal(k) && current < 5000) { current += 1; k = addDays(k, -1); }
    return { current: current, best: best };
  }
  /* The dates a Stats range covers. kind: week (Monday to Sunday) | month | all (first entry to today). */
  function statsRange(kind, anchor, today, first) {
    if (kind === 'week') { const f = weekStart(anchor); return { from: f, to: addDays(f, 6) }; }
    if (kind === 'month') return { from: monthStart(anchor), to: monthEnd(anchor) };
    return { from: first && first < today ? first : today, to: today };
  }
  /* Calendar weeks touching [from, to], each with its days logged, goal days and average per logged day
     (for the All view when there are many days). */
  function weekGroups(totals, settings, from, to) {
    const out = [];
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
      const end = addDays(w, 6);
      const s = summary(totals, settings, w < from ? from : w, end > to ? to : end);
      out.push({ from: w, to: end, logged: s.logged, goal: s.goal, great: s.great, avg: s.avg });
    }
    return out;
  }
  /* A month as rows of 7 date keys, Monday first; '' pads the days of other months. */
  function monthGrid(key) {
    const first = monthStart(key);
    const cells = [];
    for (let i = (parseKey(first).getDay() + 6) % 7; i > 0; i--) cells.push('');
    dayList(first, monthEnd(key)).forEach((k) => cells.push(k));
    while (cells.length % 7) cells.push('');
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }
  /* Where her protein came from in [from, to]: one row per food (entries linked to a food count under
     that food's current name; one-offs group by name) or per category, with times logged, grams and the
     share of all grams. Order with rankSources. */
  const CATEGORY_ICON = { Dairy: 'milk', 'Meat & fish': 'fish', Eggs: 'egg', Grains: 'wheat', 'Nuts & fruit': 'nut', Other: 'utensils' };
  function sources(log, foods, from, to, by) {
    const byId = {};
    (foods || []).forEach((f) => { byId[f.id] = f; });
    const out = {};
    let total = 0;
    log.forEach((e) => {
      if (!inRange(e, from, to)) return;
      const f = e.foodId && byId[e.foodId];
      const key = by === 'category' ? 'c:' + e.category : f ? 'f:' + f.id : 'n:' + str(e.name).trim().toLowerCase();
      const o = out[key] || (out[key] = by === 'category'
        ? { key: key, name: e.category, icon: CATEGORY_ICON[e.category] || DEFAULT_ICON, count: 0, grams: 0 }
        : { key: key, name: f ? f.name : e.name, icon: f ? f.icon : e.icon, count: 0, grams: 0 });
      o.count += 1;
      o.grams = round2(o.grams + num(e.protein));
      total += num(e.protein);
    });
    return Object.keys(out).map((k) => Object.assign(out[k], { share: total > 0 ? out[k].grams / total : 0 }));
  }
  /* sort: 'count' (most often) or 'grams' (most protein); ties by the other, then by name. */
  function rankSources(list, sort) {
    const a = sort === 'grams' ? 'grams' : 'count', b = a === 'grams' ? 'count' : 'grams';
    return list.slice().sort((x, y) => y[a] - x[a] || y[b] - x[b] || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }

  /* ---------- pregnancy dates (v1.2, optional; with neither set nothing pregnancy-related shows) ---------- */
  /* Week N runs from day (N-1)*7 to day N*7-1 after the start date. Trimesters: first = weeks 1-13,
     second = weeks 14-27, third = week 28 onward. The start and due dates are 280 days apart unless she
     sets both herself. Dates before the start or after the due date are outside (week 0). */
  const PREG_DAYS = 280;
  const TRIMESTERS = [[1, 13], [14, 27], [28, 99]];
  /* { start, due } from her settings (one missing date is filled 280 days from the other), or null. */
  function pregDates(settings) {
    const s = settings || {};
    let start = isDateKey(s.pregStart) ? s.pregStart : '', due = isDateKey(s.pregDue) ? s.pregDue : '';
    if (!start && !due) return null;
    if (!start) start = addDays(due, -PREG_DAYS);
    if (!due || due <= start) due = addDays(start, PREG_DAYS);
    return { start: start, due: due };
  }
  function pregWeek(key, p) {
    if (!p || !isDateKey(key) || key < p.start || key > p.due) return 0;
    return Math.floor(daysBetween(p.start, key) / 7) + 1;
  }
  function trimesterOf(week) { return week < 1 ? 0 : week <= 13 ? 1 : week <= 27 ? 2 : 3; }
  /* The dates of pregnancy week n (never past the due date). */
  function pregWeekRange(p, n) {
    const to = addDays(p.start, n * 7 - 1);
    return { from: addDays(p.start, (n - 1) * 7), to: to > p.due ? p.due : to };
  }
  /* Weeks 1 up to the week of today (or of the due date once it has passed), each with days logged,
     goal days and the average per logged day. Empty before the start date. */
  function pregWeeks(totals, settings, p, today) {
    const last = pregWeek(today > p.due ? p.due : today, p);
    const out = [];
    for (let n = 1; n <= last; n++) {
      const r = pregWeekRange(p, n);
      const s = summary(totals, settings, r.from, r.to > today ? today : r.to);
      out.push({ week: n, from: r.from, to: r.to, trimester: trimesterOf(n), logged: s.logged, goal: s.goal, great: s.great, rate: s.rate, avg: s.avg });
    }
    return out;
  }
  /* The three trimesters with days logged, average per logged day, goal days, hit rate and the top
     three sources by grams, counted up to today. started: false for one that has not begun. */
  function trimesters(log, foods, totals, settings, p, today) {
    return TRIMESTERS.map((t, i) => {
      const from = addDays(p.start, (t[0] - 1) * 7);
      let to = addDays(p.start, t[1] * 7 - 1);
      if (to > p.due) to = p.due;
      const until = to > today ? today : to;
      const started = from <= today && from <= p.due;
      const s = started ? summary(totals, settings, from, until) : summary({}, settings);
      return Object.assign({ trimester: i + 1, fromWeek: t[0], toWeek: Math.min(t[1], pregWeek(p.due, p)), from: from, to: to, started: started },
        s, { top: started ? rankSources(sources(log, foods, from, until, 'food'), 'grams').slice(0, 3) : [] });
    });
  }

  /* ---------- rewards (v1.2): carrots, keepsakes and Elyana's accessories ----------
     All worked out from the log, so imported history earns them too. Rewards are only ever added:
     a keepsake once earned is kept (the app stores the date it was first earned) even if a goal setting
     or an entry changes later, and nothing is taken away on a quiet day. */
  /* Each day she logged anything is one carrot in Elyana's basket: golden on a goal day, sparkly on a
     great-goal day, plain otherwise. */
  function carrots(totals, settings) {
    const c = { plain: 0, golden: 0, sparkly: 0, total: 0 };
    Object.keys(totals).forEach((k) => { const l = levelOf(totals[k], settings); c[l === 2 ? 'sparkly' : l === 1 ? 'golden' : 'plain'] += 1; c.total += 1; });
    return c;
  }
  /* id, name, what it is for, a gentle hint while it is still to come, icon key */
  const BADGES = [
    ['first-bite', 'First bite', 'Your very first entry.', 'Comes with your first entry.', 'sprout'],
    ['first-goal', 'Golden hello', 'Your first goal day.', 'Comes on a day that reaches the goal.', 'heart'],
    ['great-day', 'Sparkle day', 'Your first great-goal day.', 'Comes on a day that reaches the great goal.', 'sparkles'],
    ['days-7', 'Seven little pages', '7 days logged.', 'Comes after 7 days with a bite.', 'pages'],
    ['days-30', 'A month of pages', '30 days logged.', 'Comes after 30 days with a bite.', 'moon'],
    ['days-100', 'A hundred days', '100 days logged. Party time!', 'Comes after 100 days with a bite.', 'cake'],
    ['goal-5', 'Five golden days', '5 goal days.', 'Comes with 5 goal days.', 'carrot'],
    ['goal-20', 'Twenty golden days', '20 goal days.', 'Comes with 20 goal days.', 'star'],
    ['goal-50', 'Fifty golden days', '50 goal days.', 'Comes with 50 goal days.', 'crown'],
    ['run-3', 'Little hops', 'Goal days three in a row.', 'Comes with 3 goal days in a row.', 'paws'],
    ['run-7', 'A golden week', 'Goal days seven in a row.', 'Comes with 7 goal days in a row.', 'ribbon'],
    ['run-14', 'Two golden weeks', 'Goal days fourteen in a row.', 'Comes with 14 goal days in a row.', 'trophy'],
    ['new-food', 'Something new', 'A bite beyond the first ten foods.', 'Comes with a food of your own.', 'leafy'],
    ['five-foods', 'Rainbow plate', 'Five different foods in one day.', 'Comes on a day with 5 different foods.', 'rainbow'],
    ['early-bird', 'Early bunny', 'A bite logged before 8 am.', 'Comes with an early-morning bite.', 'sunrise'],
    ['full-week', 'A full week', 'Every day from Monday to Sunday logged.', 'Comes with a week logged every day.', 'calcheck']
  ].map((b) => ({ id: b[0], name: b[1], desc: b[2], hint: b[3], icon: b[4] }));
  const SEED_IDS = {};
  SEED.forEach((x) => { SEED_IDS['f-' + x[0]] = true; });
  /* { badgeId: the date it was earned } for every keepsake the log has earned, earliest date first. */
  function earnedBadges(log, settings) {
    const days = {};
    log.forEach((e) => {
      const d = days[e.date] || (days[e.date] = { total: 0, foods: {}, early: false, fresh: false });
      d.total += num(e.protein);
      d.foods[e.foodId || 'n:' + nameKey(e.name)] = true;
      if (e.time >= '04:00' && e.time < '08:00') d.early = true;
      if (!SEED_IDS[e.foodId]) d.fresh = true;
    });
    const out = {};
    const got = (id, k) => { if (!out[id]) out[id] = k; };
    let logged = 0, goals = 0, run = 0, prevGoal = '';
    Object.keys(days).sort().forEach((k) => {
      const d = days[k];
      const lvl = levelOf(round2(d.total), settings);
      logged += 1;
      got('first-bite', k);
      [7, 30, 100].forEach((n) => { if (logged >= n) got('days-' + n, k); });
      if (lvl >= 1) {
        goals += 1;
        run = prevGoal && addDays(prevGoal, 1) === k ? run + 1 : 1;
        prevGoal = k;
        got('first-goal', k);
        [5, 20, 50].forEach((n) => { if (goals >= n) got('goal-' + n, k); });
        [3, 7, 14].forEach((n) => { if (run >= n) got('run-' + n, k); });
      }
      if (lvl >= 2) got('great-day', k);
      if (d.fresh) got('new-food', k);
      if (Object.keys(d.foods).length >= 5) got('five-foods', k);
      if (d.early) got('early-bird', k);
      if (parseKey(k).getDay() === 0 && dayList(addDays(k, -6), k).every((x) => days[x])) got('full-week', k);
    });
    return out;
  }
  /* Keepsakes earned before stay earned; newly earned ones are added with their date. */
  function mergeBadges(stored, earned) {
    const out = Object.assign({}, stored || {});
    Object.keys(earned).forEach((id) => { if (!out[id]) out[id] = earned[id]; });
    return out;
  }
  /* Things Elyana can wear, opened by carrots or keepsakes. id, name, what opens it, how many, hint. */
  const ACCESSORIES = [
    ['bow', 'Little bow', 'carrots', 3, 'Comes with 3 carrots'],
    ['scarf', 'Tiny scarf', 'carrots', 14, 'Comes with 14 carrots'],
    ['star', 'Star clip', 'sparkly', 1, 'Comes with a sparkly carrot'],
    ['crown', 'Flower crown', 'goalDays', 10, 'Comes with 10 goal days'],
    ['hat', 'Party hat', 'badge', 'days-30', 'Comes with "A month of pages"']
  ].map((a) => ({ id: a[0], name: a[1], by: a[2], need: a[3], hint: a[4] }));
  function accessoryOpen(acc, c, badges) {
    if (!acc) return false;
    if (acc.by === 'carrots') return c.total >= acc.need;
    if (acc.by === 'sparkly') return c.sparkly >= acc.need;
    if (acc.by === 'goalDays') return c.golden + c.sparkly >= acc.need;
    return !!(badges && badges[acc.need]);
  }
  const accessoryById = (id) => ACCESSORIES.find((a) => a.id === id) || null;

  /* ---------- goal ---------- */
  function goalState(total, settings) {
    const goal = num(settings && settings.goal, 75) || 75;
    const great = Math.max(goal, num(settings && settings.greatGoal, 100) || 100);
    const t = round2(total);
    const level = t >= great ? 2 : t >= goal ? 1 : 0;
    return {
      total: t, goal: goal, greatGoal: great, level: level,
      state: level === 2 ? 'great' : level === 1 ? 'goal' : t > 0 ? 'progress' : 'start',
      mood: level === 2 ? 'sparkly' : level === 1 ? 'happy' : t > 0 ? 'smiling' : 'sleepy',
      toGo: Math.max(0, round2(goal - t)),
      toGreat: Math.max(0, round2(great - t)),
      pct: Math.max(0, Math.min(1, t / goal)),
      greatPct: great > goal ? Math.max(0, Math.min(1, (t - goal) / (great - goal))) : (t >= goal ? 1 : 0)
    };
  }

  /* ---------- usuals: her own order (the order of the food list), minus archived and hidden ones ---------- */
  function usuals(foods) { return foods.filter((f) => !f.archived && f.usual !== false); }
  /* A new food list with the usuals rearranged to orderedIds; every other food keeps its place. */
  function reorderUsuals(foods, orderedIds) {
    const shown = usuals(foods);
    const byId = {};
    shown.forEach((f) => { byId[f.id] = f; });
    const next = orderedIds.map((id) => byId[id]).filter(Boolean);
    shown.forEach((f) => { if (next.indexOf(f) < 0) next.push(f); });
    let i = 0;
    return foods.map((f) => (!f.archived && f.usual !== false ? next[i++] : f));
  }

  /* ---------- backup: local data <-> readable spreadsheet tabs ---------- */
  const TABS = ['Foods', 'Log', 'Settings', 'Notes'];
  const FOODS_HEADER = ['Food id', 'Name', 'Icon', 'Category', 'Archived', 'In usuals', 'Created', 'Serving id', 'Amount', 'Unit', 'Protein (g)'];
  const LOG_HEADER = ['Entry id', 'Date', 'Time', 'Food id', 'Name', 'Icon', 'Category', 'Serving amount', 'Unit', 'Protein per serving (g)', 'Amount', 'Protein (g)', 'Note', 'Created', 'Updated', 'Entered unit'];
  const SETTINGS_HEADER = ['Setting', 'Value'];
  const NOTES_HEADER = ['Kind', 'For', 'Note'];

  /* One row per serving, so a food with two servings takes two rows. Row order is her order. */
  function toSheets(data, savedIso) {
    const foods = [FOODS_HEADER.slice()];
    data.foods.forEach((f) => f.servings.forEach((s) => {
      foods.push([f.id, f.name, f.icon, f.category, f.archived ? 'yes' : '', f.usual === false ? 'no' : 'yes', f.created, s.id, s.amount, s.unit, s.protein]);
    }));
    const log = [LOG_HEADER.slice()];
    data.log.forEach((e) => {
      log.push([e.id, e.date, e.time, e.foodId, e.name, e.icon, e.category, e.servingAmount, e.unit, e.proteinPer, e.amount, e.protein, e.note, e.created, e.updated, e.enteredUnit || '']);
    });
    const s = data.settings;
    const settings = [
      SETTINGS_HEADER.slice(),
      ['goal', s.goal], ['greatGoal', s.greatGoal], ['name', s.name], ['celebrations', s.celebrations],
      ['pregStart', s.pregStart || ''], ['pregDue', s.pregDue || ''], ['accessory', s.accessory || '']
    ].concat(
      (s.welcomeLines || []).map((t) => ['welcomeLine', t]),
      (s.notes || []).map((t) => ['note', t])
    ).concat(
      Object.keys(data.badges || {}).sort().map((id) => ['badge', id, data.badges[id]])
    ).concat([
      ['celebrated', JSON.stringify((data.meta && data.meta.celebrated) || {})],
      ['schema', SCHEMA], ['appVersion', APP_VERSION], ['savedAt', savedIso || '']
    ]);
    const notes = [NOTES_HEADER.slice()];
    NOTE_KINDS.forEach((k) => { const m = data[k[0]] || {}; Object.keys(m).sort().forEach((key) => notes.push([k[1], key, m[key]])); });
    return { Foods: foods, Log: log, Settings: settings, Notes: notes };
  }
  /* Sheets drops empty cells at the end of a row, and may hand numbers back as text. */
  function fromSheets(sheets) {
    const rows = (name) => ((sheets && sheets[name]) || []).slice(1).filter((r) => Array.isArray(r) && str(r[0]) !== '');
    const foods = [];
    const byId = {};
    rows('Foods').forEach((r) => {
      const id = str(r[0]);
      if (!byId[id]) {
        byId[id] = { id: id, name: str(r[1]), icon: str(r[2]), category: str(r[3]), servings: [], archived: str(r[4]).toLowerCase() === 'yes', usual: str(r[5]).toLowerCase() !== 'no', created: str(r[6]) };
        foods.push(byId[id]);
      }
      byId[id].servings.push({ id: str(r[7]), amount: num(r[8], 1), unit: str(r[9]), protein: num(r[10]) });
    });
    const log = rows('Log').map((r) => ({
      id: str(r[0]), date: str(r[1]), time: str(r[2]), foodId: str(r[3]), name: str(r[4]), icon: str(r[5]), category: str(r[6]),
      servingAmount: num(r[7], 1), unit: str(r[8]), proteinPer: num(r[9]), amount: num(r[10], 1), protein: num(r[11]), note: str(r[12]), created: str(r[13]), updated: str(r[14]), enteredUnit: str(r[15])
    }));
    const kv = {}, welcomeLines = [], notes = [], badges = {};
    rows('Settings').forEach((r) => {
      const k = str(r[0]);
      if (k === 'badge') badges[str(r[1])] = str(r[2]);
      else if (k === 'welcomeLine') welcomeLines.push(str(r[1]));
      else if (k === 'note') notes.push(str(r[1]));
      else kv[k] = r[1];
    });
    const noteMaps = { dayNotes: {}, weekNotes: {}, pregNotes: {} };
    rows('Notes').forEach((r) => { const k = NOTE_KINDS.find((x) => x[1] === str(r[0])); if (k) noteMaps[k[0]][str(r[1])] = str(r[2]); });
    let celebrated = {};
    try { celebrated = JSON.parse(str(kv.celebrated) || '{}'); } catch (e) { celebrated = {}; }
    const clean = normalize({ foods: foods, log: log, settings: { goal: kv.goal, greatGoal: kv.greatGoal, name: kv.name, celebrations: kv.celebrations, welcomeLines: welcomeLines, notes: notes, pregStart: str(kv.pregStart), pregDue: str(kv.pregDue), accessory: str(kv.accessory) }, meta: { celebrated: celebrated }, dayNotes: noteMaps.dayNotes, weekNotes: noteMaps.weekNotes, pregNotes: noteMaps.pregNotes, badges: badges });
    return { foods: migrateFoods(clean.foods, num(kv.schema, 0)), log: clean.log, settings: clean.settings, celebrated: clean.meta.celebrated, dayNotes: clean.dayNotes, weekNotes: clean.weekNotes, pregNotes: clean.pregNotes, badges: clean.badges, savedAt: str(kv.savedAt), schema: num(kv.schema, 0) };
  }

  /* ---------- export / import file ---------- */
  function exportDoc(data, nowIso) {
    return { app: 'noshnama', version: SCHEMA, exported: nowIso || '', foods: data.foods, log: data.log, settings: data.settings, celebrated: (data.meta && data.meta.celebrated) || {},
      dayNotes: data.dayNotes || {}, weekNotes: data.weekNotes || {}, pregNotes: data.pregNotes || {}, badges: data.badges || {} };
  }
  function importDoc(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== 'noshnama' || READS_SCHEMAS.indexOf(obj.version) < 0 || !Array.isArray(obj.foods) || !Array.isArray(obj.log)) {
      throw new Error('That file is not a Noshnama export.');
    }
    const clean = normalize({ foods: obj.foods, log: obj.log, settings: obj.settings, meta: { celebrated: obj.celebrated }, dayNotes: obj.dayNotes, weekNotes: obj.weekNotes, pregNotes: obj.pregNotes, badges: obj.badges });
    return { foods: migrateFoods(clean.foods, obj.version), log: clean.log, settings: clean.settings, celebrated: clean.meta.celebrated, dayNotes: clean.dayNotes, weekNotes: clean.weekNotes, pregNotes: clean.pregNotes, badges: clean.badges };
  }

  /* ---------- import, "Add to what's here" (v1.2) ---------- */
  const nameKey = (n) => str(n).trim().toLowerCase();
  /* Adds an imported file to the data on the phone without taking anything away:
     - log entries whose id is already here are skipped, so importing the same file twice changes nothing;
     - a food from the file is added only when no food here (active or archived) has the same name
       (case-insensitive); entries that pointed at a skipped food point at hers instead;
     - an entry with no food id (or one that is not here) whose name matches one of her foods is linked to
       that food, so the stats group them; its snapshot is kept as it is;
     - notes in the file are added only for days and weeks that have no note here yet;
     - settings, the order of her usuals, Little notes and device flags are never touched.
     Returns the new foods, log and notes plus counts for the toast; data itself is not changed. */
  function mergeImport(data, incoming) {
    const foods = data.foods.slice();
    const ids = {};
    const byName = {};
    const remember = (f) => { const k = nameKey(f.name); if (!byName[k] || (byName[k].archived && !f.archived)) byName[k] = f; };
    foods.forEach((f) => { ids[f.id] = true; remember(f); });
    const remap = {};
    let foodsAdded = 0;
    (incoming.foods || []).forEach((f) => {
      const mine = byName[nameKey(f.name)];
      if (mine) { remap[f.id] = mine.id; return; }
      const copy = Object.assign({}, f, { id: ids[f.id] ? uid('f') : f.id, servings: f.servings.map((x) => Object.assign({}, x)) });
      foods.push(copy);
      ids[copy.id] = true;
      remember(copy);
      remap[f.id] = copy.id;
      foodsAdded += 1;
    });
    const seen = {};
    data.log.forEach((e) => { seen[e.id] = true; });
    const added = [];
    (incoming.log || []).forEach((e) => {
      if (seen[e.id]) return;
      seen[e.id] = true;
      const x = Object.assign({}, e);
      if (x.foodId && remap[x.foodId]) x.foodId = remap[x.foodId];
      if (!x.foodId || !ids[x.foodId]) { const f = byName[nameKey(x.name)]; if (f) x.foodId = f.id; }
      added.push(x);
    });
    const notes = {};
    let notesAdded = 0;
    ['dayNotes', 'weekNotes', 'pregNotes'].forEach((k) => {
      const mine = Object.assign({}, data[k] || {});
      const theirs = incoming[k] || {};
      Object.keys(theirs).forEach((key) => { if (!str(mine[key]).trim() && str(theirs[key]).trim()) { mine[key] = theirs[key]; notesAdded += 1; } });
      notes[k] = mine;
    });
    const days = {};
    added.forEach((e) => { days[e.date] = true; });
    return Object.assign({ foods: foods, log: data.log.concat(added), added: { entries: added.length, days: Object.keys(days).length, foods: foodsAdded, notes: notesAdded } }, notes);
  }

  return {
    APP_VERSION, SCHEMA, READS_SCHEMAS, STORE_KEY, CATEGORIES, MEALS, CELEBRATION_LEVELS, DEFAULT_ICON, TABS, FOODS_HEADER, LOG_HEADER, SETTINGS_HEADER, NOTES_HEADER, NOTE_MAX,
    pad, round2, num, fmtG, fmtN, uid,
    dateKey, timeKey, isDateKey, isTimeKey, parseKey, addDays, shortDate, dayLabel, fmtTime, greeting,
    mealOf, servingLabel, proteinFor, countOf, stepCount, stepWhole,
    OZ_IN_G, weightUnit, isWeight, convertAmount, fmtWeight, otherWeight, migrate, migrateFoods,
    defaultSettings, defaultMeta, seedFoods, newData, normalize, normLines,
    makeEntry, entryCount, entryLine, dayEntries, sumProtein, dayTotal, groupByMeal,
    totalsByDay, sumsByFood, sumsByCategory, sumsByMeal, countsByFood,
    goalState, usuals, reorderUsuals,
    daysBetween, weekStart, monthStart, monthEnd, addMonths, monthLabel, rangeLabel, dayList, firstDay, levelOf, summary, goalRuns,
    statsRange, weekGroups, monthGrid, CATEGORY_ICON, sources, rankSources,
    carrots, BADGES, earnedBadges, mergeBadges, ACCESSORIES, accessoryOpen, accessoryById,
    PREG_DAYS, pregDates, pregWeek, trimesterOf, pregWeekRange, pregWeeks, trimesters,
    toSheets, fromSheets, exportDoc, importDoc, mergeImport, nameKey
  };
});
