// Saytdagi ariza formasi shu funksiyaga keladi:
//   1) amoCRM'da kontakt + lid ochiladi (UTM va izoh bilan)
//   2) Telegram guruhga xabar yuboriladi (amoCRM'dagi lid linki bilan)
// Ikkalasidan biri ishlamasa ham ariza yo'qolmaydi: Telegram xabarida ogohlantirish chiqadi.
//
// Vercel → Settings → Environment Variables:
//   TELEGRAM_BOT_TOKEN   BotFather bergan token
//   TELEGRAM_CHAT_ID     guruh ID'si (-100... bilan boshlanadi)
//   TELEGRAM_THREAD_ID   (ixtiyoriy) guruh mavzusi (topic) ID'si
//   AMO_DOMAIN           masalan: isomedia.amocrm.ru
//   AMO_TOKEN            amoCRM'dagi integratsiyaning uzoq muddatli tokeni
//   AMO_PIPELINE_ID      (ixtiyoriy) voronka ID'si
//   AMO_STATUS_ID        (ixtiyoriy) lid tushadigan bosqich ID'si
//   AMO_RESPONSIBLE_ID   (ixtiyoriy) mas'ul menejer ID'si

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
const TYPES = ['Reels', 'Podkast', 'YouTube video', 'Boshqa'];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function fetchJson(url, opts, ms = 7000) {
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
async function sendToAmo(lead) {
  const domain = (process.env.AMO_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const token = process.env.AMO_TOKEN;
  if (!domain || !token) return { skipped: true };

  const base = `https://${domain}/api/v4`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const num = (v) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

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
    return { ok: false, status: r.status };
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

  return { ok: true, id: leadId, url: `https://${domain}/leads/detail/${leadId}` };
}

// ---------- Telegram ----------
async function sendToTelegram(lead, amo) {
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

  const utm = UTM_KEYS.filter((k) => lead.utm[k]).map((k) => `${k}: ${esc(lead.utm[k])}`);
  if (utm.length) lines.push('', '<b>Manba:</b>', ...utm);

  if (amo.ok) lines.push('', `🔗 <a href="${amo.url}">amoCRM'da ochish</a>`);
  else if (!amo.skipped) lines.push('', `⚠️ amoCRM'ga tushmadi (xato ${amo.status || 'tarmoq'}). Qo'lda kiriting.`);

  const r = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: /^\d+$/.test(process.env.TELEGRAM_THREAD_ID || '') ? Number(process.env.TELEGRAM_THREAD_ID) : undefined,
      text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  });
  if (!r.ok || !r.data || !r.data.ok) {
    console.error('Telegram xatosi:', r.status, JSON.stringify(r.data).slice(0, 400));
    return { ok: false };
  }
  return { ok: true };
}

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

  const lead = {
    name,
    phone: `+998${local}`,
    type,
    comment: clip(b.comment, 500),
    page: clip(b.page, 300),
    utm,
  };

  let amo;
  try { amo = await sendToAmo(lead); } catch (e) { console.error('amoCRM:', e); amo = { ok: false }; }
  let tg;
  try { tg = await sendToTelegram(lead, amo); } catch (e) { console.error('Telegram:', e); tg = { ok: false }; }

  if (amo.ok || tg.ok) return res.status(200).json({ ok: true });
  if (amo.skipped && tg.skipped) return res.status(500).json({ ok: false, error: 'Sozlanmagan' });
  return res.status(502).json({ ok: false, error: "Yuborib bo'lmadi" });
};
