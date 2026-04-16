#!/usr/bin/env node
/**
 * 家庭支出儀錶板伺服器（逐筆累加版）
 * 本地：node server.js → http://localhost:3100
 * 雲端：Railway（環境變數 DATA_DIR, DASHBOARD_PASSWORD, SESSION_SECRET）
 */
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { syncToSheets } = require('./sheets_sync');

const app = express();
const PORT = process.env.PORT || 3100;

const DATA_DIR     = process.env.DATA_DIR || 'C:/Users/terry/.claude';
const HISTORY_FILE = path.join(DATA_DIR, 'family_expense_history.csv');
const OUTPUT_HTML  = path.join(DATA_DIR, 'family_expense_dashboard.html');
const SCRIPTS_DIR  = __dirname;

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '811003';
const SESSION_SECRET     = process.env.SESSION_SECRET     || 'family-secret-' + Math.random();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const requireLogin = (req, res, next) =>
  req.session.loggedIn ? next() : res.redirect('/login');

// ── 登入 ─────────────────────────────────────────────────────────────
const loginPage = (err='') => `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>💸 家庭支出 — 登入</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Microsoft JhengHei",sans-serif;background:#0a0e17;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111827;border:1px solid #1f2a44;border-radius:16px;padding:40px 36px;width:100%;max-width:360px;box-shadow:0 8px 40px rgba(0,0,0,.6),0 0 60px rgba(88,166,255,.08)}
.logo{text-align:center;font-size:36px;margin-bottom:8px}
h1{text-align:center;font-size:20px;font-weight:700;margin-bottom:6px;background:linear-gradient(90deg,#58a6ff,#c792ea);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{text-align:center;font-size:13px;color:#8b93a7;margin-bottom:32px}
label{display:block;font-size:12px;color:#8b93a7;margin-bottom:6px;font-weight:500}
input[type=password]{width:100%;background:#0a0e17;border:1px solid #1f2a44;border-radius:8px;padding:12px 14px;color:#e8e8f0;font-size:15px;outline:none;margin-bottom:20px}
input[type=password]:focus{border-color:#58a6ff}
button{width:100%;padding:13px;background:linear-gradient(90deg,#58a6ff,#c792ea);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}
.err{background:rgba(255,85,85,.12);border:1px solid rgba(255,85,85,.3);border-radius:8px;padding:10px 14px;font-size:13px;color:#ff5555;margin-bottom:20px;text-align:center}
</style></head><body><div class="card"><div class="logo">💸</div>
<h1>家庭支出紀錄</h1><p class="sub">請輸入密碼以繼續</p>
${err?`<div class="err">${err}</div>`:''}
<form method="POST" action="/login"><label>密碼</label>
<input type="password" name="password" autofocus placeholder="••••••••"><button type="submit">登入</button></form>
</div></body></html>`;

app.get('/login', (req, res) => req.session.loggedIn ? res.redirect('/') : res.send(loginPage()));
app.post('/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) { req.session.loggedIn = true; res.redirect('/'); }
  else res.send(loginPage('密碼錯誤，請再試一次'));
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/manifest.json', requireLogin, (req, res) => {
  res.json({
    name: '家庭支出紀錄', short_name: '家庭支出',
    start_url: '/', display: 'standalone',
    background_color: '#0a0e17', theme_color: '#58a6ff',
    icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }]
  });
});

// ── CSV（每列一筆支出）─────────────────────────────────────────────
const HEADERS = 'id,month,item,tag,amount,note,created_at';

const esc = s => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const parseLine = line => {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
};

function loadEntries() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n');
  if (lines.length <= 1) return [];
  return lines.slice(1).map(l => {
    const [id, month, item, tag, amount, note, created_at] = parseLine(l);
    return { id, month, item, tag, amount: +amount, note, created_at };
  });
}
function saveEntries(rows) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const sorted = [...rows].sort((a, b) =>
    a.month.localeCompare(b.month) || a.created_at.localeCompare(b.created_at)
  );
  const lines = [HEADERS, ...sorted.map(r =>
    [r.id, r.month, esc(r.item), esc(r.tag), r.amount, esc(r.note||''), r.created_at].join(',')
  )];
  fs.writeFileSync(HISTORY_FILE, lines.join('\n'), 'utf8');
}

function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function regenerate() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  execSync(
    `node "${path.join(SCRIPTS_DIR,'generate_html.js')}" --history "${HISTORY_FILE}" --output "${OUTPUT_HTML}"`,
    { timeout: 30000 }
  );
}
function triggerSync(rows) {
  if (!rows) rows = loadEntries();
  syncToSheets(rows).catch(e => console.error('[Sheets sync]', e.message));
}

