// Static properties of the public start page the design relies on: no inline script or style, a CSP
// that names the API, the sign-in markup hidden until the script runs, nothing private published.
// Run: node --test tests
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOME = path.join(__dirname, "..", "homepage");
const read = (...p) => fs.readFileSync(path.join(HOME, ...p), "utf8");

test("no inline script or style, and a CSP that names the API", () => {
  const html = read("index.html");
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html));
  assert.ok(!html.includes("<style") && !html.includes(" style=") && !html.includes(" onclick="));
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.ok(csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"));
  const api = /name="site-api" content="([^"]+)"/.exec(html)[1];
  assert.ok(csp.includes(api));
  assert.equal(api, "https://api.vojtah.cz");
  assert.ok(csp.includes("https://inbody.vojtah.cz")); // the InBody wake-up probe
});

test("the sign-in UI is hidden until the script runs; the static cards are untouched", () => {
  const html = read("index.html");
  assert.ok(/id="account" hidden/.test(html));
  assert.ok(html.includes('id="extra-cards" aria-label="Your projects" hidden'));
  assert.ok(html.includes('data-warm="https://inbody.vojtah.cz/healthz"'));
  assert.ok(html.includes('data-section="cimrmani"') && html.includes('data-section="euforie"'));
  assert.ok(html.includes('<script src="script.js" defer></script>'));
  assert.ok(html.includes('<script src="login.js" defer></script>'));
});

test("login.js: credentials only for the API call, never innerHTML", () => {
  const js = read("login.js");
  assert.ok(!js.includes("innerHTML") && !js.includes("eval(") && !js.includes("document.write"));
  assert.equal(js.split('credentials: "include"').length - 1, 1); // one place: the API call helper
  assert.ok(js.includes('credentials: "omit"')); // /dbstatus and /healthz carry no cookies
  assert.ok(js.includes("dbstatus") && js.includes("DB_POLL_MS = 3000"));
});
