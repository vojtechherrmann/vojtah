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

test("titleParts: the part up to the last '/' is the group, drawn smaller", () => {
  assert.deepEqual(Logic.titleParts("GROUP/NAME"), { group: "GROUP/", name: "NAME" });
  assert.deepEqual(Logic.titleParts("NAME"), { group: "", name: "NAME" });
  assert.deepEqual(Logic.titleParts("NAME/"), { group: "", name: "NAME/" });
});

test("cardModel: whitelists the badge, never trusts HTML, defaults the link label", () => {
  const m = Logic.cardModel({ id: "p", title: "<b>x</b>", badge: "request", summary: "s", url: "https://e.test/", link_label: "Go" });
  assert.deepEqual(m, { id: "p", title: "<b>x</b>", badge: "request", badgeLabel: "On request", summary: "s", href: "https://e.test/", linkLabel: "Go", appUrl: null });
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

test("cardModel: a restricted section without a URL is a static card with the Private badge", () => {
  // The shape GET /me returns for a private project that has no link (neutral example text).
  const section = {
    id: "example",
    title: "EXAMPLE",
    badge: "private",
    visibility: "restricted",
    summary: "A short description.",
    url: null,
    link_label: null,
  };
  assert.deepEqual(Logic.cardModel(section), {
    id: "example",
    title: "EXAMPLE",
    badge: "private",
    badgeLabel: "Private",
    summary: "A short description.",
    href: null, // no link: the DOM layer draws a non-clickable card
    linkLabel: "Open",
    appUrl: null,
  });
});

// ------------------------------------------------------------------------------ change password

const pwRes = (status, body = null) => res(status, body);

test("classifyPasswordChange: every answer of POST /account/password has its own kind", () => {
  assert.equal(Logic.classifyPasswordChange(pwRes(204)), "ok");
  // a wrong CURRENT password is a 401 invalid_credentials; an expired session is a 401 too
  assert.equal(Logic.classifyPasswordChange(pwRes(401, { error: "invalid_credentials" })), "wrong_current");
  assert.equal(Logic.classifyPasswordChange(pwRes(401, { error: "unauthenticated" })), "signed_out");
  assert.equal(Logic.classifyPasswordChange(pwRes(401)), "signed_out");
  assert.equal(Logic.classifyPasswordChange(pwRes(400, { error: "invalid_new_password", rules: ["length"] })), "weak");
  assert.equal(Logic.classifyPasswordChange(pwRes(400, { error: "bad_request" })), "error");
  assert.equal(Logic.classifyPasswordChange(pwRes(429, { error: "rate_limited" })), "limited");
  assert.equal(Logic.classifyPasswordChange(pwRes(403, { error: "csrf" })), "forbidden");
  assert.equal(Logic.classifyPasswordChange(pwRes(500, { error: "server_error" })), "error");
  // the two waiting states are the same as everywhere else
  assert.equal(Logic.classifyPasswordChange(pwRes(503, { error: "db_waking" })), "db_waking");
  assert.equal(Logic.classifyPasswordChange({ type: "network" }), "cold");
  assert.equal(Logic.classifyPasswordChange(pwRes(502)), "cold");
  assert.equal(Logic.classifyPasswordChange(undefined), "cold");
});

test("classifyPasswordChange: only the waiting states keep waiting (plan is shared)", () => {
  for (const kind of ["wrong_current", "weak", "signed_out", "limited", "forbidden", "mismatch", "same"]) {
    assert.equal(Logic.plan(kind), "fail", kind);
  }
  assert.equal(Logic.plan(Logic.classifyPasswordChange(pwRes(204))), "done");
  assert.equal(Logic.plan(Logic.classifyPasswordChange({ type: "network" })), "retry_cold");
});

test("passwordRules: the same four rules as the server, in the same order", () => {
  assert.deepEqual(Logic.passwordRules("Abcdefg1"), []);
  assert.deepEqual(Logic.passwordRules("Žluťoučký kůň 7"), []); // non-ASCII letters count
  assert.deepEqual(Logic.passwordRules("Abcdef1"), ["length"]);
  assert.deepEqual(Logic.passwordRules("abcdefg1"), ["upper"]);
  assert.deepEqual(Logic.passwordRules("ABCDEFG1"), ["lower"]);
  assert.deepEqual(Logic.passwordRules("Abcdefgh"), ["digit"]);
  assert.deepEqual(Logic.passwordRules(""), ["length", "upper", "lower", "digit"]);
  assert.equal(Logic.PASSWORD_MIN_LENGTH, 8);
});

test("passwordRules: the length counts characters, not UTF-16 units", () => {
  // "Ab1" + an emoji (2 UTF-16 units) + "cde" is 7 characters but 8 units: still too short
  assert.equal("Ab1\u{1F600}cde".length, 8);
  assert.deepEqual(Logic.passwordRules("Ab1\u{1F600}cde"), ["length"]);
  assert.deepEqual(Logic.passwordRules("Ab1\u{1F600}cdef"), []);
});

test("checkNewPassword: mismatch, policy and 'same' are caught before any request", () => {
  assert.equal(Logic.checkNewPassword("Old-Pass-1", "Novy-Heslo-2026", "Novy-Heslo-2026"), null);
  assert.deepEqual(Logic.checkNewPassword("Old-Pass-1", "Novy-Heslo-2026", "Novy-Heslo-2027"), { kind: "mismatch", rules: [] });
  assert.deepEqual(Logic.checkNewPassword("Old-Pass-1", "abc", "abc"), { kind: "weak", rules: ["length", "upper", "digit"] });
  assert.deepEqual(Logic.checkNewPassword("Same-Pass-1", "Same-Pass-1", "Same-Pass-1"), { kind: "same", rules: [] });
  // an empty current password is not worth a request either
  assert.deepEqual(Logic.checkNewPassword("", "Novy-Heslo-2026", "Novy-Heslo-2026"), { kind: "need_current", rules: [] });
  // mismatch wins over weak (the user typed two different things: fix that first)
  assert.equal(Logic.checkNewPassword("Old-Pass-1", "abc", "abd").kind, "mismatch");
});

test("passwordMessage: plain texts, the broken rules named, no password anywhere", () => {
  assert.match(Logic.passwordMessage("wrong_current"), /current password is wrong/i);
  assert.match(Logic.passwordMessage("mismatch"), /do not match/);
  assert.match(Logic.passwordMessage("same"), /differ from the current/);
  assert.match(Logic.passwordMessage("limited"), /Too many attempts/);
  assert.match(Logic.passwordMessage("signed_out"), /sign in again/i);
  assert.match(Logic.passwordMessage("ok"), /Password changed/);
  const weak = Logic.passwordMessage("weak", ["length", "digit"]);
  assert.match(weak, /at least 8 characters/);
  assert.match(weak, /a digit/);
  assert.doesNotMatch(weak, /uppercase|lowercase/);
  assert.match(Logic.passwordMessage("weak", ["upper", "lower"]), /an uppercase letter.*a lowercase letter/);
  // the shared kinds still work through it
  assert.equal(Logic.passwordMessage("cold"), Logic.MESSAGES.cold);
  assert.equal(Logic.passwordMessage("db_waking"), Logic.MESSAGES.db_waking);
  assert.equal(Logic.passwordMessage("nope"), Logic.MESSAGES.error);
  // the login wording must not leak into the change dialog
  assert.doesNotMatch(Logic.passwordMessage("wrong_current"), /username/i);
});

test("the server's rule codes that the page does not know are ignored, never rendered raw", () => {
  const msg = Logic.passwordMessage("weak", ["length", "<b>x</b>", "same"]);
  assert.doesNotMatch(msg, /<b>/);
  assert.match(msg, /at least 8 characters/);
  assert.match(Logic.passwordMessage("weak", ["same"]), /differ from the current/);
  assert.match(Logic.passwordMessage("weak", []), /new password/i);
  assert.match(Logic.passwordMessage("weak"), /new password/i);
});

test("showAdminHint: only a true flag from the API recommends a change", () => {
  assert.equal(Logic.showAdminHint({ id: "u", password_admin_set: true }), true);
  for (const bad of [{ id: "u", password_admin_set: false }, { id: "u" }, { id: "u", password_admin_set: "yes" }, null, undefined]) {
    assert.equal(Logic.showAdminHint(bad), false, JSON.stringify(bad));
  }
  assert.equal(Logic.ADMIN_HINT, "Your password was set by the admin - consider changing it.");
});

test("buildPasswordRequest: the JSON body has exactly the two fields the API takes", () => {
  const req = Logic.buildPasswordRequest("Old-Pass-1", "Novy-Heslo-2026", "csrf-token");
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.headers["X-CSRF-Token"], "csrf-token");
  assert.deepEqual(JSON.parse(req.body), { current_password: "Old-Pass-1", new_password: "Novy-Heslo-2026" });
  assert.equal(Logic.buildPasswordRequest("a", "b", null).headers["X-CSRF-Token"], "");
});

test("cardModel / classifyWake: an app card (https app_url only) and its waiting states", () => {
  assert.equal(Logic.cardModel({ app_url: "https://app.example.test/" }).appUrl, "https://app.example.test/");
  for (const bad of ["http://app.example.test/", "mailto:a@example.test", "javascript:1", "", null]) {
    assert.equal(Logic.cardModel({ app_url: bad }).appUrl, null, String(bad));
  }
  assert.equal(Logic.classifyWake(res(200, { ready: true })), "ready");
  assert.equal(Logic.classifyWake(res(200, { ready: false })), "starting");
  assert.equal(Logic.classifyWake({ type: "network" }), "starting");
  assert.equal(Logic.classifyWake(res(503, { error: "db_waking" })), "starting");
  assert.equal(Logic.classifyWake(res(502)), "starting");
  assert.equal(Logic.classifyWake(res(404, { error: "not_found" })), "stop");
  assert.equal(Logic.classifyWake(res(401)), "stop");
});
