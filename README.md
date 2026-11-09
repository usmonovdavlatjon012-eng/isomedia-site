# ISOMEDIA — landing sayt

Video production studiya uchun targeting landingi (desktop + mobil). Vercel'da ishlaydi.

## Fayllar
- `index.html` — sahifa (stil va skript ichida)
- `assets/` — logotip va mijozlar logotiplari (WebP)
- `api/lead.js` — ariza funksiyasi: amoCRM'ga lid + Telegram'ga xabar
- `favicon.png`

## Vercel → Settings → Environment Variables
| O'zgaruvchi | Qiymat |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_CHAT_ID` | guruh ID'si (`-100...`) |
| `AMO_DOMAIN` | masalan `isomedia.amocrm.ru` |
| `AMO_TOKEN` | amoCRM integratsiyasining uzoq muddatli tokeni |
| `AMO_PIPELINE_ID` | (ixtiyoriy) voronka ID'si |
| `AMO_STATUS_ID` | (ixtiyoriy) bosqich ID'si |
| `AMO_RESPONSIBLE_ID` | (ixtiyoriy) mas'ul menejer ID'si |

O'zgaruvchilarni qo'shgandan keyin saytni qayta deploy qiling (Deployments → ⋯ → Redeploy).

## Meta Pixel
`index.html` boshidagi `window.PIXEL_ID=''` ga Pixel ID'ni yozing. PageView va Lead (eventID bilan, CAPI uchun tayyor) avtomatik ishlaydi.

## Reklama linklari
UTM qo'shing: `https://isomedia.uz/?utm_source=fb&utm_campaign=...` — UTM amoCRM izohiga va Telegram xabariga tushadi.
