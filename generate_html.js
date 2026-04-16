#!/usr/bin/env node
/**
 * 家庭支出儀錶板 HTML 產生器
 * 用法：node generate_html.js --history <csv> --output <html>
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i+1] : def;
}
const HISTORY_FILE = arg('--history', 'C:/Users/terry/.claude/family_expense_history.csv');
const OUTPUT_HTML  = arg('--output',  'C:/Users/terry/.claude/family_expense_dashboard.html');

// ── CSV parsing（與 server 共用邏輯，簡化版）────────────────────────
function parseLine(line) {
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
}

function loadEntries() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n');
  if (lines.length <= 1) return [];
  return lines.slice(1).map(l => {
    const [id, month, item, tag, amount, note, created_at] = parseLine(l);
    return { id, month, item, tag, amount: +amount, note, created_at };
  });
}

const entries = loadEntries();

// 統計
const byMonth = {};
const byTagThisMonth = {};
const allTagSet = new Set();
entries.forEach(r => {
  byMonth[r.month] = (byMonth[r.month] || 0) + r.amount;
  allTagSet.add(r.tag);
});
const months = Object.keys(byMonth).sort();
const latestMonth = months[months.length - 1] || new Date().toISOString().slice(0,7);
entries.filter(r => r.month === latestMonth).forEach(r => {
  byTagThisMonth[r.tag] = (byTagThisMonth[r.tag] || 0) + r.amount;
});
const grandTotal = entries.reduce((s, r) => s + r.amount, 0);
const latestTotal = byMonth[latestMonth] || 0;
const entryCount = entries.length;
const avgMonth = months.length ? Math.round(grandTotal / months.length) : 0;
const maxMonth = months.reduce((best, m) => (byMonth[m] > (best.v||0) ? { m, v: byMonth[m] } : best), {});

// 常用標籤/項目
const tagCount = {}, itemCount = {};
entries.forEach(r => {
  tagCount[r.tag] = (tagCount[r.tag] || 0) + 1;
  itemCount[r.item] = (itemCount[r.item] || 0) + 1;
});
['信用卡','小孩','孝親','其他'].forEach(t => { if (!(t in tagCount)) tagCount[t] = 0; });
const tagList  = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
const itemList = Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);

const fmt = n => n.toLocaleString('zh-TW');
const safeJson = obj => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const escHtml = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>💸 家庭支出紀錄</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#0a0e17;color:#e8e8f0;font-family:-apple-system,"Microsoft JhengHei",sans-serif;min-height:100vh}
body{padding:24px 28px 120px;max-width:1400px;margin:0 auto}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#0a0e17}::-webkit-scrollbar-thumb{background:#1f2a44;border-radius:4px}

header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1f2a44}
h1{font-size:26px;font-weight:800;background:linear-gradient(90deg,#58a6ff,#c792ea);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 40px rgba(88,166,255,.2)}
.sub{font-size:12px;color:#8b93a7;margin-top:4px}
.logout{font-size:12px;color:#8b93a7;text-decoration:none;padding:6px 12px;border:1px solid #1f2a44;border-radius:6px}
.logout:hover{color:#58a6ff;border-color:#58a6ff}

.grand{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:22px}
.g-card{background:linear-gradient(135deg,#111827,#0c1220);border:1px solid #1f2a44;border-radius:12px;padding:14px 18px;position:relative;overflow:hidden}
.g-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#58a6ff,#c792ea)}
.g-card .lab{font-size:11px;color:#8b93a7;letter-spacing:.5px;margin-bottom:6px;font-weight:500}
.g-card .val{font-size:22px;font-weight:800;color:#e8e8f0}
.g-card .val.hi{color:#ffd166}
.g-card .sub2{font-size:10px;color:#5c6578;margin-top:3px}

.charts{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:22px}
@media(max-width:900px){.charts{grid-template-columns:1fr}}
.chart-box{background:#0c1220;border:1px solid #1f2a44;border-radius:12px;padding:16px 18px}
.chart-title{font-size:13px;color:#8b93a7;font-weight:600;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.chart-title b{color:#e8e8f0;font-weight:700}
.chart-box canvas{max-height:260px}

.section-title{font-size:14px;font-weight:700;color:#e8e8f0;margin:22px 0 12px;display:flex;justify-content:space-between;align-items:center}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filter-pill{background:#111827;border:1px solid #1f2a44;border-radius:20px;padding:5px 12px;font-size:11px;color:#8b93a7;cursor:pointer;transition:all .15s}
.filter-pill:hover{border-color:#58a6ff;color:#58a6ff}
.filter-pill.active{background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff}

.table-wrap{background:#0c1220;border:1px solid #1f2a44;border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#111827;color:#8b93a7;font-weight:600;text-align:left;padding:10px 14px;font-size:11px;letter-spacing:.5px;border-bottom:1px solid #1f2a44}
td{padding:10px 14px;border-bottom:1px solid #151c2e;color:#e8e8f0}
tr:last-child td{border-bottom:none}
tr:hover td{background:#111827}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.tag-信用卡{background:rgba(88,166,255,.15);color:#58a6ff}
.tag-小孩{background:rgba(199,146,234,.15);color:#c792ea}
.tag-孝親{background:rgba(255,209,102,.15);color:#ffd166}
.tag-其他{background:rgba(139,147,167,.15);color:#8b93a7}
.tag-custom{background:rgba(61,220,132,.15);color:#3ddc84}
.amt{text-align:right;font-weight:700;font-family:"SF Mono",Consolas,monospace}
.row-actions{display:flex;gap:6px;justify-content:flex-end}
.icon-btn{background:transparent;border:1px solid #1f2a44;border-radius:6px;padding:4px 8px;color:#8b93a7;cursor:pointer;font-size:12px}
.icon-btn:hover{color:#58a6ff;border-color:#58a6ff}
.icon-btn.del:hover{color:#ff5555;border-color:#ff5555}
.empty{text-align:center;padding:40px;color:#5c6578;font-size:13px}

/* 輸入抽屜 */
#toggle-btn{position:fixed;right:24px;bottom:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#58a6ff,#c792ea);color:#fff;border:none;font-size:26px;cursor:pointer;box-shadow:0 6px 24px rgba(88,166,255,.5);z-index:201;font-weight:700}
#toggle-btn:hover{transform:scale(1.05)}

