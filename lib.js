/* Pure helpers for the Ribbon functions (no Firebase imports, so they can be unit tested). */
const PEOPLE = ["Emeka", "Dube", "Chioma"];
const RECIPS = ["Emeka", "Dube", "Chioma", "Mum", "Dad"];

/* "a@x.com:Dube, b@y.com:Emeka" -> { "a@x.com": "Dube", ... } */
function parseAllowed(s) {
  const out = {};
  String(s || "").split(/[,;\n]+/).forEach(part => {
    const i = part.lastIndexOf(":"); if (i < 0) return;
    const email = part.slice(0, i).trim().toLowerCase();
    const raw = part.slice(i + 1).trim().toLowerCase();
    const name = PEOPLE.find(p => p.toLowerCase() === raw);
    if (email && name) out[email] = name;
  });
  return out;
}

/* Today's date in London as {y, m, d}. */
function londonToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = t => Number(parts.find(p => p.type === t).value);
  return { y: g("year"), m: g("month"), d: g("day") };
}
function daysUntil(mm, dd, t) {
  const today = Date.UTC(t.y, t.m - 1, t.d);
  let next = Date.UTC(t.y, mm - 1, dd); if (next < today) next = Date.UTC(t.y + 1, mm - 1, dd);
  return Math.round((next - today) / 864e5);
}
const others = r => PEOPLE.filter(p => p !== r);

/* Which reminders go out today. prefs: { Emeka: { birthday: "09-14" }, ... } */
function dailyMessages(prefs, t) {
  const msgs = [];
  for (const r of RECIPS) {
    const b = (prefs[r] || {}).birthday; if (!/^\d{2}-\d{2}$/.test(b || "")) continue;
    const [mm, dd] = b.split("-").map(Number);
    const n = daysUntil(mm, dd, t);
    if (n === 30 || n === 7) msgs.push({ to: others(r), tag: `bday-${r}-${n}`, title: `${r}'s birthday is in ${n} days`, body: n === 7 ? "One week to go. Check the list and claim something." : "Plenty of time. Have a look at the list in Ribbon." });
    if (n === 0) {
      msgs.push({ to: others(r), tag: `bday-${r}-0`, title: `It's ${r}'s birthday today 🎂`, body: "Don't forget to say happy birthday." });
      if (PEOPLE.includes(r)) msgs.push({ to: [r], tag: `bday-${r}-me`, title: `Happy birthday, ${r}! 🎉`, body: "Have a great day." });
    }
  }
  const xmas = daysUntil(12, 25, t);
  if (xmas === 30 || xmas === 7) msgs.push({ to: PEOPLE.slice(), tag: `xmas-${xmas}`, title: xmas === 7 ? "One week to Christmas" : "One month to Christmas", body: "See what's still unclaimed in Ribbon." });
  if (xmas === 0) msgs.push({ to: PEOPLE.slice(), tag: "xmas-0", title: "Merry Christmas! 🎄", body: "Once you've handed your gifts over, mark them as given in Ribbon." });
  return msgs;
}

/* Nudges the buyer to mark a gift as given: 1, 3 and 7 days after its birthday or Christmas Day. */
function givenReminders(items, prefs, t) {
  const today = Date.UTC(t.y, t.m - 1, t.d), out = [];
  for (const i of items) {
    if (i.status !== "bought" || i.given) continue;
    const buyer = i.paidBy || i.claimedBy; if (!PEOPLE.includes(buyer)) continue;
    let mm = 12, dd = 25;
    if (i.occasion === "birthday") { const b = (prefs[i.for] || {}).birthday; if (!/^\d{2}-\d{2}$/.test(b || "")) continue; [mm, dd] = b.split("-").map(Number); }
    const since = Math.round((today - Date.UTC(Number(i.year), mm - 1, dd)) / 864e5);
    if ([1, 3, 7].includes(since)) out.push({ to: [buyer], tag: "given-" + i.title, title: `Has ${i.title} been given?`, body: `Mark it as given in Ribbon so ${i.for} can ${PEOPLE.includes(i.for) ? "see and rate it" : "have it in their history"}.` });
  }
  return out;
}

/* Who hears about a new comment: everyone except the writer and the person the gift is for (it's a surprise). */
function commentRecipients(c) { return PEOPLE.filter(p => p !== c.by && p !== c.for); }

function itemUpdateMessages(before, after) {
  const msgs = [];
  if (!before.thanks && after.thanks && after.thanks.by) {
    msgs.push({ to: PEOPLE.filter(p => p !== after.thanks.by), tag: "thanks-" + after.title, title: `${after.thanks.by} said thank you`, body: `For ${after.title || "their gift"}: ${String(after.thanks.text || "").slice(0, 120)}` });
  }
  if (!before.given && after.given && PEOPLE.includes(after.for)) {
    msgs.push({ to: [after.for], tag: "given", title: "You've got a gift to see 🎁", body: "Open Ribbon to see it and give it a rating." });
  }
  if (!before.rating && after.rating && after.rating.by) {
    const giver = after.paidBy || after.claimedBy;
    const to = PEOPLE.filter(p => p !== after.rating.by && (!giver || p === giver));
    if (to.length) msgs.push({ to, tag: "rating", title: `${after.rating.by} rated ${after.title || "a gift"}`, body: `${"★".repeat(Number(after.rating.stars) || 0)}${after.rating.comment ? " " + String(after.rating.comment).slice(0, 100) : ""}` });
  }
  return msgs;
}


