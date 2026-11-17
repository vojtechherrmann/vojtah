// Logic of homepage/project/project.js (no DOM, no network) and the static properties of the generic
// project page: it must contain NO project content, the text comes from the API after sign-in.
// Run: node --test tests
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../homepage/project/project.js");

const res = (status, body = null) => ({ type: "response", status, body });

test("parseId: only plain slugs", () => {
  assert.equal(Logic.parseId("?id=example-1"), "example-1");
  assert.equal(Logic.parseId("?x=1&id=abc"), "abc");
  for (const bad of ["", "?", "?id=", "?id=-a", "?id=A", "?id=a/b", "?id=a b", "?id=<x>", "?id=" + "a".repeat(65)]) {
    assert.equal(Logic.parseId(bad), null, bad);
  }
  assert.equal(Logic.parseId(undefined), null);
});

test("classify: shown, hidden (401/403/404 look the same) and the two waiting states", () => {
  assert.equal(Logic.classify(res(200, {})), "ok");
  for (const s of [401, 403, 404]) assert.equal(Logic.classify(res(s, { error: "not_found" })), "hidden");
  assert.equal(Logic.classify(res(503, { error: "db_waking" })), "db_waking");
  assert.equal(Logic.classify({ type: "network" }), "cold");
  assert.equal(Logic.classify(res(503)), "cold");
  assert.equal(Logic.classify(res(502)), "cold");
  assert.equal(Logic.classify(res(500, { error: "server_error" })), "error");
  assert.equal(Logic.classify(undefined), "cold");
});

test("pageModel: the shape GET /sections/<id> returns, unknown badge = Private, unsafe links dropped", () => {
  const m = Logic.pageModel({ id: "x", title: "T", badge: "private", visibility: "restricted",
                              summary: "S", url: null, link_label: null });
  assert.deepEqual(m, { title: "T", badge: "private", badgeLabel: "Private", summary: "S", href: null, linkLabel: "Open" });
  assert.equal(Logic.pageModel({ title: "T", badge: "weird" }).badge, "private");
  assert.equal(Logic.pageModel({ title: "T", url: "javascript:alert(1)" }).href, null);
  assert.equal(Logic.pageModel({ title: "T", url: "https://example.test/a", link_label: "Go" }).linkLabel, "Go");
});

test("the project page is generic: no project text, CSP names only the API, no inline code", () => {
  const dir = path.join(__dirname, "..", "homepage", "project");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(dir, "project.js"), "utf8");
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html) && !html.includes("<style") && !html.includes(" style="));
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.ok(csp.includes("script-src 'self'") && csp.includes("connect-src 'self' https://api.vojtah.cz"));
  assert.ok(html.includes('id="project" hidden'));
  assert.ok(/name="robots" content="noindex"/.test(html));
  assert.ok(!js.includes("innerHTML") && !js.includes("eval(") && !js.includes("document.write"));
  assert.equal(js.split('credentials: "include"').length - 1, 1);
});
