# ISOMEDIA — landing sayt

Video production studiya uchun targeting landingi (desktop + mobil). Vercel'da ishlaydi.

## Ariza oqimi
```
Forma ──► /api/lead ──┬─► amoCRM (lid + kontakt + izoh)
   │                  ├─► Meta CAPI (server Lead, event_id bilan)
   │                  ├─► Google Sheets (arxiv + qayta urinish navbati)
   │                  └─► Telegram (xabar + ogohlantirishlar)
   └─► Meta Pixel (brauzer Lead, xuddi shu event_id → dublsiz)

Sheets (Apps Script, har 10 daqiqada) ──► amoCRM'ga tushmaganlarni qayta yuboradi (3 urinish)
```
Bittasi ishlamasa ham qolganlari ishlaydi. Sheets'da har lid uchun `event_id`, `fbp`, `fbc`, IP va
User agent saqlanadi — keyin amoCRM'dagi "Sifatli lid" / "Sotildi" statuslarini CAPI'ga yuborishda kerak bo'ladi.

## Fayllar
- `index.html` — sahifa (stil va skript ichida)
- `assets/` — logotiplar (WebP)
- `api/lead.js` — ariza funksiyasi
- `apps-script/Code.gs` — Google Sheets uchun Apps Script (saytga chiqmaydi)

## Vercel → Settings → Environment Variables
| O'zgaruvchi | Qiymat |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_CHAT_ID` | guruh ID'si (`-100...`) |
| `TELEGRAM_THREAD_ID` | (ixtiyoriy) guruh mavzusi (topic) ID'si |
| `AMO_DOMAIN` | masalan `isomedia.amocrm.ru` |
| `AMO_TOKEN` | amoCRM integratsiyasining uzoq muddatli tokeni |
| `AMO_PIPELINE_ID`, `AMO_STATUS_ID`, `AMO_RESPONSIBLE_ID` | (ixtiyoriy) voronka, bosqich, mas'ul |
| `META_PIXEL_ID` | Pixel (dataset) ID |
| `META_CAPI_TOKEN` | Events Manager → Settings → Conversions API → Generate access token |
| `META_TEST_EVENT_CODE` | (faqat sinovda) Test Events kodi, `TEST12345` kabi; sinovdan keyin o'chiring |
| `SHEETS_WEBHOOK_URL` | Apps Script Web App `/exec` linki |
| `SHEETS_SECRET` | uzun tasodifiy matn; Apps Script'dagi `SECRET` bilan bir xil |

O'zgaruvchilarni qo'shgandan keyin: Deployments → ⋯ → Redeploy.

## Meta Pixel (brauzer)
Pixel kodi `index.html` ning `<head>` qismida (ID 1717612296593134). Kodda faqat PageView bor, Lead Events Manager'da sozlanadi.

## Google Sheets
`apps-script/Code.gs` boshidagi izohda o'rnatish bosqichlari bor.

## Reklama linklari
UTM qo'shing: `https://isomedia.uz/?utm_source=fb&utm_campaign=...` — UTM amoCRM, Sheets va Telegram'ga tushadi.
