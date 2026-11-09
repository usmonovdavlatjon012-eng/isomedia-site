// Saytdagi ariza formasi shu funksiyaga keladi. Ariza bir vaqtda to'rt joyga ketadi:
//   1) amoCRM      — kontakt + lid (UTM, izoh bilan)
//   2) Meta CAPI   — server "Lead" hodisasi (brauzerdagi Pixel bilan event_id orqali dublsiz)
//   3) Sheets      — doimiy arxiv + amoCRM'ga qayta urinish navbati (Apps Script)
//   4) Telegram    — menejerlarga xabar (amoCRM linki va nosozlik ogohlantirishlari bilan)
// Bittasi ishlamasa ham qolganlari ishlaydi, ariza yo'qolmaydi.
//
// Vercel → Settings → Environment Variables (README'da batafsil):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   AMO_DOMAIN, AMO_TOKEN, [AMO_PIPELINE_ID, AMO_STATUS_ID, AMO_RESPONSIBLE_ID]
//   META_PIXEL_ID, META_CAPI_TOKEN, [META_TEST_EVENT_CODE, META_API_VERSION]
//   SHEETS_WEBHOOK_URL, SHEETS_SECRET

const crypto = require('crypto');

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
const TYPES = ['Reels', 'Podkast', 'YouTube video', 'Boshqa'];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const sha256 = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase(), 'utf8').digest('hex');
const num = (v) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function fetchJson(url, opts, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(t);
  }
}

// ---------- amoCRM ----------
function amoConfig() {
  const domain = (process.env.AMO_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return domain && process.env.AMO_TOKEN ? { domain, token: process.env.AMO_TOKEN } : null;
}

async function sendToAmo(lead) {
  const cfg = amoConfig();
  if (!cfg) return { skipped: true };

  const base = `https://${cfg.domain}/api/v4`;
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };

  const utmFields = UTM_KEYS.filter((k) => lead.utm[k]).map((k) => ({
    field_code: k.toUpperCase(),
    values: [{ value: lead.utm[k] }],
  }));

  const build = (withUtm) => [{
    name: `Sayt: ${lead.type} — ${lead.name}`,
    pipeline_id: num(process.env.AMO_PIPELINE_ID),
    status_id: num(process.env.AMO_STATUS_ID),
    responsible_user_id: num(process.env.AMO_RESPONSIBLE_ID),
    custom_fields_values: withUtm && utmFields.length ? utmFields : undefined,
    _embedded: {
      tags: [{ name: 'sayt' }, { name: lead.type }],
      contacts: [{
        first_name: lead.name,
        custom_fields_values: [{ field_code: 'PHONE', values: [{ value: lead.phone, enum_code: 'WORK' }] }],
      }],
    },
  }];

  let r = await fetchJson(`${base}/leads/complex`, { method: 'POST', headers, body: JSON.stringify(build(true)) });
  // Akkauntda UTM maydonlari bo'lmasa, UTM'siz qayta urinamiz (UTM baribir izohga yoziladi)
  if (!r.ok && r.status === 400 && utmFields.length) {
    r = await fetchJson(`${base}/leads/complex`, { method: 'POST', headers, body: JSON.stringify(build(false)) });
  }
  if (!r.ok || !Array.isArray(r.data) || !r.data[0] || !r.data[0].id) {
    console.error('amoCRM xatosi:', r.status, JSON.stringify(r.data).slice(0, 800));
    return { ok: false, status: r.status || 'tarmoq' };
  }

  const leadId = r.data[0].id;
  const noteLines = [
    `Format: ${lead.type}`,
    lead.comment && `Izoh: ${lead.comment}`,
    `Sahifa: ${lead.page}`,
    ...UTM_KEYS.filter((k) => lead.utm[k]).map((k) => `${k}: ${lead.utm[k]}`),
  ].filter(Boolean);
  const note = await fetchJson(`${base}/leads/${leadId}/notes`, {
    method: 'POST', headers,
    body: JSON.stringify([{ note_type: 'common', params: { text: noteLines.join('\n') } }]),
  });
  if (!note.ok) console.error('amoCRM izoh xatosi:', note.status, JSON.stringify(note.data).slice(0, 400));

  return { ok: true, id: leadId, url: `https://${cfg.domain}/leads/detail/${leadId}` };
}

