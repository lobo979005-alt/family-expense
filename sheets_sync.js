/**
 * 家庭支出 × Google 試算表 同步模組
 */
const { google } = require('googleapis');
const fs = require('fs');

const OAUTH_KEYS  = 'C:/Users/terry/.gmail-mcp/gcp-oauth.keys.json';
const CONFIG_FILE = 'C:/Users/terry/.claude/family_expense_sheets_config.json';

function getConfig() {
  if (process.env.FAMILY_SHEETS_SPREADSHEET_ID && process.env.FAMILY_SHEETS_REFRESH_TOKEN) {
    return {
      spreadsheet_id: process.env.FAMILY_SHEETS_SPREADSHEET_ID,
      refresh_token:  process.env.FAMILY_SHEETS_REFRESH_TOKEN,
    };
  }
  if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return null;
}

function createSheetsClient(refreshToken) {
  let clientId, clientSecret;
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    clientId = process.env.GOOGLE_CLIENT_ID;
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  } else {
    const keys = JSON.parse(fs.readFileSync(OAUTH_KEYS, 'utf8')).installed;
    clientId = keys.client_id; clientSecret = keys.client_secret;
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  auth.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: 'v4', auth });
}

async function syncToSheets(allEntries) {
  const config = getConfig();
  if (!config) { console.log('[Sheets sync] 跳過：未設定 Sheets 憑證'); return; }

  const { spreadsheet_id, refresh_token } = config;
  const sheets = createSheetsClient(refresh_token);

  const sorted = [...allEntries].sort((a, b) =>
    a.month.localeCompare(b.month) || a.created_at.localeCompare(b.created_at)
  );

  // 支出明細
  const detailRows = sorted.map(r => [
    r.month, r.item, r.tag, r.amount, r.note || '', r.created_at
  ]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheet_id, range: '支出明細!A3:F'
  });
  if (detailRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet_id, range: '支出明細!A3',
      valueInputOption: 'RAW', requestBody: { values: detailRows }
    });
  }

  // 月份摘要（動態標籤欄）
  const allTags = [...new Set(sorted.map(r => r.tag))].sort();
  const monthMap = {};
  sorted.forEach(r => {
    monthMap[r.month] = monthMap[r.month] || { total: 0, byTag: {} };
    monthMap[r.month].total += r.amount;
    monthMap[r.month].byTag[r.tag] = (monthMap[r.month].byTag[r.tag] || 0) + r.amount;
  });
  const summaryHeader = ['月份', '總支出', ...allTags];
  const summaryRows = Object.entries(monthMap).sort().map(([m, s]) => [
    m, s.total, ...allTags.map(t => s.byTag[t] || 0)
  ]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheet_id, range: '月份摘要!A1:Z'
  });
  if (summaryRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet_id, range: '月份摘要!A1',
      valueInputOption: 'RAW', requestBody: { values: [summaryHeader, ...summaryRows] }
    });
  }
}

module.exports = { syncToSheets };