/* ---------- link preview: read a product page's name, price and photo ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", "#39": "'" };
function decode(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
    return ENT[k] !== undefined ? ENT[k] : m;
  }).replace(/\s+/g, " ").trim();
}
function attrs(tag) { const o = {}; tag.replace(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (m, k, v, a, b, c) => { o[k.toLowerCase()] = a !== undefined ? a : b !== undefined ? b : c; }); return o; }
function toPrice(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,(?=\d{3}\b)/g, "").replace(/[^0-9.]/g, "");
  const n = parseFloat(s); return isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}
function absUrl(u, base) { try { const x = new URL(decode(u), base); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch (e) { return ""; } }
function findProduct(node, out) {
  if (!node || typeof node !== "object" || out.found) return;
  if (Array.isArray(node)) { node.forEach(n => findProduct(n, out)); return; }
  const t = [].concat(node["@type"] || []).map(String);
  if (t.some(x => /product/i.test(x))) { out.found = node; return; }
  if (node["@graph"]) findProduct(node["@graph"], out);
}
function parseProduct(html, baseUrl) {
  html = String(html || "");
  const meta = {};
  (html.match(/<meta\b[^>]*>/gi) || []).forEach(tag => { const a = attrs(tag); const k = (a.property || a.name || a.itemprop || "").toLowerCase(); if (k && a.content !== undefined && meta[k] === undefined) meta[k] = a.content; });
  let title = meta["og:title"] || meta["twitter:title"] || "";
  let image = meta["og:image"] || meta["og:image:secure_url"] || meta["twitter:image"] || meta["image"] || "";
  let price = toPrice(meta["product:price:amount"] || meta["og:price:amount"] || meta["price"]);
  let currency = (meta["product:price:currency"] || meta["og:price:currency"] || meta["pricecurrency"] || "").toUpperCase();
  (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).forEach(s => {
    try {
      const j = JSON.parse(s.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim());
      const out = {}; findProduct(j, out); const p = out.found; if (!p) return;
      if (!title && p.name) title = p.name;
      if (!image && p.image) { const im = [].concat(p.image)[0]; image = typeof im === "string" ? im : (im && (im.url || im.contentUrl)) || ""; }
      if (price === null && p.offers) {
        const o = [].concat(p.offers)[0] || {};
        price = toPrice(o.price !== undefined ? o.price : o.lowPrice !== undefined ? o.lowPrice : (o.priceSpecification || {}).price);
        if (!currency) currency = String(o.priceCurrency || (o.priceSpecification || {}).priceCurrency || "").toUpperCase();
      }
    } catch (e) { /* skip bad JSON */ }
  });
  if (!title) { const m = html.match(/id="productTitle"[^>]*>([\s\S]*?)</i); if (m) title = m[1]; }
  if (price === null) { const m = html.match(/class="a-offscreen">\s*£\s*([0-9.,]+)/i); if (m) { price = toPrice(m[1]); currency = currency || "GBP"; } }
  if (!image) { const m = html.match(/id="landingImage"[^>]*(?:data-old-hires|src)="([^"]+)"/i); if (m) image = m[1]; }
  if (!title) { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) title = m[1]; }
  title = decode(title).replace(/\s*[:|–-]\s*Amazon\.co\.uk.*$/i, "").replace(/^Amazon\.co\.uk\s*:\s*/i, "").slice(0, 140).trim();
  if (currency && currency !== "GBP") price = null;
  return { title, price, image: image ? absUrl(image, baseUrl) : "" };
}

/* Only fetch ordinary public web pages. */
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h === "metadata") return true;
  return isPrivateIp(h);
}
function isPrivateIp(ip) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { const [a, b] = [Number(v4[1]), Number(v4[2])]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  if (ip.includes(":")) return ip === "::1" || ip === "::" || /^f[cd]/.test(ip) || /^fe80/.test(ip) || /^::ffff:/.test(ip);
  return false;
}
function cleanShare(title, text, url) {
  const all = [url, text, title].filter(Boolean).join(" ");
  const m = all.match(/https?:\/\/[^\s<>"']+/i); const link = m ? m[0].replace(/[).,]+$/, "") : "";
  let t = (title || "").trim(); const rest = String(text || "").replace(link, "").trim();
  if (!t || /^https?:/i.test(t)) t = rest;
  return { link, title: t.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 140) };
}

module.exports = { parseProduct, isPrivateHost, isPrivateIp, cleanShare, PEOPLE, RECIPS, parseAllowed, londonToday, daysUntil, dailyMessages, givenReminders, commentRecipients, itemUpdateMessages };
