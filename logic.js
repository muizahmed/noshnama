/* Noshnama: pure logic. No DOM, no storage, no network.
   Loaded by the page as window.NoshLogic and by Node (tests) through require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoshLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Bump on every release. index.html must reference each local asset as file?v=<this>. */
  const APP_VERSION = '1.1.1';
  /* Shape of the stored document. 2: servings are amount + unit, foods have an icon key, entries store amounts. */
  const SCHEMA = 2;
  const STORE_KEY = 'noshnama.v2';

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
    ['kabab', 'Kabab', 'kabab', 'Meat & fish', 1, 'kabab', 8]
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
  function defaultSettings() { return { goal: 75, greatGoal: 100, name: '', celebrations: 'full', welcomeLines: [], notes: [] }; }
  /* Her own text (welcome message, Elyana's notes): short lines, blanks dropped. */
  function normLines(list) {
    return (Array.isArray(list) ? list : []).map((t) => str(t).trim().slice(0, 300)).filter(Boolean).slice(0, 60);
  }
  function defaultMeta() { return { schema: SCHEMA, curtain: '', sheetId: '', lastBackup: 0, rev: 0, backedRev: -1, celebrated: {}, seeded: false, welcomed: false }; }
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
    return { foods: seedFoods(nowIso), log: [], settings: defaultSettings(), meta: meta };
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
      note: str(o.note), created: str(o.created), updated: str(o.updated)
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
      welcomeLines: normLines(o.welcomeLines), notes: normLines(o.notes)
    };
  }
  function normCelebrated(c) {
    const out = {};
    if (c && typeof c === 'object') {
      Object.keys(c).forEach((k) => {
        if (isDateKey(k) && c[k] && typeof c[k] === 'object') out[k] = { goal: !!c[k].goal, great: !!c[k].great };
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
      seeded: !!o.seeded, welcomed: !!o.welcomed
    };
  }
  /* Makes any stored / imported / restored document safe to use. Valid data comes back unchanged. */
  function normalize(doc) {
    const o = doc && typeof doc === 'object' ? doc : {};
    return {
      foods: (Array.isArray(o.foods) ? o.foods : []).map(normFood).filter(Boolean),
      log: (Array.isArray(o.log) ? o.log : []).map(normEntry).filter(Boolean),
      settings: normSettings(o.settings),
      meta: normMeta(o.meta)
    };
  }

  /* ---------- log entries ---------- */
  /* A log entry keeps its own copy (snapshot) of the food's name, icon, category and the serving it
     was measured against, so editing or archiving the food later never changes past days.
     Give either o.amount (in the serving's unit) or o.count (servings); count 1 if neither. */
  function makeEntry(o) {
    const food = o.food || null;
    const serving = normServing(o.serving || (food && food.servings[0]) || { amount: 1, unit: 'serving', protein: 0 }, 0);
    const amount = o.amount !== undefined && o.amount !== null && o.amount !== '' ? num(o.amount, serving.amount) : round2(num(o.count, 1) * serving.amount);
    const stamp = o.now || '';
    return {
      id: o.id || uid('e'), date: o.date, time: o.time, foodId: food ? food.id : '',
      name: food ? food.name : str(o.name) || 'Something yummy',
      icon: food ? food.icon : str(o.icon) || DEFAULT_ICON,
      category: food ? food.category : 'Other',
      servingAmount: serving.amount, unit: serving.unit, proteinPer: serving.protein, amount: amount,
      protein: o.protein === undefined || o.protein === null || o.protein === '' ? proteinFor(amount, serving.amount, serving.protein) : Math.max(0, round2(num(o.protein))),
      note: str(o.note), created: stamp, updated: stamp
    };
  }
  const entryCount = (e) => countOf(e.amount, e.servingAmount);
  /* "2 x roti" for things counted by name, "525 ml" or "4 oz" for things measured. */
  const MEASURE = /^(g|kg|mg|ml|l|oz|lb|cup|cups|tbsp|tsp|glass|bowl|plate|slice|piece|handful|scoop|spoon)$/i;
  function entryLine(e) {
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
  const TABS = ['Foods', 'Log', 'Settings'];
  const FOODS_HEADER = ['Food id', 'Name', 'Icon', 'Category', 'Archived', 'In usuals', 'Created', 'Serving id', 'Amount', 'Unit', 'Protein (g)'];
  const LOG_HEADER = ['Entry id', 'Date', 'Time', 'Food id', 'Name', 'Icon', 'Category', 'Serving amount', 'Unit', 'Protein per serving (g)', 'Amount', 'Protein (g)', 'Note', 'Created', 'Updated'];
  const SETTINGS_HEADER = ['Setting', 'Value'];

  /* One row per serving, so a food with two servings takes two rows. Row order is her order. */
  function toSheets(data, savedIso) {
    const foods = [FOODS_HEADER.slice()];
    data.foods.forEach((f) => f.servings.forEach((s) => {
      foods.push([f.id, f.name, f.icon, f.category, f.archived ? 'yes' : '', f.usual === false ? 'no' : 'yes', f.created, s.id, s.amount, s.unit, s.protein]);
    }));
    const log = [LOG_HEADER.slice()];
    data.log.forEach((e) => {
      log.push([e.id, e.date, e.time, e.foodId, e.name, e.icon, e.category, e.servingAmount, e.unit, e.proteinPer, e.amount, e.protein, e.note, e.created, e.updated]);
    });
    const s = data.settings;
    const settings = [
      SETTINGS_HEADER.slice(),
      ['goal', s.goal], ['greatGoal', s.greatGoal], ['name', s.name], ['celebrations', s.celebrations]
    ].concat(
      (s.welcomeLines || []).map((t) => ['welcomeLine', t]),
      (s.notes || []).map((t) => ['note', t])
    ).concat([
      ['celebrated', JSON.stringify((data.meta && data.meta.celebrated) || {})],
      ['schema', SCHEMA], ['appVersion', APP_VERSION], ['savedAt', savedIso || '']
    ]);
    return { Foods: foods, Log: log, Settings: settings };
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
      servingAmount: num(r[7], 1), unit: str(r[8]), proteinPer: num(r[9]), amount: num(r[10], 1), protein: num(r[11]), note: str(r[12]), created: str(r[13]), updated: str(r[14])
    }));
    const kv = {}, welcomeLines = [], notes = [];
    rows('Settings').forEach((r) => {
      const k = str(r[0]);
      if (k === 'welcomeLine') welcomeLines.push(str(r[1]));
      else if (k === 'note') notes.push(str(r[1]));
      else kv[k] = r[1];
    });
    let celebrated = {};
    try { celebrated = JSON.parse(str(kv.celebrated) || '{}'); } catch (e) { celebrated = {}; }
    const clean = normalize({ foods: foods, log: log, settings: { goal: kv.goal, greatGoal: kv.greatGoal, name: kv.name, celebrations: kv.celebrations, welcomeLines: welcomeLines, notes: notes }, meta: { celebrated: celebrated } });
    return { foods: clean.foods, log: clean.log, settings: clean.settings, celebrated: clean.meta.celebrated, savedAt: str(kv.savedAt), schema: num(kv.schema, 0) };
  }

  /* ---------- export / import file ---------- */
  function exportDoc(data, nowIso) {
    return { app: 'noshnama', version: SCHEMA, exported: nowIso || '', foods: data.foods, log: data.log, settings: data.settings, celebrated: (data.meta && data.meta.celebrated) || {} };
  }
  function importDoc(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== 'noshnama' || obj.version !== SCHEMA || !Array.isArray(obj.foods) || !Array.isArray(obj.log)) {
      throw new Error('That file is not a Noshnama export.');
    }
    const clean = normalize({ foods: obj.foods, log: obj.log, settings: obj.settings, meta: { celebrated: obj.celebrated } });
    return { foods: clean.foods, log: clean.log, settings: clean.settings, celebrated: clean.meta.celebrated };
  }

  return {
    APP_VERSION, SCHEMA, STORE_KEY, CATEGORIES, MEALS, CELEBRATION_LEVELS, DEFAULT_ICON, TABS, FOODS_HEADER, LOG_HEADER, SETTINGS_HEADER,
    pad, round2, num, fmtG, fmtN, uid,
    dateKey, timeKey, isDateKey, isTimeKey, parseKey, addDays, shortDate, dayLabel, fmtTime, greeting,
    mealOf, servingLabel, proteinFor, countOf, stepCount, stepWhole,
    defaultSettings, defaultMeta, seedFoods, newData, normalize, normLines,
    makeEntry, entryCount, entryLine, dayEntries, sumProtein, dayTotal, groupByMeal,
    totalsByDay, sumsByFood, sumsByCategory, sumsByMeal, countsByFood,
    goalState, usuals, reorderUsuals, toSheets, fromSheets, exportDoc, importDoc
  };
});
