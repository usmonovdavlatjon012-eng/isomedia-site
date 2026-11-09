/**
 * ISOMEDIA sayt — lidlar arxivi va amoCRM qayta urinish navbati.
 *
 * O'rnatish:
 *  1. Google Sheets jadvalida: Kengaytmalar → Apps Script, shu kodni joylang.
 *  2. Loyiha sozlamalari (⚙️) → Script Properties ga qo'shing:
 *       SECRET              — Vercel'dagi SHEETS_SECRET bilan bir xil uzun tasodifiy matn
 *       AMO_DOMAIN          — masalan isomedia.amocrm.ru
 *       AMO_TOKEN           — amoCRM uzoq muddatli tokeni
 *       AMO_PIPELINE_ID     — (ixtiyoriy)
 *       AMO_STATUS_ID       — (ixtiyoriy)
 *       TELEGRAM_BOT_TOKEN  — ogohlantirishlar uchun
 *       TELEGRAM_CHAT_ID
 *  3. Funksiyalar ro'yxatidan `setup` ni tanlab, Run bosing (ruxsat so'raydi).
 *  4. Deploy → New deployment → Web app: Execute as "Me", Who has access "Anyone".
 *     Berilgan /exec linkini Vercel'dagi SHEETS_WEBHOOK_URL ga qo'ying.
 */

var SHEET_NAME = 'Lidlar';
var MAX_TRIES = 3;
var HEADERS = [
  'Sana', 'Ism', 'Telefon', 'Format', 'Izoh',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid',
  'Sahifa', 'event_id', 'fbp', 'fbc', 'IP', 'User agent',
  'amoCRM lid ID', 'amoCRM holati', 'Urinishlar', 'CAPI Lead', 'Tizim izohi'
];
var COL = {};
HEADERS.forEach(function (h, i) { COL[h] = i + 1; });

function props_() { return PropertiesService.getScriptProperties().getProperties(); }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#06141B').setFontColor('#EEF0EF');
    // Texnik ustunlarni (sahifa ... User agent) yig'ib qo'yamiz
    sh.getRange(1, COL['Sahifa'], 1, COL['User agent'] - COL['Sahifa'] + 1).shiftColumnGroupDepth(1);
  }
  return sh;
}

