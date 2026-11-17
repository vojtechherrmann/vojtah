// Logic of homepage/script.js: when may a click on the InBody card open the app?
// Run: node --test tests
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

test("no answer or a 5xx = the container is starting; any other answer = open", () => {
  assert.equal(Logic.classify({ type: "network" }), "cold");
  assert.equal(Logic.classify(undefined), "cold");
  for (const s of [500, 502, 503, 504]) assert.equal(Logic.classify(res(s)), "cold");
  assert.equal(Logic.classify(res(404)), "go");
  assert.equal(Logic.classify(res(200, null)), "go");
});

test("script.js reads /dbstatus with credentials, in the card, without inline code", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "homepage", "script.js"), "utf8");
  assert.ok(js.includes('mode: "cors"') && js.includes('credentials: "include"'));
  assert.ok(!js.includes("innerHTML") && !js.includes("eval("));
  assert.ok(js.includes("window.location.href = target"));
});
