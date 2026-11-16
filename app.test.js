const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const web = path.join(__dirname, "..", "web");

test("app script compiles", () => {
  const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  scripts.forEach(s => new vm.Script(s));
  assert.ok(html.includes('src="ribbon-firebase.js"'));
  assert.ok(html.includes("%%RIBBON_VERSION%%"), "version placeholder present");
});
test("service worker compiles and files exist", () => {
  new vm.Script(fs.readFileSync(path.join(web, "sw.js"), "utf8"));
  for (const f of ["manifest.webmanifest", "version.json", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/maskable-512.png", "ribbon-firebase.js"]) assert.ok(fs.existsSync(path.join(web, f)), f);
  JSON.parse(fs.readFileSync(path.join(web, "manifest.webmanifest"), "utf8"));
});
