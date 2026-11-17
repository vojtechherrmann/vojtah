// homepage/404.html + homepage/route.js: the "page not found" that doubles as the page of a private
// project with its own address (/a/b -> section "a-b" from the API). Pure logic, static
// properties of the page, and a jsdom run of the DOM layer with a faked API.
// Run: npm install && node --test tests   (the jsdom part is skipped when jsdom is not installed)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../homepage/route.js");

let JSDOM = null;
try { ({ JSDOM } = require("jsdom")); } catch (_err) { /* dev dependency not installed */ }

const HOME = path.join(__dirname, "..", "homepage");
const read = (...p) => fs.readFileSync(path.join(HOME, ...p), "utf8");
const res = (status, body = null) => ({ type: "response", status, body });

// ------------------------------------------------------------------------------------ pure logic

test("sectionIdFromPath: 1-3 plain lower-case segments joined by '-'", () => {
  assert.equal(Logic.sectionIdFromPath("/alpha/beta"), "alpha-beta");
  assert.equal(Logic.sectionIdFromPath("/alpha/beta/"), "alpha-beta");
  assert.equal(Logic.sectionIdFromPath("/alpha"), "alpha");
  assert.equal(Logic.sectionIdFromPath("/a-1/b/c"), "a-1-b-c");
  for (const bad of ["/", "", "/a", "/A/b", "/a/b/c/d", "/a//b", "/a/b.html", "/-a/b", "/a/%20",
                     "/" + "a".repeat(33), undefined]) {
    assert.equal(Logic.sectionIdFromPath(bad), null, String(bad));
  }
});

test("classify / classifyWake: the API's waiting states, hidden = 401/403/404", () => {
  assert.equal(Logic.classify(res(200, {})), "ok");
  for (const s of [401, 403, 404]) assert.equal(Logic.classify(res(s)), "hidden");
  assert.equal(Logic.classify(res(503, { error: "db_waking" })), "db_waking");
  assert.equal(Logic.classify({ type: "network" }), "cold");
  assert.equal(Logic.classify(res(500)), "error");

  assert.equal(Logic.classifyWake(res(200, { ready: true })), "ready");
  assert.equal(Logic.classifyWake(res(200, { ready: false })), "starting");
  assert.equal(Logic.classifyWake(res(200, { ready: "yes" })), "starting");
  assert.equal(Logic.classifyWake({ type: "network" }), "starting");
  assert.equal(Logic.classifyWake(res(503, { error: "db_waking" })), "starting");
  assert.equal(Logic.classifyWake(res(404, { error: "not_found" })), "hidden");
  assert.equal(Logic.classifyWake(res(500)), "error");
});

test("pageModel: app_url is https only, links https/mailto only, unknown badge = Private", () => {
  const m = Logic.pageModel({ title: "T", badge: "nope", summary: "S", url: "https://vojtah.cz/x/y",
                              link_label: "Go", app_url: "https://app.example.test/" });
  assert.deepEqual(m, { title: "T", badge: "private", badgeLabel: "Private", summary: "S",
                        href: "https://vojtah.cz/x/y", linkLabel: "Go", appUrl: "https://app.example.test/" });
  assert.equal(Logic.pageModel({ app_url: "mailto:a@example.test" }).appUrl, null);
  assert.equal(Logic.pageModel({ app_url: "javascript:alert(1)" }).appUrl, null);
  assert.equal(Logic.pageModel({ app_url: "http://app.example.test/" }).appUrl, null);
  assert.equal(Logic.pageModel({ url: "mailto:a@example.test" }).href, "mailto:a@example.test");
  assert.equal(Logic.pageModel({}).linkLabel, "Open");
});

test("isSelfLink ignores a trailing slash", () => {
  assert.ok(Logic.isSelfLink("https://vojtah.cz/x/y", "https://vojtah.cz/x/y/"));
  assert.ok(!Logic.isSelfLink("https://vojtah.cz/x/z", "https://vojtah.cz/x/y"));
  assert.ok(!Logic.isSelfLink("not a url", "https://vojtah.cz/"));
});

// ---------------------------------------------------------------------------- static properties

