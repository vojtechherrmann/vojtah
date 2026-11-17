// Logic of homepage/script.js: when may a click on the InBody card open the app, and the single
// sign-on hop through the app's /sso. Run: node --test tests/*.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../homepage/script.js");

const res = (status, body = null) => ({ type: "response", status, body });

test("open when the container answers and the database is warm or not needed", () => {
  assert.equal(Logic.classify(res(200, { warm: true, session: true })), "go");
  assert.equal(Logic.classify(res(200, { warm: false, session: false })), "go");   // anonymous: no DB needed
  assert.equal(Logic.classify(res(200, { warm: true, session: false })), "go");
  assert.equal(Logic.classify(res(200, { warm: false, session: true })), "db");    // would see "Starting the database"
  assert.equal(Logic.classify(res(200, { warm: false })), "db");                   // unknown session: wait to be safe
});

test("signed in here (single sign-on follows): the database must be warm", () => {
  assert.equal(Logic.classify(res(200, { warm: false, session: false }), true), "db");
  assert.equal(Logic.classify(res(200, { warm: true, session: false }), true), "go");
  assert.equal(Logic.classify({ type: "network" }, true), "cold");
});

test("no answer or a 5xx = the container is starting; any other answer = open", () => {
  assert.equal(Logic.classify({ type: "network" }), "cold");
  assert.equal(Logic.classify(undefined), "cold");
  for (const s of [500, 502, 503, 504]) assert.equal(Logic.classify(res(s)), "cold");
  assert.equal(Logic.classify(res(404)), "go");
  assert.equal(Logic.classify(res(200, null)), "go");
});

test("the ticket answer: a ticket, retry while the API starts, null otherwise (open without SSO)", () => {
  const t = "a".repeat(43);
  assert.equal(Logic.ticketOf(res(200, { ticket: t, expires_in: 60 })), t);
  assert.equal(Logic.ticketOf({ type: "network" }), "retry");
  for (const s of [502, 503, 504]) assert.equal(Logic.ticketOf(res(s, { error: "db_waking" })), "retry");
  for (const s of [401, 403, 404, 429, 500]) assert.equal(Logic.ticketOf(res(s, { error: "x" })), null);
  assert.equal(Logic.ticketOf(res(200, { ticket: "short" })), null);
  assert.equal(Logic.ticketOf(res(200, { ticket: "bad ticket with spaces and more chars" })), null);
  assert.equal(Logic.ticketOf(res(200, null)), null);
});

test("the /sso address: https on the app's own host only, the ticket URL-encoded", () => {
  const app = "https://inbody.vojtah.cz/";
  assert.equal(Logic.ssoUrl("https://inbody.vojtah.cz/sso", app, "ab-_c"), "https://inbody.vojtah.cz/sso?t=ab-_c");
  assert.equal(Logic.ssoUrl("https://evil.example/sso", app, "x"), null);
  assert.equal(Logic.ssoUrl("http://inbody.vojtah.cz/sso", app, "x"), null);
  assert.equal(Logic.ssoUrl("not a url", app, "x"), null);
});

test("script.js reads /dbstatus with credentials, in the card, without inline code", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "homepage", "script.js"), "utf8");
  assert.ok(js.includes('mode: "cors"') && js.includes('credentials: "include"'));
  assert.ok(!js.includes("innerHTML") && !js.includes("eval("));
  assert.equal(js.split("window.location.assign(").length - 1, 1);   // one way out of the page
});
