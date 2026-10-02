// Noshnama spike: throwaway page to check Google sign-in, Drive backup and
// install behaviour on Arooj's phone. Replaced by the real app afterwards.

const CLIENT_ID = '829299043445-qvkjmmcbc2mb6res5ri8pgj0kllofid8.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const SHEET_NAME = 'Noshnama backup (spike)';

let tokenClient = null;
let accessToken = '';

const $ = (id) => document.getElementById(id);

function log(msg) {
  const t = new Date().toLocaleTimeString();
  $('log').textContent = '[' + t + '] ' + msg + '\n' + $('log').textContent;
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('spike.' + key);
    localStorage.setItem('spike.' + key, value);
  } catch (e) {
    log('localStorage failed: ' + e.message);
  }
  return null;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function api(url, options) {
  const opts = options || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + accessToken }, opts.headers || {});
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status + ' ' + ((body.error && body.error.message) || res.statusText));
  return body;
}

// prompt: undefined = normal sign-in, '' = try to renew without any screen
function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('Google script not loaded yet'));
    const started = Date.now();
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error + ': ' + (resp.error_description || '')));
      accessToken = resp.access_token;
      store('tokenAt', String(Date.now()));
      log('Token received in ' + (Date.now() - started) + ' ms, valid for ' + resp.expires_in + ' s');
      resolve();
    };
    tokenClient.error_callback = (err) => reject(new Error(err.type + ': ' + (err.message || '')));
    const options = { hint: store('email') || undefined };
    if (prompt !== undefined) options.prompt = prompt;
    tokenClient.requestAccessToken(options);
  });
}

async function signIn() {
  try {
    await requestToken();
    const me = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    store('email', me.email);
    const hash = await sha256(me.email.trim().toLowerCase());
    $('who').textContent = me.email;
    $('hash').textContent = hash;
    log('Signed in as ' + me.email);
  } catch (e) {
    log('Sign-in failed: ' + e.message);
  }
}

async function renew() {
  try {
    await requestToken('');
    log('Silent renewal worked');
  } catch (e) {
    log('Silent renewal failed: ' + e.message);
  }
}

async function findOrCreateSheet() {
  let id = store('sheetId');
  if (id) return id;
  const q = encodeURIComponent("name='" + SHEET_NAME + "' and trashed=false");
  const found = await api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
  if (found.files && found.files.length) {
    id = found.files[0].id;
    log('Found existing backup sheet');
  } else {
    const made = await api('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: SHEET_NAME } }),
    });
    id = made.spreadsheetId;
    log('Created backup sheet');
  }
  store('sheetId', id);
  return id;
}

async function backup() {
  try {
    if (!accessToken) throw new Error('sign in first');
    const id = await findOrCreateSheet();
    const rows = [
      ['spike row', 'written at'],
      ['roti', new Date().toISOString()],
    ];
    await api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/A1?valueInputOption=RAW', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });
    $('sheet').href = 'https://docs.google.com/spreadsheets/d/' + id;
    $('sheet').textContent = 'Open backup sheet';
    log('Backup written');
  } catch (e) {
    log('Backup failed: ' + e.message);
  }
}

async function environment() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  $('mode').textContent = standalone ? 'installed app (standalone)' : 'browser tab';
  let persisted = 'not supported';
  if (navigator.storage && navigator.storage.persist) {
    persisted = (await navigator.storage.persist()) ? 'granted' : 'not granted';
  }
  $('persist').textContent = persisted;
  const opens = Number(store('opens') || 0) + 1;
  store('opens', String(opens));
  $('opens').textContent = String(opens);
  const tokenAt = Number(store('tokenAt') || 0);
  $('tokenAge').textContent = tokenAt ? Math.round((Date.now() - tokenAt) / 60000) + ' min ago' : 'never';
  $('who').textContent = store('email') || 'not signed in';
}

window.addEventListener('load', () => {
  environment();
  $('signin').addEventListener('click', signIn);
  $('renew').addEventListener('click', renew);
  $('backup').addEventListener('click', backup);
  if (!window.google || !google.accounts) {
    log('Google script did not load');
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
  log('Ready');
});