test("404.html: absolute asset paths, no inline code, the CSP names only itself and the API", () => {
  const html = read("404.html");
  assert.match(html, /<script src="\/route\.js" defer><\/script>/);
  assert.match(html, /href="\/style\.css"/);
  assert.match(html, /href="\/favicon\.svg"/);
  assert.doesNotMatch(html, /<script>|<style|style="|\son[a-z]+="/i);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.vojtah\.cz;/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test("route.js names no host but the API it reads from the page", () => {
  const js = read("route.js");
  assert.doesNotMatch(js, /https:\/\/(?!api\.vojtah\.cz)[a-z0-9.-]+\.[a-z]/i);
  assert.doesNotMatch(js, /azurecontainerapps|\.azure/i);
});

// ------------------------------------------------------------------------------------- jsdom

const html404 = read("404.html").replace(/<script[^>]*><\/script>/g, "");
const js = read("route.js");

const windows = [];
test.after(() => windows.forEach(w => w.close()));   // stops the polling timers, or node --test never exits

async function run({ pathname, remembered, api, waitMs = 300 }) {
  const dom = new JSDOM(html404, { url: "https://vojtah.cz" + pathname, runScripts: "outside-only" });
  const w = dom.window;
  const errors = [], calls = [], replaced = [];
  w.addEventListener("error", e => errors.push(String(e.error || e.message)));
  if (remembered) w.localStorage.setItem("vojtah.signedin", "1");
  w.fetch = async url => {
    const p = String(url).replace("https://api.vojtah.cz", "");
    calls.push(p);
    const r = api(p, calls.length);
    return { status: r.status, json: async () => r.body };
  };
  // jsdom cannot navigate (and window.location cannot be redefined): record where the page would go
  w.__go = [];
  const src = js.replace("location.replace(", "window.__go.push(");
  assert.notEqual(src, js, "route.js no longer navigates with location.replace(");
  try { w.eval(src); } catch (err) { errors.push("EVAL: " + err); }
  await new Promise(resolve => setTimeout(resolve, waitMs));
  replaced.push(...w.__go);
  windows.push(w);
  return { d: w.document, errors, calls: [...calls], replaced };
}
const skip = !JSDOM && "jsdom is not installed";
const shown = (d, id) => !d.getElementById(id).hidden;

test("anonymous visitor: plain 'not found', and NO request to the API", { skip }, async () => {
  const { d, errors, calls } = await run({ pathname: "/alpha/beta", remembered: false,
                                           api: () => ({ status: 200, body: {} }) });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, []);
  assert.equal(d.getElementById("status").textContent, Logic.MESSAGES.missing);
  assert.ok(shown(d, "signin-hint") && !shown(d, "project"));
});

test("signed-in visitor, section not visible: the same 'not found'", { skip }, async () => {
  const { d, errors, calls } = await run({ pathname: "/alpha/beta", remembered: true,
                                           api: () => ({ status: 404, body: { error: "not_found" } }) });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ["/sections/alpha-beta"]);
  assert.equal(d.getElementById("status").textContent, Logic.MESSAGES.missing);
  assert.ok(!shown(d, "project"));
});

test("an app section: 'starting', polls /wake, then opens the app; 'Open now' is there meanwhile", { skip }, async () => {
  const section = { id: "alpha-beta", title: "ALPHA", badge: "private", summary: "S",
                    url: "https://vojtah.cz/alpha/beta", link_label: "Open", app_url: "https://app.example.test/" };
  const api = p => (p === "/sections/alpha-beta" ? { status: 200, body: section }
                                                 : { status: 200, body: { ready: false } });
  const first = await run({ pathname: "/alpha/beta", remembered: true, api });
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.calls, ["/sections/alpha-beta", "/sections/alpha-beta/wake"]);
  assert.equal(first.d.getElementById("status").textContent, Logic.MESSAGES.starting);
  assert.ok(shown(first.d, "project"));
  assert.equal(first.d.getElementById("p-name").textContent, "ALPHA");
  const open = first.d.querySelector("#project a");
  assert.equal(open.href, "https://app.example.test/");
  assert.equal(open.textContent, "Open now →");
  assert.deepEqual(first.replaced, []);

  const ready = await run({ pathname: "/alpha/beta/", remembered: true,
                            api: p => (p.endsWith("/wake") ? { status: 200, body: { ready: true } }
                                                           : { status: 200, body: section }) });
  assert.deepEqual(ready.errors, []);
  assert.deepEqual(ready.replaced, ["https://app.example.test/"]);
  assert.equal(ready.d.getElementById("status").textContent, Logic.MESSAGES.ready);
});

test("a section without an app is drawn like a project page (no link to itself)", { skip }, async () => {
  const section = { id: "alpha-beta", title: "ALPHA", badge: "request", summary: "S",
                    url: "https://vojtah.cz/alpha/beta", link_label: "Open", app_url: null };
  const { d, errors, calls } = await run({ pathname: "/alpha/beta", remembered: true,
                                           api: () => ({ status: 200, body: section }) });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ["/sections/alpha-beta"]);
  assert.ok(shown(d, "project") && !shown(d, "status"));
  assert.equal(d.querySelector("#project a"), null);
});
