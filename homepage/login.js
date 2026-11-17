/* vojtah.cz: optional sign-in. Dependency-free, one file, no inline code anywhere.
   The static page is complete without this script and without the API. Signing in only ADDS what
   the API (https://api.vojtah.cz, see <meta name="site-api">) says the visitor may see: new cards,
   or the real content of an existing card that carries data-section="<id>". Anonymous visitors
   never talk to the API (no request, no cold start): it is contacted only after a click on
   "Sign in", or on load when this browser signed in before (a "1" in localStorage).

   Two different waiting states, because they have different causes:
     cold      the API container scales to zero: the request hangs or fails for ~30 s
     db_waking the API answers 503 {"error":"db_waking"}: its database (Azure SQL free offer)
               auto-paused and is resuming (up to a minute); the page polls /dbstatus every 3 s
   The pure functions (Logic) have no DOM and no network; tests/client/ runs them under node. */
(() => {
  "use strict";

  const COLD_RETRY_MS = 2000;
  const DB_POLL_MS = 3000;
  const ATTEMPT_TIMEOUT_MS = 45000;
  const GIVE_UP_MS = 150000;
  const SHOW_AFTER_MS = 1200;   // a warm API answers faster: no flicker
  const HINT_KEY = "vojtah.signedin";
  const BADGES = { public: "Public", semi: "Semi-public", request: "On request", private: "Private" };
  const MESSAGES = {
    cold: "The server is starting up. Please wait, this can take up to 30 seconds.",
    db_waking: "The database is waking up. This can take up to a minute.",
    invalid: "Wrong username or password.",
    limited: "Too many attempts. Please wait a minute and try again.",
    forbidden: "The request was refused. Reload the page and try again.",
    unavailable: "The sign-in server is not reachable right now. The page works as usual without it; try again later.",
    error: "Something went wrong. Please try again.",
  };

  // Change password. The server (not this file) is the authority on the policy; the page only
  // pre-checks it so a typo does not cost a request (the API counts every attempt).
  const PASSWORD_MIN_LENGTH = 8;
  const ADMIN_HINT = "Your password was set by the admin - consider changing it.";
  const RULE_TEXT = {
    length: "at least " + PASSWORD_MIN_LENGTH + " characters",
    upper: "an uppercase letter",
    lower: "a lowercase letter",
    digit: "a digit",
  };
  const PASSWORD_MESSAGES = {
    ok: "Password changed. Your other sessions were signed out.",
    wrong_current: "The current password is wrong.",
    need_current: "Enter your current password.",
    mismatch: "The new passwords do not match.",
    same: "The new password must differ from the current one.",
    weak: "Please choose a stronger new password.",
    limited: "Too many attempts. Please wait a few minutes and try again.",
    signed_out: "Your session has expired. Please sign in again.",
  };

  // ------------------------------------------------------------------ pure logic (no DOM, no network)
  const Logic = {
    BADGES,
    MESSAGES,

    /* What did the API answer? outcome = {type: "network"} | {type: "response", status, body}. */
    classify(outcome) {
      if (!outcome || outcome.type === "network") return "cold";   // hang / abort / no CORS headers
      const { status, body } = outcome;
      if (status >= 200 && status < 300) return "ok";
      if (status === 503 && body && body.error === "db_waking") return "db_waking";
      if (status === 502 || status === 503 || status === 504) return "cold";   // ingress, no app yet
      if (status === 401) return "invalid";
      if (status === 429) return "limited";
      if (status === 403) return "forbidden";
      return "error";
    },

    /* done: success; fail: show the message; retry_cold / wait_db: keep waiting. */
    plan(kind) {
      if (kind === "ok") return "done";
      if (kind === "cold") return "retry_cold";
      if (kind === "db_waking") return "wait_db";
      return "fail";
    },

    messageFor(kind) {
      return MESSAGES[kind] || MESSAGES.error;
    },

    /* Only https: and mailto: links are ever rendered as links. */
    safeUrl(raw) {
      if (typeof raw !== "string" || !raw) return null;
      try {
        const u = new URL(raw);
        return u.protocol === "https:" || u.protocol === "mailto:" ? u.href : null;
      } catch (_err) {
        return null;
      }
    },

    /* A section from the API -> what the DOM layer draws. Unknown badge = the strictest label. */
    cardModel(section) {
      const s = section || {};
      const badge = Object.prototype.hasOwnProperty.call(BADGES, s.badge) ? s.badge : "private";
      return {
        id: String(s.id || ""),
        title: String(s.title || ""),
        badge,
        badgeLabel: BADGES[badge],
        summary: s.summary ? String(s.summary) : "",
        href: Logic.safeUrl(s.url),
        linkLabel: s.link_label ? String(s.link_label) : "Open",
      };
    },

    // ---- change password

    /* What did POST /account/password answer? Same waiting states as everywhere; a 401 is either
       the wrong CURRENT password (invalid_credentials) or no / expired session. */
    classifyPasswordChange(outcome) {
      if (!outcome || outcome.type === "network") return "cold";
      const { status, body } = outcome;
      const code = body && body.error;
      if (status === 401) return code === "invalid_credentials" ? "wrong_current" : "signed_out";
      if (status === 400 && code === "invalid_new_password") return "weak";
      if (status === 429) return "limited";
      return Logic.classify(outcome);
    },

    PASSWORD_MIN_LENGTH,
    ADMIN_HINT,

    /* The rules a NEW password breaks, in the server's order (Unicode letters, ASCII digits). */
    passwordRules(password) {
      const pw = String(password || "");
      const rules = [];
      if ([...pw].length < PASSWORD_MIN_LENGTH) rules.push("length");
      if (!/\p{Lu}/u.test(pw)) rules.push("upper");
      if (!/\p{Ll}/u.test(pw)) rules.push("lower");
      if (!/[0-9]/.test(pw)) rules.push("digit");
      return rules;
    },

    /* Cheap checks before any request: null = go ahead, else {kind, rules}. */
    checkNewPassword(current, next, repeat) {
      if (!current) return { kind: "need_current", rules: [] };
      if (next !== repeat) return { kind: "mismatch", rules: [] };
      const rules = Logic.passwordRules(next);
      if (rules.length) return { kind: "weak", rules };
      if (next === current) return { kind: "same", rules: [] };
      return null;
    },

    /* A line of plain text for the dialog. `rules` = broken rule codes (from checkNewPassword or
       the API's `rules`); unknown codes are ignored, never shown. */
    passwordMessage(kind, rules) {
      if (kind === "weak") {
        const known = (rules || []).filter(r => Object.prototype.hasOwnProperty.call(RULE_TEXT, r));
        if (known.length) return "The new password needs " + known.map(r => RULE_TEXT[r]).join(", ") + ".";
        if ((rules || []).includes("same")) return PASSWORD_MESSAGES.same;
        return PASSWORD_MESSAGES.weak;
      }
      if (Object.prototype.hasOwnProperty.call(PASSWORD_MESSAGES, kind)) return PASSWORD_MESSAGES[kind];
      return Logic.messageFor(kind);
    },

    /* The admin assigned this password: recommend a change (never blocking). */
    showAdminHint(user) {
      return !!user && user.password_admin_set === true;
    },

    buildPasswordRequest(current, next, csrfToken) {
      return {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      };
    },

    /* The overall patience while waiting (cold container + resuming database together). */
    expired(startedAt, now) {
      return now - startedAt > GIVE_UP_MS;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  // ----------------------------------------------------------------------------------------- DOM
  const meta = document.querySelector('meta[name="site-api"]');
  const dialog = document.getElementById("login-dialog");
  const account = document.getElementById("account");
  if (!meta || !account || !dialog || typeof dialog.showModal !== "function" || !window.fetch ||
      !window.AbortController) return;
  const canChangePassword = !!(changepw && pwDialog && pwForm && pwHint && pwCurrent && pwNew &&
                               pwRepeat && pwSubmit && pwStatus && pwError && pwUser &&
                               typeof pwDialog.showModal === "function");   // anything missing: the static page stays as it is

  const API = meta.content.replace(/\/+$/, "");
  const $ = id => document.getElementById(id);
  const signin = $("signin"), signout = $("signout"), who = $("who"), whoami = $("whoami");
  const accountStatus = $("account-status");
  const form = $("login-form"), userField = $("login-user"), passField = $("login-pass");
  const loginStatus = $("login-status"), loginError = $("login-error"), submit = $("login-submit");
  const extra = $("extra-cards");
  const changepw = $("changepw"), pwHint = $("pw-hint"), pwDialog = $("pw-dialog");
  const pwForm = $("pw-form"), pwUser = $("pw-user"), pwCurrent = $("pw-current");
  const pwNew = $("pw-new"), pwRepeat = $("pw-repeat"), pwSubmit = $("pw-submit");
  const pwStatus = $("pw-status"), pwError = $("pw-error");
  const pwFields = [pwCurrent, pwNew, pwRepeat];
  let noteTimer = null;

  let csrf = null;
  let busy = false;
  const replaced = new Map();   // section id -> original <li> of a static card (restored on sign-out)
  let extraItems = [];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const remember = on => {
    try { on ? localStorage.setItem(HINT_KEY, "1") : localStorage.removeItem(HINT_KEY); } catch (_err) { /* private mode */ }
  };
  const remembered = () => {
    try { return localStorage.getItem(HINT_KEY) === "1"; } catch (_err) { return false; }
  };

  async function send(path, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const resp = await fetch(API + path, { mode: "cors", credentials: "include", cache: "no-store",
                                              signal: ctl.signal, ...init });
      let body = null;
      try { body = await resp.json(); } catch (_err) { /* 204 or not JSON */ }
      return { type: "response", status: resp.status, body };
    } catch (_err) {
      return { type: "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function dbIsWarm() {
    try {
      const resp = await fetch(API + "/dbstatus", { mode: "cors", credentials: "omit", cache: "no-store" });
      const body = await resp.json();
      return body.warm === true;
    } catch (_err) {
      return false;   // the container itself may still be starting: keep polling
    }
  }

  /* One API call with the two waiting states. onState(kind) is told "cold" / "db_waking" while
     waiting. Resolves {kind, outcome}; kind "unavailable" when the patience ran out. */
  async function call(path, init, onState) {
    const started = Date.now();
    for (;;) {
      const outcome = await send(path, init);
      const kind = Logic.classify(outcome);
      const action = Logic.plan(kind);
      if (action === "done" || action === "fail") return { kind, outcome };
      if (Logic.expired(started, Date.now())) return { kind: "unavailable", outcome };
      onState(kind);
      if (action === "wait_db") {
        while (!(await dbIsWarm())) {
          if (Logic.expired(started, Date.now())) return { kind: "unavailable", outcome };
          await sleep(DB_POLL_MS);
        }
      } else {
        await sleep(COLD_RETRY_MS);
      }
    }
  }

  /* A waiting note that appears only if the answer takes longer than SHOW_AFTER_MS (no flicker)
     and follows the state (cold -> db_waking) once it is visible. */
  function waitNote(set) {
    let kind = "cold", visible = false;
    const timer = setTimeout(() => { visible = true; set(kind); }, SHOW_AFTER_MS);
    return {
      update(next) { kind = next; if (visible) set(next); },
      stop() { clearTimeout(timer); },
    };
  }

  // ---- drawing
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function drawCard(section) {
    const m = Logic.cardModel(section);
    const body = [
      el("span", "pill " + m.badge, m.badgeLabel),
      el("span", "name", m.title),
    ];
    if (m.summary) body.push(el("p", "", m.summary));
    let card;
    if (m.href) {
      card = el("a", "card");
      card.href = m.href;
      card.rel = "noopener";
      body.push(el("span", "go", m.linkLabel + " →"));
    } else {
      card = el("div", "card static");
    }
    card.append(...body);
    const item = el("li");
    item.append(card);
    return { model: m, item };
  }

  function clearSections() {
    extraItems.forEach(item => item.remove());
    extraItems = [];
    replaced.forEach((original, id) => {
      const current = document.querySelector('li[data-section="' + id + '"]');
      if (current) current.replaceWith(original);
    });
    replaced.clear();
    extra.hidden = true;
  }

  function showSections(sections) {
    clearSections();
    (sections || []).forEach(section => {
      const { model, item } = drawCard(section);
      if (!model.id || !model.title) return;
      const slot = document.querySelector('li[data-section="' + CSS.escape(model.id) + '"]');
      if (slot) {   // the real content of a card the static page already shows
        replaced.set(model.id, slot.cloneNode(true));
        item.dataset.section = model.id;
        slot.replaceWith(item);
      } else {
        extra.append(item);
        extraItems.push(item);
      }
    });
    extra.hidden = extraItems.length === 0;
  }

  function showAccount(user) {
    signin.hidden = !!user;
    whoami.hidden = !user;
    who.textContent = user ? user.id : "";
  }

  function setStatus(node, kind) {
    node.textContent = kind ? Logic.messageFor(kind) : "";
    node.hidden = !kind;
    node.classList.toggle("waiting-note", kind === "cold" || kind === "db_waking");
  }

  function showHint(user) {
    if (pwHint) pwHint.hidden = !(canChangePassword && Logic.showAdminHint(user));
  }

  /* A short confirmation / notice under the header (plain text), gone after a few seconds. */
  function notify(text) {
    clearTimeout(noteTimer);
    accountStatus.classList.remove("waiting-note");
    accountStatus.textContent = text;
    accountStatus.hidden = false;
    noteTimer = setTimeout(() => { accountStatus.hidden = true; accountStatus.textContent = ""; }, 8000);
  }

  function applyState(state) {
    csrf = state.csrf || null;
    showAccount(state.user);
    showHint(state.user);
    if (state.user) {
      remember(true);
      showSections(state.sections);
    } else {
      remember(false);
      clearSections();
    }
  }

  // ---- background restore of an earlier sign-in
  async function restore() {
    const note = waitNote(kind => setStatus(accountStatus, kind));
    const result = await call("/me", { method: "GET" }, kind => note.update(kind));
    note.stop();
    if (result.kind === "ok") {
      setStatus(accountStatus, null);
      applyState(result.outcome.body);
    } else {
      setStatus(accountStatus, result.kind === "unavailable" ? "unavailable" : null);
    }
  }

  // ---- sign in
  function openDialog() {
    setStatus(loginStatus, null);
    setStatus(loginError, null);
    dialog.showModal();
    // wake the API (and, through it, the database) while the visitor types
    fetch(API + "/healthz", { mode: "no-cors", credentials: "omit", cache: "no-store" }).catch(() => {});
    fetch(API + "/dbstatus", { mode: "cors", credentials: "omit", cache: "no-store" }).catch(() => {});
  }

  async function doLogin(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = userField.disabled = passField.disabled = true;
    setStatus(loginError, null);
    const note = waitNote(kind => setStatus(loginStatus, kind));
    const result = await call("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: userField.value, password: passField.value }),
    }, kind => note.update(kind));
    note.stop();
    setStatus(loginStatus, null);
    busy = false;
    submit.disabled = userField.disabled = passField.disabled = false;
    if (result.kind === "ok") {
      passField.value = "";
      applyState(result.outcome.body);
      dialog.close();
    } else {
      setStatus(loginError, result.kind);
      passField.select();
    }
  }

  // ---- sign out
  async function doLogout() {
    signout.disabled = true;
    const result = await call("/logout", { method: "POST", headers: { "X-CSRF-Token": csrf || "" } },
                              kind => setStatus(accountStatus, kind));
    signout.disabled = false;
    if (result.kind === "ok") {
      setStatus(accountStatus, null);
      applyState({ user: null, csrf: null, sections: [] });
    } else {
      setStatus(accountStatus, result.kind);   // still signed in: say so, do not pretend
    }
  }

  // ---- change password
  function setPwError(kind, rules) {
    pwError.textContent = kind ? Logic.passwordMessage(kind, rules) : "";
    pwError.hidden = !kind;
  }

  function lockPwForm(on) {
    pwSubmit.disabled = on;
    pwFields.forEach(f => { f.disabled = on; });
  }

  function wipePwForm() {
    pwFields.forEach(f => { f.value = ""; });
  }

  function openPasswordDialog() {
    wipePwForm();
    setStatus(pwStatus, null);
    setPwError(null);
    pwUser.value = who.textContent;   // lets a password manager file the new password under this account
    pwDialog.showModal();
    pwCurrent.focus();
  }

  async function doChangePassword(event) {
    event.preventDefault();
    if (busy) return;
    const problem = Logic.checkNewPassword(pwCurrent.value, pwNew.value, pwRepeat.value);
    if (problem) {
      setPwError(problem.kind, problem.rules);
      return;
    }
    busy = true;
    lockPwForm(true);
    setPwError(null);
    const note = waitNote(kind => setStatus(pwStatus, kind));
    const result = await call("/account/password",
                              Logic.buildPasswordRequest(pwCurrent.value, pwNew.value, csrf),
                              kind => note.update(kind));
    note.stop();
    setStatus(pwStatus, null);
    busy = false;
    lockPwForm(false);
    const kind = result.kind === "unavailable" ? "unavailable" : Logic.classifyPasswordChange(result.outcome);
    if (kind === "ok") {
      wipePwForm();
      pwDialog.close();
      showHint({ password_admin_set: false });
      notify(Logic.passwordMessage("ok"));
    } else if (kind === "signed_out") {
      wipePwForm();
      pwDialog.close();
      applyState({ user: null, csrf: null, sections: [] });
      notify(Logic.passwordMessage("signed_out"));
    } else {
      if (kind === "wrong_current") { pwCurrent.value = ""; pwCurrent.focus(); }
      setPwError(kind, result.outcome && result.outcome.body && result.outcome.body.rules);
    }
  }

  signin.addEventListener("click", openDialog);
  if (canChangePassword) {
    changepw.addEventListener("click", openPasswordDialog);
    $("pw-cancel").addEventListener("click", () => pwDialog.close());
    pwDialog.addEventListener("close", wipePwForm);   // Esc, Cancel, success: nothing stays in the fields
    pwForm.addEventListener("submit", doChangePassword);
  }
  $("login-cancel").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", doLogin);
  signout.addEventListener("click", doLogout);

  account.hidden = false;
  if (remembered()) restore();

  // Back button (bfcache): nothing to reset; a restored page keeps its state.
})();
