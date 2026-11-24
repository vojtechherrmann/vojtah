// Static properties of the public start page the design relies on: no inline script or style, a CSP
// that names the API, the sign-in markup hidden until the script runs, nothing private published.
// Run: node --test tests/*.test.cjs
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
  assert.ok(html.includes('data-warm="https://inbody.vojtah.cz/dbstatus" data-sso="https://inbody.vojtah.cz/sso"'));
  assert.ok(html.includes('data-section="cimrmani"') && html.includes('data-section="euforie"'));
  assert.ok(html.includes('<script src="script.js" defer></script>'));
  assert.ok(html.includes('<script src="login.js" defer></script>'));
  assert.ok(html.includes('<script src="pwfields.js" defer></script>'));
});

test("login.js: credentials only for the API call, never innerHTML", () => {
  const js = read("login.js");
  assert.ok(!js.includes("innerHTML") && !js.includes("eval(") && !js.includes("document.write"));
  assert.equal(js.split('credentials: "include"').length - 1, 1); // one place: the API call helper
  assert.ok(js.includes('credentials: "omit"')); // /dbstatus and /healthz carry no cookies
  assert.ok(js.includes("dbstatus") && js.includes("DB_POLL_MS = 3000"));
});

test("the public AI FOR LIFE card and its work-in-progress page exist", () => {
  const html = read("index.html");
  assert.ok(/<a class="card" href="ai-for-life\/">\s*<span class="pill public">Public<\/span>\s*<span class="name">AI FOR LIFE<\/span>/.test(html));
  const page = read("ai-for-life", "index.html");
  assert.ok(page.includes('class="pill public"') && /Work in progress/.test(page));
});

