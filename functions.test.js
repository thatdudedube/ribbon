const test = require("node:test");
const assert = require("node:assert");
const L = require("../functions/lib");

test("allow-list parsing", () => {
  const m = L.parseAllowed(" A@x.com:dube, b@y.co.uk:Emeka;c@z.com:CHIOMA, bad, d@q.com:Mum ");
  assert.deepStrictEqual(m, { "a@x.com": "Dube", "b@y.co.uk": "Emeka", "c@z.com": "Chioma" });
});
test("days until a birthday wraps into next year", () => {
  assert.strictEqual(L.daysUntil(11, 26, { y: 2026, m: 11, d: 16 }), 10);
  assert.strictEqual(L.daysUntil(4, 3, { y: 2026, m: 11, d: 16 }), 138);
  assert.strictEqual(L.daysUntil(11, 16, { y: 2026, m: 11, d: 16 }), 0);
});
test("birthday reminders 30 and 7 days before, never to the birthday person", () => {
  const prefs = { Dube: { birthday: "11-26" }, Mum: { birthday: "06-26" } };
  const m30 = L.dailyMessages(prefs, { y: 2026, m: 10, d: 27 });
  assert.deepStrictEqual(m30.map(x => [x.title, x.to]), [["Dube's birthday is in 30 days", ["Emeka", "Chioma"]]]);
  const m7 = L.dailyMessages(prefs, { y: 2026, m: 11, d: 19 });
  assert.strictEqual(m7[0].title, "Dube's birthday is in 7 days");
  const m0 = L.dailyMessages(prefs, { y: 2026, m: 11, d: 26 });
  assert.deepStrictEqual(m0.map(x => x.to), [["Emeka", "Chioma"], ["Dube"]]);
  const mum = L.dailyMessages(prefs, { y: 2026, m: 6, d: 26 });
  assert.deepStrictEqual(mum.map(x => x.to), [["Emeka", "Dube", "Chioma"]]);
});
test("Christmas reminders", () => {
  assert.strictEqual(L.dailyMessages({}, { y: 2026, m: 11, d: 25 })[0].title, "One month to Christmas");
  assert.strictEqual(L.dailyMessages({}, { y: 2026, m: 12, d: 18 })[0].title, "One week to Christmas");
  assert.match(L.dailyMessages({}, { y: 2026, m: 12, d: 25 })[0].title, /Merry Christmas/);
  assert.strictEqual(L.dailyMessages({}, { y: 2026, m: 12, d: 10 }).length, 0);
});
test("comments never reach the person the gift is for", () => {
  assert.deepStrictEqual(L.commentRecipients({ by: "Dube", for: "Chioma" }), ["Emeka"]);
  assert.deepStrictEqual(L.commentRecipients({ by: "Dube", for: "Mum" }), ["Emeka", "Chioma"]);
});
test("item updates: thanks, given, rating", () => {
  const given = L.itemUpdateMessages({ given: false }, { given: true, for: "Chioma", title: "Scarf" });
  assert.deepStrictEqual(given[0].to, ["Chioma"]);
  assert.strictEqual(L.itemUpdateMessages({ given: false }, { given: true, for: "Mum" }).length, 0);
  const th = L.itemUpdateMessages({}, { title: "Scarf", thanks: { by: "Chioma", text: "Love it" } });
  assert.deepStrictEqual(th[0].to, ["Emeka", "Dube"]);
  const rt = L.itemUpdateMessages({}, { title: "Scarf", paidBy: "Emeka", rating: { by: "Chioma", stars: 5 } });
  assert.deepStrictEqual(rt[0].to, ["Emeka"]);
});