// ── API ─────────────────────────────────────────────────────────────
// 新增一筆
app.post('/api/entry', requireLogin, (req, res) => {
  try {
    const { month, item, tag, amount, note='' } = req.body;
    if (!month || !item || !tag || amount === undefined) return res.status(400).json({ error: '缺少必填欄位' });
    const rows = loadEntries();
    const row = { id: newId(), month, item, tag, amount: +amount, note, created_at: new Date().toISOString() };
    rows.push(row);
    saveEntries(rows); regenerate(); triggerSync(rows);
    res.json({ ok: true, row });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 批次新增
app.post('/api/entries', requireLogin, (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: '缺少 entries' });
    const rows = loadEntries();
    const now = new Date().toISOString();
    const added = entries.map(e => ({
      id: newId(), month: e.month, item: e.item, tag: e.tag,
      amount: +e.amount, note: e.note || '', created_at: now
    }));
    rows.push(...added);
    saveEntries(rows); regenerate(); triggerSync(rows);
    res.json({ ok: true, count: added.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 更新（覆寫指定 id）
app.put('/api/entry/:id', requireLogin, (req, res) => {
  try {
    const rows = loadEntries();
    const idx = rows.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '找不到資料' });
    const { month, item, tag, amount, note } = req.body;
    const cur = rows[idx];
    rows[idx] = {
      ...cur,
      month:  month  ?? cur.month,
      item:   item   ?? cur.item,
      tag:    tag    ?? cur.tag,
      amount: amount !== undefined ? +amount : cur.amount,
      note:   note   ?? cur.note,
    };
    saveEntries(rows); regenerate(); triggerSync(rows);
    res.json({ ok: true, row: rows[idx] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 刪除
app.delete('/api/entry/:id', requireLogin, (req, res) => {
  try {
    let rows = loadEntries();
    const before = rows.length;
    rows = rows.filter(r => r.id !== req.params.id);
    if (rows.length === before) return res.status(404).json({ error: '找不到資料' });
    saveEntries(rows); regenerate(); triggerSync(rows);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 查詢（可帶 ?month=YYYY-MM）
app.get('/api/entries', requireLogin, (req, res) => {
  const { month } = req.query;
  let rows = loadEntries();
  if (month) rows = rows.filter(r => r.month === month);
  res.json({ entries: rows });
});

// 取得常用標籤/項目（autocomplete）
app.get('/api/suggest', requireLogin, (req, res) => {
  const rows = loadEntries();
  const tagCount = {}, itemCount = {};
  rows.forEach(r => {
    tagCount[r.tag] = (tagCount[r.tag] || 0) + 1;
    itemCount[r.item] = (itemCount[r.item] || 0) + 1;
  });
  const defaults = ['信用卡','小孩','孝親','其他'];
  defaults.forEach(t => { if (!(t in tagCount)) tagCount[t] = 0; });
  const tags  = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const items = Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  res.json({ tags, items });
});

// 匯入 CSV（遷移用）
app.post('/api/import-csv', requireLogin, (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: '缺少 csv' });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, csv, 'utf8');
    regenerate(); triggerSync();
    res.json({ ok: true, rows: loadEntries().length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 主頁 ─────────────────────────────────────────────────────────────
app.get('/', requireLogin, (req, res) => {
  if (!fs.existsSync(OUTPUT_HTML)) {
    try { regenerate(); }
    catch(e) { return res.send('<p style="color:#fff;font-family:sans-serif;padding:40px;background:#0a0e17;min-height:100vh">尚無資料，請先輸入支出。<br><small>' + e.message + '</small></p>'); }
  }
  let html = fs.readFileSync(OUTPUT_HTML, 'utf8');
  const pwa = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#58a6ff"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="家庭支出">`;
  html = html.replace('</head>', pwa + '</head>');
  res.send(html);
});

if (fs.existsSync(HISTORY_FILE)) {
  try { regenerate(); console.log('✓ 儀錶板 HTML 已重新產生'); }
  catch(e) { console.error('⚠️ 啟動時產生儀錶板失敗：', e.message); }
}

app.listen(PORT, () => {
  console.log(`\n💸 家庭支出儀錶板已啟動`);
  console.log(`   瀏覽器開啟：http://localhost:${PORT}\n`);
  if (process.env.NODE_ENV !== 'production') {
    try { execSync(`start http://localhost:${PORT}`); } catch(e) {}
  }
});