test("the semi-public SOCCER CALLS card, its page, the public contact only, the screenshot", () => {
  const html = read("index.html");
  assert.ok(/<a class="card" href="soccer-calls\/">\s*<span class="pill semi">Semi-public<\/span>\s*<span class="name">SOCCER CALLS<\/span>/.test(html));
  const page = read("soccer-calls", "index.html");
  assert.ok(page.includes('<span class="pill semi">Semi-public</span>') && page.includes('<span class="name">SOCCER CALLS</span>'));
  assert.ok(!/<script/.test(page) && !page.includes("<style") && !page.includes(" style="));
  // "let me know" is the address the start page already publishes; no other contact appears
  const mails = page.match(/mailto:[^"]+/g);
  assert.deepEqual(mails, ["mailto:herrmann.vojtech@gmail.com"]);
  assert.ok(html.includes('href="mailto:herrmann.vojtech@gmail.com"'));
  assert.ok(!/tel:|\+\d{3}\s?\d{3}/.test(page));
  // the providers and the infrastructure behind it are not named on the public page
  for (const word of ["kalshi", "twilio", "azure", "monorepo", "gsc", "gs_caller", "polymarket"]) {
    assert.ok(!page.toLowerCase().includes(word) && !html.toLowerCase().includes(word), word);
  }
  // the screenshot of the control page (phone numbers blacked out), a click opens it full size
  assert.ok(/<a class="shot-link" href="call\.png"><img class="shot shot-wide" src="call\.png" alt="[^"]+" width="\d+" height="\d+" loading="lazy"><\/a>/.test(page));
  assert.ok(fs.existsSync(path.join(HOME, "soccer-calls", "call.png")));
  assert.ok(!page.includes("TODO"));
});

test("the on-request APP2PDF (TicketSwap) card and its page: the description and the contact, no code and no how-to", () => {
  const html = read("index.html");
  assert.ok(/<a class="card" href="app2pdf\/">\s*<span class="pill request">On request<\/span>\s*<span class="name">APP2PDF \(TicketSwap\)<\/span>/.test(html));
  const page = read("app2pdf", "index.html");
  assert.ok(page.includes('<span class="pill request">On request</span>') && page.includes('<span class="name">APP2PDF (TicketSwap)</span>'));
  assert.ok(page.includes('<meta name="robots" content="noindex">'));
  assert.ok(!/<script/.test(page) && !page.includes("<style") && !page.includes(" style="));
  // the contact is the only link out: no repository, no download
  const links = page.match(/<a [^>]*href="[^"]+"/g).map(a => /href="([^"]+)"/.exec(a)[1]);
  assert.deepEqual(links, ["../", "mailto:herrmann.vojtech@gmail.com", "../"]);
  assert.ok(page.includes("Ticketmaster"));
  // the site says soccer everywhere
  assert.ok(!/football/i.test(page) && !/football/i.test(html));
  assert.ok(/this project will never be public/.test(page));
  assert.ok(/<li>Slavia<\/li>/.test(page));
});

test("change password: an item next to Sign out in the user menu and a dialog with the right autocomplete hints", () => {
  const html = read("index.html");
  const menu = /<div class="menu" id="usermenu-list" hidden>[\s\S]*?<\/div>/.exec(html)[0];
  assert.ok(menu.includes('id="changepw"') && menu.includes('id="signout"'));
  assert.ok(menu.indexOf('id="changepw"') < menu.indexOf('id="signout"'));
  const dialog = /<dialog id="pw-dialog"[\s\S]*?<\/dialog>/.exec(html)[0];
  assert.ok(dialog.includes('aria-labelledby="pw-title"'));
  const input = id => new RegExp('<input[^>]*id="' + id + '"[^>]*>').exec(dialog)[0];
  assert.ok(/type="password"/.test(input("pw-current")) && /autocomplete="current-password"/.test(input("pw-current")));
  for (const id of ["pw-new", "pw-repeat"]) {
    assert.ok(/type="password"/.test(input(id)) && /autocomplete="new-password"/.test(input(id)), id);
  }
  for (const id of ["pw-current", "pw-new", "pw-repeat"]) assert.ok(/maxlength="1024"/.test(input(id)) && /required/.test(input(id)), id);
  // a (hidden) username field lets password managers attach the new password to the right account
  assert.ok(/autocomplete="username"/.test(input("pw-user")));
  assert.ok(dialog.includes('id="pw-status"') && dialog.includes('id="pw-error"') && dialog.includes('id="pw-cancel"'));
  // the admin hint is hidden until /me says so
  assert.ok(/id="pw-hint"[^>]*hidden/.test(html));
  assert.ok(html.includes("Your password was set by the admin - consider changing it."));
  assert.ok(!html.includes("<style") && !html.includes(" style=") && !html.includes(" onclick="));
});

test("change password: login.js sends it through the one API helper, as text, nothing is stored", () => {
  const js = read("login.js");
  assert.ok(js.includes('"/account/password"'));
  assert.equal(js.split('credentials: "include"').length - 1, 1); // still only the send() helper
  assert.ok(!js.includes("innerHTML"));
  // the passwords never go to storage, the console or the page text
  assert.ok(!/localStorage\.setItem\([^)]*(pw|pass)/i.test(js));
  assert.ok(!/console\.(log|debug|info|warn|error)/.test(js));
  assert.ok(js.includes('addEventListener("close"')); // fields are wiped when the dialog closes
});

test("change password: the dialog styles live in style.css (no inline style, CSP-safe)", () => {
  const css = read("style.css");
  assert.ok(css.includes(".visually-hidden") && css.includes("#pw-hint"));
});

test("every page has the VH favicon (one file), and the file is an SVG", () => {
  for (const [file, href] of [["index.html", "favicon.svg"], ["cimrmani/index.html", "../favicon.svg"],
                              ["euforie/index.html", "../favicon.svg"], ["ai-for-life/index.html", "../favicon.svg"],
                              ["project/index.html", "../favicon.svg"], ["soccer-calls/index.html", "../favicon.svg"],
                              ["app2pdf/index.html", "../favicon.svg"]]) {
    assert.ok(read(...file.split("/")).includes(`<link rel="icon" type="image/svg+xml" href="${href}">`), file);
  }
  const svg = read("favicon.svg");
  assert.ok(svg.startsWith("<svg") && svg.includes("<path"));
});
