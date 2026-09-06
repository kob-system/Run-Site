// Generates the demo receipt photos used by SEED-DEMO-ACCOUNT.sql.
//
// They have to be served from our OWN origin: vercel.json sets
//   img-src 'self' data: blob: https://*.supabase.co
// so a hotlinked receipt from anywhere else renders as a broken image on
// camera. These land in public/demo/receipts/ and ship with the build, and
// receipts.photo_url stores the absolute https URL (PhotoViewer uses a full
// URL directly and only signs a storage path when it isn't one).
//
//   node scripts/gen-demo-receipts.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo', 'receipts')
fs.mkdirSync(OUT, { recursive: true })

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function receipt({ file, store, addr, phone, items, tax, date, time, tender, reg }) {
  const sub = items.reduce((s, i) => s + i.amt, 0)
  const total = sub + tax
  const PW = 460
  let y = 250
  const L = []
  const rule = ny => `<line x1="60" y1="${ny}" x2="${60 + PW - 40}" y2="${ny}" class="dash"/>`
  for (const it of items) {
    L.push(`<text x="60" y="${y}" class="m">${esc(it.d)}</text>`)
    L.push(`<text x="${60 + PW - 40}" y="${y}" class="m r">${money(it.amt)}</text>`)
    if (it.q) { y += 22; L.push(`<text x="76" y="${y}" class="s">${esc(it.q)}</text>`) }
    y += 30
  }
  y += 6; L.push(rule(y)); y += 30
  const pair = (l, v, cls = 'm') => {
    L.push(`<text x="60" y="${y}" class="${cls}">${esc(l)}</text>`)
    L.push(`<text x="${60 + PW - 40}" y="${y}" class="${cls} r">${v}</text>`)
    y += 28
  }
  pair('SUBTOTAL', money(sub))
  pair('TAX', money(tax))
  y += 4; L.push(rule(y - 14)); y += 6
  pair('TOTAL', money(total), 'b')
  y += 8
  pair(tender, money(total), 's')
  y += 6
  L.push(`<text x="60" y="${y}" class="s">AUTH 0${reg}41   APPROVED</text>`); y += 40
  const mid = 60 + (PW - 40) / 2
  L.push(`<text x="${mid}" y="${y}" class="s" text-anchor="middle">*** THANK YOU ***</text>`); y += 26
  L.push(`<text x="${mid}" y="${y}" class="s" text-anchor="middle">KEEP FOR YOUR RECORDS</text>`); y += 44

  const PH = y, H = PH + 130, W = 620
  let tear = `M52,${PH - 20}`
  for (let x = 52; x <= 52 + PW + 16; x += 18) tear += ` L${x},${PH - 20 + ((x / 18 | 0) % 2 ? 10 : 0)}`
  tear += ` L${52 + PW + 16},${PH + 2} L52,${PH + 2} Z`

  fs.writeFileSync(path.join(OUT, file), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(store)} receipt, ${money(total)}">
<defs>
  <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfb"/><stop offset="1" stop-color="#f1f0ea"/></linearGradient>
  <filter id="sh" x="-25%" y="-25%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.34"/></filter>
</defs>
<style>
  .m{font:600 19px ui-monospace,Menlo,Consolas,monospace;fill:#2a2a28}
  .s{font:500 15px ui-monospace,Menlo,Consolas,monospace;fill:#6b6b66}
  .b{font:800 24px ui-monospace,Menlo,Consolas,monospace;fill:#151514}
  .h{font:800 30px ui-monospace,Menlo,Consolas,monospace;fill:#151514;letter-spacing:1px}
  .r{text-anchor:end}
  .dash{stroke:#c9c7c0;stroke-width:2;stroke-dasharray:5 5}
</style>
<rect width="${W}" height="${H}" fill="#31353b"/>
<g transform="rotate(-1.2 ${W / 2} ${H / 2}) translate(22 40)" filter="url(#sh)">
  <rect x="52" y="0" width="${PW + 16}" height="${PH}" rx="3" fill="url(#p)"/>
  <path d="${tear}" fill="#31353b"/>
  <text x="${mid}" y="66" class="h" text-anchor="middle">${esc(store)}</text>
  <text x="${mid}" y="96" class="s" text-anchor="middle">${esc(addr)}</text>
  <text x="${mid}" y="120" class="s" text-anchor="middle">${esc(phone)}</text>
  ${rule(150)}
  <text x="60" y="182" class="s">${esc(date)}  ${esc(time)}</text>
  <text x="${60 + PW - 40}" y="182" class="s r">REG ${reg}</text>
  <text x="60" y="208" class="s">CAPITAL RIDGE CONTRACTING</text>
  ${rule(226)}
  ${L.join('\n  ')}
</g>
</svg>`)
  return `${file}  ${money(total)}`
}

const V = 'VISA ****4417'

// The numbers are not arbitrary. `receipts.amount` is the PRE-TAX subtotal and
// the app books cost = amount + tax_amount (see fetchSpend), so these are
// balanced backwards from the percentages the video needs on screen:
//   Miller Road deck  materials  5,330.00 / 6,500 = 82.0%  → amber warning
//   Fielding Ave bath materials  2,979.20 / 3,200 = 93.1%  → amber warning
// Tax is Albany County's 8%. Change a line item and you change the bar.
const out = [
  receipt({ file: 'curtis-lumber-framing.svg', store: 'CURTIS LUMBER', addr: '885 Loudon Rd, Latham NY', phone: '(518) 555-0119', date: '08/31/26', time: '07:14', reg: '03', tender: V, tax: 211.03,
    items: [{ d: 'PT 2x8-16 JOIST', q: '48 @ 27.40', amt: 1315.20 }, { d: 'PT 2x10-16 LEDGER', q: '6 @ 41.85', amt: 251.10 }, { d: '5/4 DECKING 16FT', q: '52 @ 18.90', amt: 982.80 }, { d: 'DELIVERY - JOBSITE', amt: 88.77 }] }),
  receipt({ file: 'home-depot-hardware.svg', store: 'THE HOME DEPOT', addr: '161 Washington Ave Ext, Albany NY', phone: '(518) 555-0164', date: '09/02/26', time: '06:41', reg: '11', tender: V, tax: 119.55,
    items: [{ d: 'SIMPSON LUS28 HANGER', q: '96 @ 2.18', amt: 209.28 }, { d: 'STRUCT SCREW 5LB', q: '8 @ 62.40', amt: 499.20 }, { d: 'FLASHING TAPE 4IN', q: '9 @ 31.75', amt: 285.75 }, { d: 'GRK LEDGERLOK 250CT', amt: 500.09 }] }),
  receipt({ file: 'curtis-lumber-railing.svg', store: 'CURTIS LUMBER', addr: '885 Loudon Rd, Latham NY', phone: '(518) 555-0119', date: '09/04/26', time: '07:02', reg: '03', tender: V, tax: 64.23,
    items: [{ d: 'RAILING POST 4x4', q: '11 @ 24.15', amt: 265.65 }, { d: 'BALUSTER SQ 32IN', q: '84 @ 4.55', amt: 382.20 }, { d: 'TOP CAP 2x6-12', amt: 155.15 }] }),
  receipt({ file: 'ferguson-vanity.svg', store: 'FERGUSON', addr: '20 Corporate Cir, Albany NY', phone: '(518) 555-0133', date: '08/16/26', time: '09:26', reg: '02', tender: V, tax: 147.76,
    items: [{ d: '48IN VANITY + TOP', amt: 1189.00 }, { d: 'SHOWER VALVE ROUGH', amt: 384.40 }, { d: 'TRIM KIT BRUSHED NKL', amt: 273.60 }] }),
  receipt({ file: 'home-depot-tile.svg', store: 'THE HOME DEPOT', addr: '161 Washington Ave Ext, Albany NY', phone: '(518) 555-0164', date: '08/20/26', time: '15:52', reg: '07', tender: V, tax: 72.92,
    items: [{ d: 'PORCELAIN TILE 12x24', q: '140 SF @ 4.28', amt: 599.20 }, { d: 'CEMENT BOARD 3x5', q: '14 @ 15.98', amt: 223.72 }, { d: 'THINSET 50LB', q: '4 @ 18.20', amt: 72.80 }, { d: 'GROUT + SEALER', amt: 15.80 }] }),
  receipt({ file: 'stewarts-fuel.svg', store: "STEWART'S SHOPS", addr: '424 Broadway, Menands NY', phone: '(518) 555-0107', date: '09/03/26', time: '06:18', reg: '01', tender: V, tax: 0,
    items: [{ d: 'UNLEADED PUMP 4', q: '26.9 GAL @ 3.089', amt: 83.09 }, { d: 'DEF 2.5 GAL', amt: 13.11 }] }),
]
console.log(out.join(String.fromCharCode(10)))
