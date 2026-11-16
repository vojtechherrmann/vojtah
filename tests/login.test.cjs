// Pure logic of homepage/login.js (no DOM, no network). Run: node --test tests
const test = require("node:test");
const assert = require("node:assert/strict");
const Logic = require("../homepage/login.js");

const res = (status, body = null) => ({ type: "response", status, body });

test("classify: success, errors and the two waiting states", () => {
  assert.equal(Logic.classify(res(200, {})), "ok");
  assert.equal(Logic.classify(res(204)), "ok");
  assert.equal(Logic.classify(res(401, { error: "invalid_credentials" })), "invalid");
  assert.equal(Logic.classify(res(429, { error: "rate_limited" })), "limited");
  assert.equal(Logic.classify(res(403, { error: "origin" })), "forbidden");
  assert.equal(Logic.classify(res(400, { error: "bad_request" })), "error");
  assert.equal(Logic.classify(res(500, { error: "server_error" })), "error");
  // database waking: the API answers, with the machine-readable code
  assert.equal(Logic.classify(res(503, { error: "db_waking" })), "db_waking");
  // container cold-starting: nothing answers, or the ingress answers without the app's JSON
  assert.equal(Logic.classify({ type: "network" }), "cold");
  assert.equal(Logic.classify(res(503)), "cold");
  assert.equal(Logic.classify(res(503, { error: "something_else" })), "cold");
  assert.equal(Logic.classify(res(502)), "cold");
  assert.equal(Logic.classify(res(504)), "cold");
  assert.equal(Logic.classify(undefined), "cold");
});

test("plan: only the waiting states keep waiting", () => {
  assert.equal(Logic.plan("ok"), "done");
  assert.equal(Logic.plan("cold"), "retry_cold");
  assert.equal(Logic.plan("db_waking"), "wait_db");
  for (const kind of ["invalid", "limited", "forbidden", "error", "unavailable"]) {
    assert.equal(Logic.plan(kind), "fail", kind);
  }
});

test("the two waiting states have different, visible messages", () => {
  assert.match(Logic.messageFor("db_waking"), /database is waking up.*up to a minute/);
  assert.match(Logic.messageFor("cold"), /starting up.*30/);
  assert.notEqual(Logic.messageFor("cold"), Logic.messageFor("db_waking"));
  assert.equal(Logic.messageFor("nope"), Logic.MESSAGES.error);
  assert.match(Logic.messageFor("invalid"), /Wrong username or password/);
});

test("safeUrl: only https and mailto become links", () => {
  assert.equal(Logic.safeUrl("https://example.test/a"), "https://example.test/a");
  assert.equal(Logic.safeUrl("mailto:someone@example.test"), "mailto:someone@example.test");
  for (const bad of ["javascript:alert(1)", "http://example.test", "data:text/html,x", "//x.test", "", null, undefined, 5, "not a url"]) {
    assert.equal(Logic.safeUrl(bad), null, String(bad));
  }
});

test("cardModel: whitelists the badge, never trusts HTML, defaults the link label", () => {
  const m = Logic.cardModel({ id: "p", title: "<b>x</b>", badge: "request", summary: "s", url: "https://e.test/", link_label: "Go" });
  assert.deepEqual(m, { id: "p", title: "<b>x</b>", badge: "request", badgeLabel: "On request", summary: "s", href: "https://e.test/", linkLabel: "Go" });
  const odd = Logic.cardModel({ id: "q", title: "t", badge: "constructor", url: "javascript:1" });
  assert.equal(odd.badge, "private");
  assert.equal(odd.badgeLabel, "Private");
  assert.equal(odd.href, null);
  assert.equal(odd.linkLabel, "Open");
  assert.equal(odd.summary, "");
  assert.equal(Logic.cardModel(null).title, "");
});

test("expired: patience of 150 s overall", () => {
  assert.equal(Logic.expired(0, 149000), false);
  assert.equal(Logic.expired(0, 151000), true);
});
