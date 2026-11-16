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

test("buyer is nudged to mark as given 1, 3 and 7 days after the day", () => {
  const prefs = { Chioma: { birthday: "04-03" } };
  const items = [
    { title: "Scarf", for: "Chioma", status: "bought", paidBy: "Emeka", occasion: "birthday", year: 2026 },
    { title: "Book", for: "Mum", status: "bought", paidBy: "Dube", occasion: "christmas", year: 2026 },
    { title: "Done", for: "Mum", status: "bought", paidBy: "Dube", occasion: "christmas", year: 2026, given: true }
  ];
  assert.deepStrictEqual(L.givenReminders(items, prefs, { y: 2026, m: 4, d: 4 }).map(x => x.to), [["Emeka"]]);
  assert.strictEqual(L.givenReminders(items, prefs, { y: 2026, m: 4, d: 5 }).length, 0);
  assert.deepStrictEqual(L.givenReminders(items, prefs, { y: 2027, m: 1, d: 1 }).map(x => x.title), ["Has Book been given?"]);
  assert.strictEqual(L.givenReminders(items, prefs, { y: 2026, m: 12, d: 25 }).length, 0);
});

test("reads name, price and photo from a product page", () => {
  const og = `<html><head><meta property="og:title" content="Glide Soles &amp; Co"><meta property="og:image" content="/img/a.jpg"><meta property="product:price:amount" content="34.99"><meta property="product:price:currency" content="GBP"></head></html>`;
  assert.deepStrictEqual(L.parseProduct(og, "https://glidesoles.com/p/x"), { title: "Glide Soles & Co", price: 34.99, image: "https://glidesoles.com/img/a.jpg" });
  const ld = `<title>Shop</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"MX Keys S","image":["https://x.com/k.png"],"offers":{"@type":"Offer","price":"109.99","priceCurrency":"GBP"}}]}</script>`;
  assert.deepStrictEqual(L.parseProduct(ld, "https://x.com/"), { title: "MX Keys S", price: 109.99, image: "https://x.com/k.png" });
  const amz = `<title>Amazon.co.uk : Anker Charger</title><span id="productTitle" class="a">  Anker Wireless Charger  </span><span class="a-offscreen">£1,019.00</span><img id="landingImage" data-old-hires="https://m.media-amazon.com/i.jpg">`;
  assert.deepStrictEqual(L.parseProduct(amz, "https://www.amazon.co.uk/dp/1"), { title: "Anker Wireless Charger", price: 1019, image: "https://m.media-amazon.com/i.jpg" });
  const usd = `<meta property="og:title" content="Thing"><meta property="og:price:amount" content="20"><meta property="og:price:currency" content="USD">`;
  assert.strictEqual(L.parseProduct(usd, "https://a.com").price, null);
});
test("never fetches private addresses", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.2", "169.254.169.254", "metadata.google.internal", "192.168.1.1", "[::1]", "172.20.0.1"]) assert.ok(L.isPrivateHost(h), h);
  for (const h of ["www.amazon.co.uk", "8.8.8.8", "lakeland.co.uk"]) assert.ok(!L.isPrivateHost(h), h);
});
test("shared text becomes a link and a name", () => {
  assert.deepStrictEqual(L.cleanShare("", "Anker Wireless Charger https://amzn.eu/d/abc", ""), { link: "https://amzn.eu/d/abc", title: "Anker Wireless Charger" });
  assert.deepStrictEqual(L.cleanShare("Toastie maker", "", "https://lakeland.co.uk/t"), { link: "https://lakeland.co.uk/t", title: "Toastie maker" });
});
