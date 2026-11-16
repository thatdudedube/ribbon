const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const L = require("./lib");
const dns = require("node:dns").promises;

admin.initializeApp();
setGlobalOptions({ region: "europe-west2", maxInstances: 2, memory: "256MiB" });
const db = admin.firestore();
const allowed = () => L.parseAllowed(process.env.ALLOWED_EMAILS);

async function isMember(uid) { if (!uid) return null; const s = await db.doc("members/" + uid).get(); return s.exists ? s.data().name : null; }

/* Sends one notification to every phone of the named people, and tidies up dead tokens. */
async function notify(names, msg) {
  if (!names || !names.length) return;
  const snap = await db.collection("tokens").where("name", "in", names).get();
  const tokens = snap.docs.map(d => d.id);
  if (!tokens.length) return;
  const data = { title: msg.title, body: msg.body || "", url: msg.url || "./", tag: msg.tag || "" };
  const res = await admin.messaging().sendEachForMulticast({
    tokens, data,
    notification: { title: msg.title, body: msg.body || "" },
    webpush: { headers: { Urgency: "high", TTL: "86400" }, fcmOptions: { link: "https://thatdudedube.github.io/ribbon/" } }
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") dead.push(tokens[i]);
  });
  await Promise.all(dead.map(t => db.doc("tokens/" + t).delete()));
  logger.info("notify", { title: msg.title, to: names, sent: res.successCount, dead: dead.length });
}

/* Called right after someone signs in: links their account to their name if their email is on the list. */
exports.claimMember = onCall(async req => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const ref = db.doc("members/" + req.auth.uid);
  const s = await ref.get(); if (s.exists) return { name: s.data().name };
  const email = String(req.auth.token.email || "").toLowerCase();
  const name = allowed()[email];
  if (!name) throw new HttpsError("permission-denied", "This email isn't on the Ribbon list.");
  const old = await db.collection("members").where("name", "==", name).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));
  await ref.set({ name, email, at: new Date().toISOString() });
  return { name };
});

/* AI gift ideas. Keeps the Anthropic key on the server; 40 requests per person per day. */
exports.ai = onCall({ timeoutSeconds: 120 }, async req => {
  const name = await isMember(req.auth && req.auth.uid);
  if (!name) throw new HttpsError("permission-denied", "Members only.");
  const prompt = String((req.data && req.data.prompt) || "").slice(0, 20000);
  if (!prompt) throw new HttpsError("invalid-argument", "Empty prompt.");
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new HttpsError("failed-precondition", "AI isn't set up.");
  const day = new Date().toISOString().slice(0, 10);
  const uref = db.doc(`usage/${name}_${day}`);
  const n = await db.runTransaction(async tx => { const s = await tx.get(uref); const c = (s.exists ? s.data().count : 0) + 1; tx.set(uref, { count: c, name, day }); return c; });
  if (n > 40) throw new HttpsError("resource-exhausted", "Daily limit reached.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 2000, messages: [{ role: "user", content: prompt + (req.data.json ? "\n\nReply with the JSON only." : "") }] })
  });
  if (r.status === 429) throw new HttpsError("resource-exhausted", "Busy.");
  if (!r.ok) { logger.error("anthropic", r.status, await r.text()); throw new HttpsError("internal", "AI request failed."); }
  const j = await r.json();
  return { text: (j.content || []).filter(b => b.type === "text").map(b => b.text).join("") };
});

/* Reads a shop page so a pasted or shared link fills in the name, price and photo. */
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
async function safeFetch(url, hops = 0) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || L.isPrivateHost(u.hostname)) throw new HttpsError("invalid-argument", "That link can't be read.");
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(a => L.isPrivateIp(a.address))) throw new HttpsError("invalid-argument", "That link can't be read.");
  const r = await fetch(u.href, { redirect: "manual", signal: AbortSignal.timeout(9000), headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9" } });
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { if (hops >= 4) throw new HttpsError("unavailable", "Too many redirects."); return safeFetch(new URL(r.headers.get("location"), u).href, hops + 1); }
  return { r, finalUrl: u.href };
}
exports.linkPreview = onCall({ timeoutSeconds: 30 }, async req => {
  if (!(await isMember(req.auth && req.auth.uid))) throw new HttpsError("permission-denied", "Members only.");
  const url = String((req.data && req.data.url) || "").slice(0, 2000);
  let res; try { res = await safeFetch(url); } catch (e) { if (e instanceof HttpsError) throw e; throw new HttpsError("unavailable", "Couldn't reach that site."); }
  const { r, finalUrl } = res;
  if (!r.ok) throw new HttpsError("unavailable", "The site said no (" + r.status + ").");
  const reader = r.body.getReader(); let html = "", got = 0; const dec = new TextDecoder();
  while (got < 1500000) { const { done, value } = await reader.read(); if (done) break; got += value.length; html += dec.decode(value, { stream: true }); }
  try { reader.cancel(); } catch (e) {}
  return L.parseProduct(html, finalUrl);
});

/* Every morning at 9am London time: birthday and Christmas reminders. */
exports.daily = onSchedule({ schedule: "0 9 * * *", timeZone: "Europe/London" }, async () => {
  const ps = await db.collection("prefs").get(); const prefs = {}; ps.docs.forEach(d => { prefs[d.id] = d.data(); });
  const t = L.londonToday();
  const bought = await db.collection("items").where("status", "==", "bought").get();
  const msgs = L.dailyMessages(prefs, t).concat(L.givenReminders(bought.docs.map(d => d.data()), prefs, t));
  for (const m of msgs) await notify(m.to, m);
});

exports.onProposal = onDocumentCreated("proposals/{id}", async e => {
  const p = e.data && e.data.data(); if (!p || p.status !== "open") return;
  await notify(L.PEOPLE.filter(x => x !== p.by), { tag: "proposal", title: `${p.by} suggested a change`, body: "Budgets or splits. Open Ribbon to accept or adjust it.", url: "./#settings" });
});
exports.onProposalUpdate = onDocumentUpdated("proposals/{id}", async e => {
  const b = e.data.before.data(), a = e.data.after.data();
  if (b.status !== "applied" && a.status === "applied") await notify(L.PEOPLE.slice(), { tag: "proposal", title: "Everyone agreed ✅", body: `The new budgets and splits apply from ${a.fromYear}.` });
});
exports.onComment = onDocumentCreated("comments/{id}", async e => {
  const c = e.data && e.data.data(); if (!c) return;
  await notify(L.commentRecipients(c), { tag: "comment-" + c.itemId, title: `${c.by} commented on a gift for ${c.for}`, body: String(c.text || "").slice(0, 140) });
});
exports.onItemUpdate = onDocumentUpdated("items/{id}", async e => {
  for (const m of L.itemUpdateMessages(e.data.before.data() || {}, e.data.after.data() || {})) await notify(m.to, m);
});
exports.onPayment = onDocumentCreated("payments/{id}", async e => {
  const p = e.data && e.data.data(); if (!p || !L.PEOPLE.includes(p.to)) return;
  await notify([p.to], { tag: "payment", title: `${p.from} paid you £${Number(p.amount || 0).toFixed(2)}`, body: p.note ? String(p.note).slice(0, 120) : "It's recorded in Ribbon under Money." });
});