/** Bir marta ishga tushiring: jadval sarlavhalari va 10 daqiqalik trigger. */
function setup() {
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'retryAmo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('retryAmo').timeBased().everyMinutes(10).create();
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Vercel funksiyasi har bir arizani shu yerga yuboradi. */
function doPost(e) {
  var p = props_();
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  if (!p.SECRET || body.secret !== p.SECRET) return json_({ ok: false, error: 'secret' });

  var l = body.lead || {};
  var u = l.utm || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var row = [
      l.time ? new Date(l.time) : new Date(), l.name || '', "'" + (l.phone || ''), l.type || '', l.comment || '',
      u.utm_source || '', u.utm_medium || '', u.utm_campaign || '', u.utm_content || '', u.utm_term || '', u.fbclid || '',
      l.page || '', l.event_id || '', l.fbp || '', l.fbc || '', l.ip || '', l.ua || '',
      l.amo_id || '', l.amo_state || '', l.amo_state === 'xato' ? 1 : 0, l.capi_state || '', ''
    ];
    sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

/** Har 10 daqiqada: amoCRM'ga tushmagan arizalarni qayta yuboradi. */
function retryAmo() {
  var p = props_();
  if (!p.AMO_DOMAIN || !p.AMO_TOKEN) return;
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();

  data.forEach(function (r, i) {
    var state = r[COL['amoCRM holati'] - 1];
    var tries = Number(r[COL['Urinishlar'] - 1]) || 0;
    if (state !== 'xato' || tries >= MAX_TRIES) return;

    var rowNum = i + 2;
    var lead = {
      name: r[COL['Ism'] - 1], phone: String(r[COL['Telefon'] - 1]).replace(/^'/, ''), type: r[COL['Format'] - 1],
      comment: r[COL['Izoh'] - 1], page: r[COL['Sahifa'] - 1],
      utm: {
        utm_source: r[COL['utm_source'] - 1], utm_medium: r[COL['utm_medium'] - 1], utm_campaign: r[COL['utm_campaign'] - 1],
        utm_content: r[COL['utm_content'] - 1], utm_term: r[COL['utm_term'] - 1]
      }
    };
    var res = createAmoLead_(p, lead);
    tries += 1;
    sh.getRange(rowNum, COL['Urinishlar']).setValue(tries);

    if (res.ok) {
      sh.getRange(rowNum, COL['amoCRM lid ID']).setValue(res.id);
      sh.getRange(rowNum, COL['amoCRM holati']).setValue('ok (qayta)');
      sh.getRange(rowNum, COL['Tizim izohi']).setValue('Qayta urinishda amoCRMga tushdi: ' + new Date().toLocaleString());
      telegram_(p, '♻️ <b>' + esc_(lead.name) + '</b> (' + esc_(lead.phone) + ') arizasi amoCRMga qayta yuborildi.\n' +
        '🔗 <a href="https://' + p.AMO_DOMAIN + '/leads/detail/' + res.id + '">amoCRM\'da ochish</a>');
    } else {
      sh.getRange(rowNum, COL['Tizim izohi']).setValue('Urinish ' + tries + ': xato ' + res.status);
      if (tries >= MAX_TRIES) {
        telegram_(p, '⚠️ <b>' + esc_(lead.name) + '</b> (' + esc_(lead.phone) + ') arizasi ' + MAX_TRIES +
          ' urinishda ham amoCRMga tushmadi (xato ' + res.status + '). Qo\'lda kiriting va amoCRM tokenini tekshiring.');
      }
    }
  });
}

function createAmoLead_(p, lead) {
  var num = function (v) { return v && /^\d+$/.test(v) ? Number(v) : undefined; };
  var payload = [{
    name: 'Sayt: ' + lead.type + ' — ' + lead.name,
    pipeline_id: num(p.AMO_PIPELINE_ID),
    status_id: num(p.AMO_STATUS_ID),
    _embedded: {
      tags: [{ name: 'sayt' }, { name: lead.type }],
      contacts: [{
        first_name: lead.name,
        custom_fields_values: [{ field_code: 'PHONE', values: [{ value: lead.phone, enum_code: 'WORK' }] }]
      }]
    }
  }];
  var base = 'https://' + p.AMO_DOMAIN + '/api/v4';
  var headers = { Authorization: 'Bearer ' + p.AMO_TOKEN };
  try {
    var r = UrlFetchApp.fetch(base + '/leads/complex', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = r.getResponseCode();
    var data = JSON.parse(r.getContentText() || 'null');
    if (code >= 300 || !data || !data[0] || !data[0].id) return { ok: false, status: code };
    var id = data[0].id;
    var note = ['Format: ' + lead.type, lead.comment ? 'Izoh: ' + lead.comment : '', 'Sahifa: ' + lead.page]
      .concat(Object.keys(lead.utm).filter(function (k) { return lead.utm[k]; }).map(function (k) { return k + ': ' + lead.utm[k]; }))
      .concat(['(qayta urinish orqali yaratildi)'])
      .filter(String).join('\n');
    UrlFetchApp.fetch(base + '/leads/' + id + '/notes', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify([{ note_type: 'common', params: { text: note } }]), muteHttpExceptions: true
    });
    return { ok: true, id: id };
  } catch (err) {
    return { ok: false, status: 'tarmoq' };
  }
}

function telegram_(p, text) {
  if (!p.TELEGRAM_BOT_TOKEN || !p.TELEGRAM_CHAT_ID) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + p.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: p.TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
}

function esc_(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

/** Qo'lda sinash: bitta test qator qo'shadi (amoCRM holati "xato" bilan), so'ng retryAmo'ni ishga tushiring. */
function testRow() {
  doPost({ postData: { contents: JSON.stringify({ secret: props_().SECRET, lead: {
    name: 'Test', phone: '+998900000000', type: 'Reels', comment: 'Apps Script sinovi', utm: {}, page: 'test',
    event_id: 'test-' + Date.now(), amo_state: 'xato', capi_state: "o'chiq"
  } }) } });
}
