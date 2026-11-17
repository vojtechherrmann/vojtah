// A smoke test of the DOM layer of homepage/login.js in a simulated browser (jsdom): the whole
// script runs against the real index.html with a faked API. It catches what the pure-logic tests
// cannot, e.g. a ReferenceError at start-up that leaves the sign-in link hidden.
// Run: npm install && node --test tests/*.test.cjs   (skipped when jsdom is not installed)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
try { ({ JSDOM } = require("jsdom")); } catch (_err) { /* dev dependency not installed */ }

const HOME = path.join(__dirname, "..", "homepage");
const html = fs.readFileSync(path.join(HOME, "index.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
const js = fs.readFileSync(path.join(HOME, "login.js"), "utf8");

async function start({ remembered, me }) {
  const dom = new JSDOM(html, { url: "https://vojtah.cz/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", e => errors.push(String(e.error || e.message)));
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };       // jsdom has none
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event("close")); };
  w.CSS = { escape: s => s };
  if (remembered) w.localStorage.setItem("vojtah.signedin", "1");
  w.fetch = async url => (String(url).endsWith("/me")
    ? { status: me.status, json: async () => me.body }
    : { status: 404, json: async () => ({}) });
  // jsdom cannot navigate and its Location cannot be patched: record where the page would go
  w.__went = [];
  const src = js.replace("window.location.assign(", "window.__went.push(");
  assert.notEqual(src, js, "login.js no longer opens an app with window.location.assign(");
  try { w.eval(src); } catch (err) { errors.push("EVAL: " + err); }
  await new Promise(resolve => setTimeout(resolve, 200));
  return { w, d: w.document, errors };
}
const shown = (d, id) => !d.getElementById(id).hidden;

test("anonymous visitor: no start-up error, the account area and the Login button are shown",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const { d, errors } = await start({ remembered: false, me: { status: 401, body: { error: "unauthenticated" } } });
    assert.deepEqual(errors, []);
    assert.ok(shown(d, "account") && shown(d, "signin"));
    assert.ok(!shown(d, "whoami"));
    // the same kind of box as the signed-in user: the user icon and the word Login
    const btn = d.getElementById("signin");
    assert.ok(btn.classList.contains("userbtn") && btn.querySelector("svg.usericon"));
    assert.equal(btn.textContent.trim(), "Login");
    assert.equal(d.getElementById("extra-cards").children.length, 0);
  });

test("signed-in visitor: name, Change password, the admin-set hint and the private card; the dialog opens",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const section = { id: "example", title: "GROUP/EXAMPLE", badge: "private", visibility: "restricted",
                      summary: "S", url: null, link_label: null };
    const { d, errors } = await start({ remembered: true, me: { status: 200, body: {
      user: { id: "u1", is_admin: true, password_admin_set: true }, csrf: "t", sections: [section] } } });
    assert.deepEqual(errors, []);
    assert.ok(shown(d, "account") && !shown(d, "signin") && shown(d, "whoami"));
    assert.equal(d.getElementById("who").textContent, "u1");
    assert.ok(shown(d, "pw-hint"));
    // the user sits in a box with an icon; Change password and Sign out are in its drop-down menu
    const btn = d.getElementById("usermenu-btn"), list = d.getElementById("usermenu-list");
    assert.ok(btn.querySelector("svg.usericon") && btn.contains(d.getElementById("who")));
    assert.ok(list.contains(d.getElementById("changepw")) && list.contains(d.getElementById("signout")));
    assert.ok(list.hidden && btn.getAttribute("aria-expanded") === "false");
    btn.click();
    assert.ok(!list.hidden && btn.getAttribute("aria-expanded") === "true");
    d.dispatchEvent(new d.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.ok(list.hidden);
    btn.click();
    d.body.click();   // a click elsewhere closes it
    assert.ok(list.hidden);
    btn.click();
    d.getElementById("changepw").click();   // choosing an item closes the menu and opens the dialog
    assert.ok(list.hidden);
    assert.equal(d.getElementById("extra-cards").children.length, 1);
    assert.equal(d.querySelector("#extra-cards .name").textContent, "GROUP/EXAMPLE");
    assert.equal(d.querySelector("#extra-cards .name .group").textContent, "GROUP/");
    d.getElementById("changepw").click();
    assert.equal(d.getElementById("pw-dialog").open, true);
  });

test("an app card waits IN the card for GET /sections/<id>/wake, then opens app_url (no page in between)",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const section = { id: "app1", title: "GROUP/APP", badge: "private", visibility: "restricted", summary: null,
                      url: "https://vojtah.cz/group/app", link_label: "Open", app_url: "https://app.example.test/" };
    const { w, d, errors } = await start({ remembered: true, me: { status: 200, body: {
      user: { id: "u1", is_admin: false, password_admin_set: false }, csrf: "t", sections: [section] } } });
    assert.deepEqual(errors, []);
    const card = d.querySelector("#extra-cards a.card");
    assert.equal(card.getAttribute("href"), "https://vojtah.cz/group/app");   // new tab / bookmark
    const note = card.querySelector(".warm");
    assert.ok(note && note.hidden);
    let ready = false;
    const calls = [];
    w.fetch = async url => {
      calls.push(String(url));
      return { status: 200, json: async () => ({ ready }) };
    };
    const went = w.__went;
    const click = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    card.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.ok(calls.length >= 1 && calls.every(u => u.endsWith("/sections/app1/wake")));
    assert.ok(!note.hidden && card.classList.contains("waiting"));
    assert.deepEqual(went, []);
    ready = true;
    await new Promise(resolve => setTimeout(resolve, 3300));
    assert.deepEqual(went, ["https://app.example.test/"]);
    w.close();
  });

