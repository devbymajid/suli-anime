// Suli Anime v1.6 — player account: local-first store + age gate.
// The account is the player's OWN identity (name, username, password,
// age, gender). v1.6 stores it in localStorage only — no backend, no
// multiplayer yet. `accountStore` is a small adapter object: when
// Firebase Auth lands, it is replaced by a Firebase-backed adapter with
// the same methods, and the screens (main.js) do not change.
//   suli-account: { name, username, passHash, age, gender, createdAt }
//   suli-session: { username } — set on signup/login, cleared on logout.
//     A session survives reloads (map switch / quality change reload the
//     page), so the player is NOT asked to log in again for those.
//     Logging out clears it, and the next visit shows the login screen.
// Passwords are NEVER stored in plaintext: SHA-256 via crypto.subtle
// (secure contexts — https + localhost). A pure-JS SHA-256 fallback
// covers non-secure contexts (plain http), where crypto.subtle is
// undefined; the hash output is identical either way.
// AGE GATE (user decision 2026-11-21): the game is for adults only.
// Signup requires age 18–120; under 18 the account is NOT created and
// entry is blocked completely. There is no UI path around the gate.

const ACCOUNT_KEY = 'suli-account';
const SESSION_KEY = 'suli-session';
const MIN_AGE = 18;
const MAX_AGE = 120;
const MIN_PASSWORD = 6;

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

// ---- SHA-256 ----
// Primary: crypto.subtle (async). Fallback: pure-JS implementation
// (same output, verified against crypto.subtle in the v1.6 test).
function sha256HexSync(str) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  // UTF-8 encode
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++;
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

async function hashPassword(pass) {
  try {
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
      return Array.from(new Uint8Array(buf)).map((b) => ('00' + b.toString(16)).slice(-2)).join('');
    }
  } catch (e) { /* fall through to the pure-JS implementation */ }
  return sha256HexSync(pass);
}

// ---- validation (Arabic messages; returns the first error or null) ----
function validateSignup(f) {
  const name = (f.name || '').trim();
  const username = (f.username || '').trim();
  const password = f.password || '';
  if (!name) return 'اكتب اسمك';
  if (name.length > 20) return 'الاسم طويل جداً (20 حرفاً كحد أقصى)';
  if (!username) return 'اكتب اسم المستخدم';
  if (username.length > 20) return 'اسم المستخدم طويل جداً (20 حرفاً كحد أقصى)';
  if (/\s/.test(username)) return 'اسم المستخدم لا يقبل المسافات';
  if (!password) return 'اكتب كلمة السر';
  if (password.length < MIN_PASSWORD) return 'كلمة السر قصيرة — 6 أحرف على الأقل';
  if (f.age === '' || f.age === null || f.age === undefined) return 'اكتب عمرك';
  const age = Number(f.age);
  if (!Number.isFinite(age) || !Number.isInteger(age)) return 'العمر يجب أن يكون رقماً صحيحاً';
  if (age < MIN_AGE) return 'AGE_BLOCK'; // special: the 18+ gate message
  if (age > MAX_AGE) return 'العمر غير معقول — 120 سنة كحد أقصى';
  if (f.gender !== 'm' && f.gender !== 'f') return 'اختر الجنس: ذكر أو أنثى';
  return null;
}

// ---- the store adapter ----
// Firebase Auth replaces this object later with the same methods:
// get / exists / create / verify / session / startSession / endSession.
const accountStore = {
  get() {
    const a = loadJSON(ACCOUNT_KEY);
    if (!a || typeof a !== 'object') return null;
    if (typeof a.name !== 'string' || typeof a.username !== 'string'
      || typeof a.passHash !== 'string' || typeof a.age !== 'number'
      || (a.gender !== 'm' && a.gender !== 'f')) return null;
    return a;
  },
  exists() { return !!this.get(); },
  async create(f) {
    const err = validateSignup(f);
    if (err) return { ok: false, error: err };
    const acc = {
      name: f.name.trim(),
      username: f.username.trim(),
      passHash: await hashPassword(f.password),
      age: Number(f.age),
      gender: f.gender,
      createdAt: new Date().toISOString(),
    };
    saveJSON(ACCOUNT_KEY, acc);
    this.startSession(acc.username);
    return { ok: true, account: acc };
  },
  async verify(username, password) {
    const acc = this.get();
    if (!acc) return { ok: false, error: 'NO_ACCOUNT' };
    if (acc.username !== (username || '').trim()) return { ok: false, error: 'WRONG_CREDENTIALS' };
    const hash = await hashPassword(password || '');
    if (hash !== acc.passHash) return { ok: false, error: 'WRONG_CREDENTIALS' };
    this.startSession(acc.username);
    return { ok: true, account: acc };
  },
  session() {
    const s = loadJSON(SESSION_KEY);
    if (!s || typeof s.username !== 'string') return null;
    const acc = this.get();
    return (acc && acc.username === s.username) ? s : null;
  },
  startSession(username) { saveJSON(SESSION_KEY, { username }); },
  endSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} },
  // for tests + the account screen: is this device logged in right now?
  isLoggedIn() { return !!this.session(); },
};

export { accountStore, validateSignup, hashPassword, sha256HexSync, MIN_AGE, MAX_AGE, MIN_PASSWORD };
