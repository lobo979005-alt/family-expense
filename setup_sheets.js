#!/usr/bin/env node
/**
 * 家庭支出 × Google 試算表 — 一次性設定腳本
 * 用法：node setup_sheets.js
 *
 * 1. OAuth 授權 2. 建立試算表 3. 儲存 refresh_token
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const OAUTH_KEYS  = 'C:/Users/terry/.gmail-mcp/gcp-oauth.keys.json';
const CONFIG_FILE = 'C:/Users/terry/.claude/family_expense_sheets_config.json';
const SCOPES      = ['https://www.googleapis.com/auth/spreadsheets'];

function createOAuth2Client() {
  const keys = JSON.parse(fs.readFileSync(OAUTH_KEYS, 'utf8')).installed;
  return new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost');
}

async function authorize(auth) {
  const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  console.log('\n請用瀏覽器開啟以下網址並授權：\n');
  console.log(url);
  console.log('\n授權後網址列會顯示 code=XXXX，把 code 值貼到這裡：');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise(r => rl.question('code> ', a => { rl.close(); r(a.trim()); }));
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  return tokens;
}

async function createSpreadsheet(sheets) {
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: '💸 家庭支出紀錄' },
      sheets: [
        { properties: { sheetId: 0, title: '支出明細', gridProperties: { frozenRowCount: 2 } } },
        { properties: { sheetId: 1, title: '月份摘要', gridProperties: { frozenRowCount: 1 } } },
      ]
    }
  });
  return res.data.spreadsheetId;
}

async function writeHeaders(sheets, spreadsheetId) {
  const header1 = ['家庭支出紀錄', '', '', '', '', ''];
  const header2 = ['月份', '項目', '標籤', '金額', '備註', '建立時間'];
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: '支出明細!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [header1, header2] }
  });
}

async function applyFormatting(sheets, spreadsheetId) {
  const requests = [
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.04, green: 0.06, blue: 0.09 },
          textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 0.35, green: 0.65, blue: 1 } }
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.07, green: 0.09, blue: 0.16 },
          textFormat: { bold: true, foregroundColor: { red: 0.8, green: 0.8, blue: 0.85 } }
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 } } },
    { autoResizeDimensions: { dimensions: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 10 } } },
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function main() {
  console.log('\n💸 家庭支出 × Google 試算表 設定工具\n');

  let spreadsheetId, refreshToken;
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    spreadsheetId = cfg.spreadsheet_id;
    refreshToken  = cfg.refresh_token;
    console.log(`✓ 已有設定檔，試算表 ID: ${spreadsheetId || '(未建)'}`);
  }

  const auth = createOAuth2Client();
  if (refreshToken) {
    auth.setCredentials({ refresh_token: refreshToken });
  } else {
    const tokens = await authorize(auth);
    refreshToken = tokens.refresh_token;
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ refresh_token: refreshToken }, null, 2), 'utf8');
    console.log('✓ 授權成功，token 已儲存');
  }

  const sheets = google.sheets({ version: 'v4', auth });

  if (!spreadsheetId) {
    console.log('\n建立新試算表...');
    spreadsheetId = await createSpreadsheet(sheets);
    console.log(`✓ 試算表已建立：https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  }

  console.log('寫入標題列...');
  await writeHeaders(sheets, spreadsheetId);
  console.log('套用格式...');
  await applyFormatting(sheets, spreadsheetId);

  const config = { spreadsheet_id: spreadsheetId, refresh_token: refreshToken };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log(`\n✅ 完成！設定已儲存至 ${CONFIG_FILE}`);
  console.log(`\n📊 試算表網址：https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  console.log(`\n🚂 Railway 環境變數：`);
  console.log(`   FAMILY_SHEETS_SPREADSHEET_ID = ${spreadsheetId}`);
  console.log(`   FAMILY_SHEETS_REFRESH_TOKEN  = ${refreshToken}`);
}

main().catch(e => { console.error('\n❌ 錯誤：', e.message); process.exit(1); });