// ---------- Meta Conversions API ----------
async function sendToCapi(lead) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return { skipped: true };

  const userData = {
    ph: [sha256(lead.phone.replace(/\D/g, ''))],
    fn: [sha256(lead.name.split(/\s+/)[0])],
    country: [sha256('uz')],
    client_ip_address: lead.ip || undefined,
    client_user_agent: lead.ua || undefined,
    fbp: lead.fbp || undefined,
    fbc: lead.fbc || undefined,
  };
  const body = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: lead.event_id,
      action_source: 'website',
      event_source_url: lead.page || undefined,
      user_data: userData,
      custom_data: { content_name: lead.type, lead_source: 'sayt' },
    }],
  };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;

  const ver = process.env.META_API_VERSION || 'v23.0';
  const r = await fetchJson(
    `https://graph.facebook.com/${ver}/${pixel}/events?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!r.ok || !r.data || !r.data.events_received) {
    console.error('CAPI xatosi:', r.status, JSON.stringify(r.data).slice(0, 600));
    return { ok: false, status: r.status || 'tarmoq' };
  }
  return { ok: true };
}

// ---------- Google Sheets (Apps Script Web App) ----------
async function sendToSheets(lead, amo, capi) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) return { skipped: true };
  const state = (x) => (x.ok ? 'ok' : x.skipped ? "o'chiq" : 'xato');
  const r = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.SHEETS_SECRET || '',
      lead: {
        time: new Date().toISOString(),
        name: lead.name, phone: lead.phone, type: lead.type, comment: lead.comment,
        utm: lead.utm, page: lead.page,
        event_id: lead.event_id, fbp: lead.fbp, fbc: lead.fbc, ip: lead.ip, ua: lead.ua,
        amo_id: amo.id || '', amo_state: state(amo), capi_state: state(capi),
      },
    }),
  }, 8000);
  if (!r.ok || !r.data || r.data.ok !== true) {
    console.error('Sheets xatosi:', r.status, JSON.stringify(r.data).slice(0, 300));
    return { ok: false };
  }
  return { ok: true };
}

// ---------- Telegram ----------
async function sendToTelegram(lead, amo, sheets) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };

  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
  const lines = [
    '🎬 <b>Yangi ariza — ISOMEDIA sayt</b>',
    '',
    `👤 <b>Ism:</b> ${esc(lead.name)}`,
    `📞 <b>Telefon:</b> ${esc(lead.phone)}`,
    `🎥 <b>Format:</b> ${esc(lead.type)}`,
  ];
  if (lead.comment) lines.push(`💬 <b>Izoh:</b> ${esc(lead.comment)}`);
  lines.push('', `🕒 ${esc(time)}`);

  const utm = UTM_KEYS.filter((k) => lead.utm[k] && k !== 'fbclid').map((k) => `${k}: ${esc(lead.utm[k])}`);
  if (utm.length) lines.push('', '<b>Manba:</b>', ...utm);

  if (amo.ok) lines.push('', `🔗 <a href="${amo.url}">amoCRM'da ochish</a>`);
  else if (!amo.skipped) {
    lines.push('', sheets.ok
      ? `⏳ amoCRM'ga tushmadi (xato ${esc(amo.status)}). Sheets'dan avtomatik qayta yuboriladi.`
      : `⚠️ amoCRM'ga tushmadi (xato ${esc(amo.status)}). Qo'lda kiriting.`);
  }
  if (!sheets.ok && !sheets.skipped) lines.push("⚠️ Sheets arxiviga yozilmadi.");

  const r = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok || !r.data || !r.data.ok) {
    console.error('Telegram xatosi:', r.status, JSON.stringify(r.data).slice(0, 400));
    return { ok: false };
  }
  return { ok: true };
}

const safe = (p, label) => p.catch((e) => { console.error(label, e); return { ok: false, status: 'tarmoq' }; });

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const b = parseBody(req);
  if (b.website) return res.status(200).json({ ok: true }); // bot to'ldiradigan yashirin maydon

  const name = clip(b.name, 80);
  const digits = String(b.phone || '').replace(/\D/g, '');
  const local = digits.startsWith('998') ? digits.slice(3) : digits;
  const type = TYPES.includes(b.type) ? b.type : 'Boshqa';
  if (name.length < 2 || local.length !== 9) {
    return res.status(400).json({ ok: false, error: "Ism yoki telefon noto'g'ri" });
  }

  const utmIn = b.utm && typeof b.utm === 'object' ? b.utm : {};
  const utm = {};
  UTM_KEYS.forEach((k) => { if (utmIn[k]) utm[k] = clip(utmIn[k], 150); });

  const fbp = /^fb\.\d\.\d+\.\d+$/.test(b.fbp || '') ? b.fbp : '';
  const fbc = /^fb\.\d\.\d+\..+$/.test(b.fbc || '') ? clip(b.fbc, 300) : '';
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';

  const lead = {
    name,
    phone: `+998${local}`,
    type,
    comment: clip(b.comment, 500),
    page: clip(b.page, 300),
    utm,
    event_id: /^[\w.-]{6,80}$/.test(b.event_id || '') ? b.event_id : `lead-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    fbp,
    fbc,
    ip,
    ua: clip(req.headers['user-agent'], 400),
  };

  const [amo, capi] = await Promise.all([safe(sendToAmo(lead), 'amoCRM:'), safe(sendToCapi(lead), 'CAPI:')]);
  const sheets = await safe(sendToSheets(lead, amo, capi), 'Sheets:');
  const tg = await safe(sendToTelegram(lead, amo, sheets), 'Telegram:');

  if (amo.ok || tg.ok || sheets.ok) return res.status(200).json({ ok: true });
  if (amo.skipped && tg.skipped && sheets.skipped) return res.status(500).json({ ok: false, error: 'Sozlanmagan' });
  return res.status(502).json({ ok: false, error: "Yuborib bo'lmadi" });
};