test("a returning visitor while the API wakes up: no loader at the top of the page (waiting lives in cards)",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const { w, d, errors } = await start({ remembered: true, me: { status: 503, body: { error: "db_waking" } } });
    await new Promise(resolve => setTimeout(resolve, 1600));   // past the 1.2 s "show the note" delay
    assert.deepEqual(errors, []);
    assert.ok(d.getElementById("account-status").hidden);
    assert.equal(d.getElementById("account-status").textContent, "");
    w.close();
  });

// ------------------------------------------------------------------ script.js: the InBody card
const scriptJs = fs.readFileSync(path.join(HOME, "script.js"), "utf8");

async function startCard({ signedIn, dbstatus, sso }) {
  const dom = new JSDOM(html, { url: "https://vojtah.cz/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", e => errors.push(String(e.error || e.message)));
  if (signedIn) w.localStorage.setItem("vojtah.signedin", "1");
  const calls = [];
  w.fetch = async (url, init) => {
    calls.push([String(url), (init && init.method) || "GET"]);
    if (String(url).endsWith("/dbstatus")) return { status: 200, json: async () => dbstatus() };
    if (String(url).endsWith("/sso/inbody")) return { status: sso.status, json: async () => sso.body };
    return { status: 404, json: async () => ({}) };
  };
  w.__went = [];
  const src = scriptJs.replace("window.location.assign(", "window.__went.push(");
  assert.notEqual(src, scriptJs);
  try { w.eval(src); } catch (err) { errors.push("EVAL: " + err); }
  const card = w.document.querySelector("a[data-warm]");
  const click = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  card.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  return { w, card, calls, errors };
}

test("InBody card, signed in here: waits for a warm database, gets a ticket, opens the app's /sso",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    let warm = false;
    const ticket = "T".repeat(43);
    const { w, card, calls, errors } = await startCard({
      signedIn: true, dbstatus: () => ({ warm, session: false }), sso: { status: 200, body: { ticket, expires_in: 60 } } });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.deepEqual(w.__went, []);                       // the database is still cold
    assert.ok(card.classList.contains("waiting") && /database/.test(card.querySelector(".warm").textContent));
    warm = true;
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert.deepEqual(errors, []);
    assert.deepEqual(w.__went, ["https://inbody.vojtah.cz/sso?t=" + ticket]);
    assert.deepEqual(calls.filter(c => c[0].endsWith("/sso/inbody")), [["https://api.vojtah.cz/sso/inbody", "POST"]]);
    w.close();
  });

test("InBody card, signed in but the API says no session: opens the app as before (its own login)",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const { w, errors } = await startCard({
      signedIn: true, dbstatus: () => ({ warm: true, session: false }), sso: { status: 401, body: { error: "unauthenticated" } } });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(errors, []);
    assert.deepEqual(w.__went, ["https://inbody.vojtah.cz/"]);
    w.close();
  });

test("InBody card, anonymous: no ticket request, the cold database does not hold up the front page",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const { w, calls } = await startCard({
      signedIn: false, dbstatus: () => ({ warm: false, session: false }), sso: { status: 500, body: null } });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(w.__went, ["https://inbody.vojtah.cz/"]);
    assert.ok(calls.every(c => !c[0].includes("/sso")));
    w.close();
  });

// ------------------------------------------------------------------ pwfields.js: eye button, live rules
test("password fields: an eye button per field, live rule marks, the match hint, reset when the dialog closes",
  { skip: !JSDOM && "jsdom is not installed" }, async () => {
    const dom = new JSDOM(html, { url: "https://vojtah.cz/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window, d = w.document;
    const errors = [];
    w.addEventListener("error", e => errors.push(String(e.error || e.message)));
    w.eval(fs.readFileSync(path.join(HOME, "pwfields.js"), "utf8"));
    await new Promise(resolve => setTimeout(resolve, 50));   // init may wait for DOMContentLoaded
    assert.deepEqual(errors, []);
    for (const id of ["login-pass", "pw-current", "pw-new", "pw-repeat"]) {
      const btn = d.getElementById(id).parentNode.querySelector("button.pw-toggle");
      assert.ok(btn && btn.type === "button" && btn.getAttribute("aria-label") === "Show password", id);
    }
    const field = d.getElementById("pw-new");
    const eye = field.parentNode.querySelector(".pw-toggle");
    eye.click();
    assert.equal(field.type, "text");
    assert.equal(eye.getAttribute("aria-pressed"), "true");
    d.getElementById("pw-dialog").dispatchEvent(new w.Event("close"));
    assert.equal(field.type, "password");

    const ok = rule => d.querySelector(`li[data-rule="${rule}"]`).classList.contains("pw-ok");
    const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input")); };
    assert.deepEqual(["length", "upper", "lower", "digit"].map(ok), [false, false, false, false]);
    type(field, "abcD");
    assert.deepEqual(["length", "upper", "lower", "digit"].map(ok), [false, true, true, false]);
    type(field, "abcDefg1");
    assert.deepEqual(["length", "upper", "lower", "digit"].map(ok), [true, true, true, true]);
    const match = d.getElementById("pw-match");
    assert.equal(match.hidden, true);
    type(d.getElementById("pw-repeat"), "abcDefg");
    assert.ok(!match.hidden && !match.classList.contains("pw-ok"));
    type(d.getElementById("pw-repeat"), "abcDefg1");
    assert.ok(match.classList.contains("pw-ok"));
    w.close();
  });
