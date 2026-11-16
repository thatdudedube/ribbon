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
      if (PEOPLE.includes(r)) msgs.push({ to: [r], tag: `bday-${r}-me`, title: `Happy birthday, ${r}! 🎉`, body: "Any birthday gifts are now showing in Ribbon. Give them a rating when you can." });
    }
  }
  const xmas = daysUntil(12, 25, t);
  if (xmas === 30 || xmas === 7) msgs.push({ to: PEOPLE.slice(), tag: `xmas-${xmas}`, title: xmas === 7 ? "One week to Christmas" : "One month to Christmas", body: "See what's still unclaimed in Ribbon." });
  if (xmas === 0) msgs.push({ to: PEOPLE.slice(), tag: "xmas-0", title: "Merry Christmas! 🎄", body: "Your gifts are revealed in Ribbon. Rate them and send a thank-you." });
  return msgs;
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

module.exports = { PEOPLE, RECIPS, parseAllowed, londonToday, daysUntil, dailyMessages, commentRecipients, itemUpdateMessages };
