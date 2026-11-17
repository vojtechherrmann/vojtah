// A smoke test of the DOM layer of homepage/login.js in a simulated browser (jsdom): the whole
// script runs against the real index.html with a faked API. It catches what the pure-logic tests
// cannot, e.g. a ReferenceError at start-up that leaves the sign-in link hidden.
// Run: npm install && node --test tests   (skipped when jsdom is not installed)
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
  try { w.eval(js); } catch (err) { errors.push("EVAL: " + err); }
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