#drawer{position:fixed;right:0;top:0;height:100vh;width:460px;max-width:100vw;background:#0c1220;border-left:1px solid #1f2a44;z-index:200;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;box-shadow:-4px 0 32px rgba(0,0,0,.6)}
#drawer.open{transform:translateX(0)}
@media(max-width:768px){#drawer{width:100%;height:92vh;top:auto;bottom:0;border-radius:20px 20px 0 0;transform:translateY(100%)}#drawer.open{transform:translateY(0)}}
.dr-head{padding:18px 22px;border-bottom:1px solid #1f2a44;display:flex;justify-content:space-between;align-items:center}
.dr-title{font-size:16px;font-weight:700}
.dr-close{background:none;border:none;color:#8b93a7;font-size:22px;cursor:pointer}
.dr-body{flex:1;overflow-y:auto;padding:18px 22px}
.dr-foot{padding:14px 22px;border-top:1px solid #1f2a44;display:flex;gap:10px}
.dr-foot button{flex:1;padding:12px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;border:none}
.btn-primary{background:linear-gradient(90deg,#58a6ff,#c792ea);color:#fff}
.btn-primary:disabled{opacity:.5;cursor:default}
.btn-secondary{background:#1f2a44;color:#8b93a7}

.field{margin-bottom:14px}
.field label{display:block;font-size:11px;color:#8b93a7;margin-bottom:5px;font-weight:500}
.field input,.field select{width:100%;background:#111827;border:1px solid #1f2a44;border-radius:6px;padding:9px 11px;color:#e8e8f0;font-size:14px;outline:none;font-family:inherit}
.field input:focus,.field select:focus{border-color:#58a6ff}

.entry-row{background:#111827;border:1px solid #1f2a44;border-radius:10px;padding:12px;margin-bottom:10px;position:relative}
.entry-row .row-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.entry-row .row-idx{font-size:11px;color:#8b93a7;font-weight:600}
.entry-row .row-del{background:none;border:none;color:#ff5555;cursor:pointer;font-size:16px;padding:0 4px}
.entry-row .row-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.entry-row .field{margin-bottom:8px}
.add-row-btn{width:100%;padding:10px;background:transparent;border:1px dashed #1f2a44;border-radius:8px;color:#8b93a7;cursor:pointer;font-size:13px;margin-bottom:14px}
.add-row-btn:hover{border-color:#58a6ff;color:#58a6ff}

.err-box{background:rgba(255,85,85,.1);border:1px solid rgba(255,85,85,.3);border-radius:8px;padding:10px 12px;margin-top:12px;font-size:12px;color:#ff5555;display:none}
.err-box.show{display:block}
#toast{position:fixed;bottom:100px;left:50%;transform:translateX(-50%) translateY(80px);background:#0d1a17;border:1px solid #3ddc84;border-radius:12px;padding:12px 28px;font-size:14px;font-weight:700;color:#3ddc84;z-index:999;opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1);white-space:nowrap;pointer-events:none}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
#toast.err{border-color:#ff5555;color:#ff5555;background:rgba(255,85,85,.1)}

datalist{background:#111827}

.month-chip{font-size:11px;background:#111827;border:1px solid #1f2a44;border-radius:6px;padding:3px 8px;color:#8b93a7}
</style>
</head>
<body>

<header>
  <div>
    <h1>💸 家庭支出紀錄</h1>
    <div class="sub">資料更新：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}　共 ${entryCount} 筆　${months.length} 個月</div>
  </div>
  <a class="logout" href="/logout">登出</a>
</header>

<div class="grand">
  <div class="g-card"><div class="lab">全期累積支出</div><div class="val">$${fmt(grandTotal)}</div><div class="sub2">${entryCount} 筆紀錄</div></div>
  <div class="g-card"><div class="lab">最新月份（${latestMonth}）</div><div class="val">$${fmt(latestTotal)}</div><div class="sub2">${entries.filter(r=>r.month===latestMonth).length} 筆</div></div>
  <div class="g-card"><div class="lab">月平均支出</div><div class="val">$${fmt(avgMonth)}</div><div class="sub2">${months.length} 個月平均</div></div>
  <div class="g-card"><div class="lab">最高單月</div><div class="val hi">$${fmt(maxMonth.v||0)}</div><div class="sub2">${maxMonth.m || '—'}</div></div>
</div>

<div class="charts">
  <div class="chart-box">
    <div class="chart-title"><b>月度支出趨勢</b><span class="month-chip">全期</span></div>
    <canvas id="chart-month"></canvas>
  </div>
  <div class="chart-box">
    <div class="chart-title"><b>當月標籤佔比</b><span class="month-chip">${latestMonth}</span></div>
    <canvas id="chart-tag"></canvas>
  </div>
</div>

<div class="section-title">
  <span>支出明細</span>
  <div class="filters" id="filters"></div>
</div>

<div class="table-wrap">
  <table id="entry-table">
    <thead><tr>
      <th style="width:90px">月份</th>
      <th>項目</th>
      <th style="width:90px">標籤</th>
      <th style="width:110px" class="amt">金額</th>
      <th>備註</th>
      <th style="width:110px"></th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</div>

<button id="toggle-btn" onclick="openDrawer()">＋</button>

<div id="drawer">
  <div class="dr-head">
    <div class="dr-title" id="drawer-title">💸 新增支出</div>
    <button class="dr-close" onclick="closeDrawer()">×</button>
  </div>
  <div class="dr-body">
    <div class="field">
      <label>月份（套用至所有新增列）</label>
      <input type="month" id="batch-month">
    </div>
    <div id="batch-list"></div>
    <button class="add-row-btn" onclick="addRow()">＋ 新增一列</button>
    <div class="err-box" id="batch-err"></div>
  </div>
  <div class="dr-foot">
    <button class="btn-secondary" onclick="closeDrawer()">取消</button>
    <button class="btn-primary" id="save-btn" onclick="saveBatch()">儲存全部</button>
  </div>
</div>

<div id="toast"></div>

<datalist id="tags-dl">${tagList.map(t=>`<option value="${escHtml(t)}">`).join('')}</datalist>
<datalist id="items-dl">${itemList.map(i=>`<option value="${escHtml(i)}">`).join('')}</datalist>

<script>
const ENTRIES = ${safeJson(entries)};
const BY_MONTH = ${safeJson(byMonth)};
const BY_TAG_LATEST = ${safeJson(byTagThisMonth)};
const LATEST_MONTH = ${safeJson(latestMonth)};
const ALL_TAGS = ${safeJson([...allTagSet])};
const TAG_LIST = ${safeJson(tagList)};

const tagColors = {
  '信用卡':'#58a6ff','小孩':'#c792ea','孝親':'#ffd166','其他':'#8b93a7'
};
const palette = ['#58a6ff','#c792ea','#ffd166','#3ddc84','#ff8fa3','#ff9e64','#7ee787','#79c0ff','#d2a8ff'];
function colorForTag(t, i){ return tagColors[t] || palette[i % palette.length]; }

// ── Month bar chart ────────────────────────────────────────────────
const monthKeys = Object.keys(BY_MONTH).sort();
new Chart(document.getElementById('chart-month'), {
  type: 'bar',
  data: {
    labels: monthKeys,
    datasets: [{
      label: '總支出',
      data: monthKeys.map(m => BY_MONTH[m]),
      backgroundColor: monthKeys.map((_,i) => 'rgba(88,166,255,' + (0.4 + 0.6*(i+1)/monthKeys.length) + ')'),
      borderColor: '#58a6ff', borderWidth: 1, borderRadius: 6
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>'$'+c.parsed.y.toLocaleString()}} },
    scales: {
      x: { ticks:{color:'#8b93a7'}, grid:{display:false} },
      y: { ticks:{color:'#8b93a7',callback:v=>'$'+(v/1000)+'k'}, grid:{color:'#151c2e'} }
    }
  }
});

// ── Tag pie ────────────────────────────────────────────────────────
const tagKeys = Object.keys(BY_TAG_LATEST);
new Chart(document.getElementById('chart-tag'), {
  type: 'doughnut',
  data: {
    labels: tagKeys,
    datasets: [{
      data: tagKeys.map(k => BY_TAG_LATEST[k]),
      backgroundColor: tagKeys.map((t,i) => colorForTag(t,i)),
      borderColor: '#0c1220', borderWidth: 2
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend:{position:'bottom',labels:{color:'#8b93a7',font:{size:11},padding:8,usePointStyle:true}},
      tooltip:{callbacks:{label:c=>c.label+': $'+c.parsed.toLocaleString()}}
    }
  }
});

// ── 篩選器 ──────────────────────────────────────────────────────────
let filterTag = 'all';
let filterMonth = 'all';
function renderFilters() {
  const el = document.getElementById('filters');
  const tags = ['all', ...ALL_TAGS];
  el.innerHTML = tags.map(t => {
    const lab = t === 'all' ? '全部標籤' : t;
    return \`<span class="filter-pill \${t===filterTag?'active':''}" onclick="setFilter('tag','\${t}')">\${lab}</span>\`;
  }).join('');
}
function setFilter(type, v) {
  if (type==='tag') filterTag = v;
  else filterMonth = v;
  renderFilters();
  renderTable();
}

// ── 明細表 ──────────────────────────────────────────────────────────
function renderTable() {
  const tb = document.getElementById('tbody');
  let rows = [...ENTRIES].sort((a,b) => b.month.localeCompare(a.month) || b.created_at.localeCompare(a.created_at));
  if (filterTag !== 'all') rows = rows.filter(r => r.tag === filterTag);
  if (filterMonth !== 'all') rows = rows.filter(r => r.month === filterMonth);
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">尚無資料，點右下 ＋ 新增</td></tr>'; return; }
  tb.innerHTML = rows.map(r => {
    const tagClass = ['信用卡','小孩','孝親','其他'].includes(r.tag) ? 'tag-'+r.tag : 'tag-custom';
    return \`<tr data-id="\${r.id}">
      <td>\${r.month}</td>
      <td>\${escapeHtml(r.item)}</td>
      <td><span class="tag \${tagClass}">\${escapeHtml(r.tag)}</span></td>
      <td class="amt">$\${r.amount.toLocaleString()}</td>
      <td style="color:#8b93a7">\${escapeHtml(r.note||'')}</td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="editEntry('\${r.id}')">✎</button>
        <button class="icon-btn del" onclick="deleteEntry('\${r.id}')">🗑</button>
      </div></td>
    </tr>\`;
  }).join('');
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ── Drawer + 批次輸入 ────────────────────────────────────────────────
let batchRows = [];
let editingId = null;

function thisMonthStr(){ return new Date(Date.now()+8*3600*1000).toISOString().slice(0,7); }

function openDrawer() {
  editingId = null;
  document.getElementById('drawer-title').textContent = '💸 新增支出';
  document.getElementById('batch-month').value = thisMonthStr();
  document.getElementById('batch-month').disabled = false;
  batchRows = [{ item:'', tag:'信用卡', amount:'', note:'' }];
  renderBatch();
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('batch-err').classList.remove('show');
}
function addRow() { batchRows.push({ item:'', tag:'信用卡', amount:'', note:'' }); renderBatch(); }
function removeRow(i) {
  if (batchRows.length === 1) return;
  batchRows.splice(i,1); renderBatch();
}
function updateRow(i, field, val) { batchRows[i][field] = val; }

function renderBatch() {
  const tagOpts = TAG_LIST.map(t => \`<option value="\${t}">\${t}</option>\`).join('') + '<option value="__new__">＋ 新增標籤</option>';
  document.getElementById('batch-list').innerHTML = batchRows.map((r,i) => \`
    <div class="entry-row">
      <div class="row-head">
        <span class="row-idx">第 \${i+1} 筆</span>
        \${editingId ? '' : \`<button class="row-del" onclick="removeRow(\${i})" title="移除此列">×</button>\`}
      </div>
      <div class="field">
        <label>項目</label>
        <input type="text" list="items-dl" value="\${escapeHtml(r.item)}" oninput="updateRow(\${i},'item',this.value)" placeholder="例：國泰信用卡帳單">
      </div>
      <div class="row-grid">
        <div class="field">
          <label>標籤</label>
          <select onchange="onTagChange(\${i}, this)">
            \${TAG_LIST.map(t => \`<option value="\${t}" \${t===r.tag?'selected':''}>\${t}</option>\`).join('')}
            <option value="__new__">＋ 新增標籤</option>
          </select>
        </div>
        <div class="field">
          <label>金額</label>
          <input type="text" inputmode="numeric" value="\${r.amount}" oninput="updateRow(\${i},'amount',this.value)" placeholder="0">
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>備註（可選）</label>
        <input type="text" value="\${escapeHtml(r.note||'')}" oninput="updateRow(\${i},'note',this.value)">
      </div>
    </div>
  \`).join('');
}
function onTagChange(i, sel) {
  if (sel.value === '__new__') {
    const t = prompt('新增標籤名稱：');
    if (t && t.trim()) {
      batchRows[i].tag = t.trim();
      if (!TAG_LIST.includes(t.trim())) TAG_LIST.push(t.trim());
      renderBatch();
    } else {
      sel.value = batchRows[i].tag;
    }
  } else {
    batchRows[i].tag = sel.value;
  }
}

async function saveBatch() {
  const btn = document.getElementById('save-btn');
  const errBox = document.getElementById('batch-err');
  errBox.classList.remove('show');
  const month = document.getElementById('batch-month').value;
  if (!month) { errBox.textContent='請選月份'; errBox.classList.add('show'); return; }

  if (editingId) {
    const r = batchRows[0];
    if (!r.item || !r.tag || r.amount === '') { errBox.textContent='請填完項目/標籤/金額'; errBox.classList.add('show'); return; }
    btn.disabled = true; btn.textContent = '儲存中...';
    try {
      const res = await fetch('/api/entry/'+editingId, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ month, item:r.item, tag:r.tag, amount:+r.amount, note:r.note })
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      toast('✓ 已更新');
      setTimeout(()=>location.reload(), 1200);
    } catch(e) { errBox.textContent='錯誤：'+e.message; errBox.classList.add('show'); btn.disabled=false; btn.textContent='儲存全部'; }
    return;
  }

  const valid = batchRows.filter(r => r.item && r.tag && r.amount !== '');
  if (!valid.length) { errBox.textContent='至少填一筆完整資料（項目/標籤/金額）'; errBox.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = '儲存中...';
  try {
    const res = await fetch('/api/entries', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entries: valid.map(r => ({ month, item:r.item, tag:r.tag, amount:+r.amount, note:r.note })) })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error);
    toast('✓ 已新增 '+d.count+' 筆');
    setTimeout(()=>location.reload(), 1200);
  } catch(e) { errBox.textContent='錯誤：'+e.message; errBox.classList.add('show'); btn.disabled=false; btn.textContent='儲存全部'; }
}

function editEntry(id) {
  const r = ENTRIES.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById('drawer-title').textContent = '✎ 編輯支出';
  document.getElementById('batch-month').value = r.month;
  batchRows = [{ item:r.item, tag:r.tag, amount:String(r.amount), note:r.note||'' }];
  renderBatch();
  document.getElementById('drawer').classList.add('open');
}

async function deleteEntry(id) {
  const r = ENTRIES.find(x => x.id === id);
  if (!r) return;
  if (!confirm('刪除「' + r.item + '」（$' + r.amount.toLocaleString() + '）？')) return;
  try {
    const res = await fetch('/api/entry/'+id, { method:'DELETE' });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error);
    toast('✓ 已刪除');
    setTimeout(()=>location.reload(), 1000);
  } catch(e) { toast('刪除失敗：'+e.message, true); }
}

function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isErr ? 'err show' : 'show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = isErr ? 'err' : ''; }, 2500);
}

renderFilters();
renderTable();
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
console.log(`✓ HTML 已產生：${OUTPUT_HTML}`);
