/* The page GitHub Pages serves for EVERY path that has no file (404.html). It doubles as the page of
   a private project that has its own address on this site: /a/b asks the site API for the section
   "a-b". Nothing about any project is in this repository; for anybody who may not see it the
   API answers 404 and this stays a plain "page not found".

   Anonymous visitors cause no API request (no cold start from stray traffic): the API is asked only
   when this browser signed in before (the "1" that login.js keeps in localStorage).

   A section with an `app_url` is an app that scales to zero and has its own sign-in (Azure). The
   page then says that the app is starting, polls GET /sections/<id>/wake (the API probes the app,
   so no app host is ever named here or in the CSP) and sends the browser to the app once it
   answers. An "Open now" link is there the whole time.
   No dependencies, no inline code, only text is ever inserted into the page. */
(function () {
  "use strict";

  const COLD_RETRY_MS = 2000;
  const DB_POLL_MS = 3000;
  const WAKE_POLL_MS = 3000;
  const ATTEMPT_TIMEOUT_MS = 45000;
  const GIVE_UP_MS = 150000;        // the API itself (container + database)
  const WAKE_GIVE_UP_MS = 300000;   // the app behind the section
  const SHOW_AFTER_MS = 1200;       // a warm API answers faster: no flicker
  const HINT_KEY = "vojtah.signedin";
  const BADGES = { public: "Public", semi: "Semi-public", request: "On request", private: "Private" };
  const MESSAGES = {
    loading: "Loading…",
    cold: "The server is starting up. Please wait, this can take up to 60 seconds.",
    db_waking: "The database is waking up. This can take up to a minute.",
    missing: "There is no page at this address.",
    signin: "If you were given access to something here, sign in on the start page first.",
    starting: "The app is starting up. Please wait, this can take up to 2 minutes. It opens by itself when it is ready.",
    ready: "The app is ready. Opening…",
    slow: "The app has not answered yet. Try the link below, or reload this page in a minute.",
    unavailable: "The server is not reachable right now. Try again later.",
    error: "Something went wrong. Please try again.",
  };

  // ------------------------------------------------------------------ pure logic (no DOM, no network)
  const Logic = {
    BADGES,
    MESSAGES,

    /* "/a/b" or "/a/b/" -> "a-b"; null for anything that is not 1-3 plain lower-case segments. */
    sectionIdFromPath(pathname) {
      const parts = String(pathname || "").replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length < 1 || parts.length > 3) return null;
      if (!parts.every(p => /^[a-z0-9][a-z0-9-]*$/.test(p))) return null;
      const id = parts.join("-");
      return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(id) ? id : null;
    },

    /* outcome = {type: "network"} | {type: "response", status, body} */
    classify(outcome) {
      if (!outcome || outcome.type === "network") return "cold";   // hang / abort / no CORS headers
      const { status, body } = outcome;
      if (status >= 200 && status < 300) return "ok";
      if (status === 503 && body && body.error === "db_waking") return "db_waking";
      if (status === 502 || status === 503 || status === 504) return "cold";
      if (status === 401 || status === 403 || status === 404) return "hidden";
      return "error";
    },

    /* GET /sections/<id>/wake -> ready | starting | hidden | error. The API was just warm (it
       answered the section), so a hang or a 5xx here only means "keep waiting". */
    classifyWake(outcome) {
      const kind = Logic.classify(outcome);
      if (kind === "ok") return outcome.body && outcome.body.ready === true ? "ready" : "starting";
      if (kind === "cold" || kind === "db_waking") return "starting";
      return kind;
    },

    /* Links: https: and mailto: only; the app itself: https: only. */
    safeUrl(raw, httpsOnly) {
      if (typeof raw !== "string" || !raw) return null;
      try {
        const u = new URL(raw);
        if (u.protocol === "https:") return u.href;
        return !httpsOnly && u.protocol === "mailto:" ? u.href : null;
      } catch (_err) {
        return null;
      }
    },

    /* "GROUP/NAME" -> the group (drawn smaller, slash included) and the name; no "/" = no group. */
    titleParts(title) {
      const t = String(title || "");
      const i = t.lastIndexOf("/");
      return i > 0 && i < t.length - 1 ? { group: t.slice(0, i + 1), name: t.slice(i + 1) } : { group: "", name: t };
    },

    /* A section from the API -> what the DOM layer draws. Unknown badge = the strictest label. */
    pageModel(section) {
      const s = section || {};
      const badge = Object.prototype.hasOwnProperty.call(BADGES, s.badge) ? s.badge : "private";
      return {
        title: String(s.title || ""),
        badge,
        badgeLabel: BADGES[badge],
        summary: s.summary ? String(s.summary) : "",
        href: Logic.safeUrl(s.url, false),
        linkLabel: s.link_label ? String(s.link_label) : "Open",
        appUrl: Logic.safeUrl(s.app_url, true),
      };
    },

    /* The card on the start page links to this very page: do not render that link here. */
    isSelfLink(href, here) {
      try {
        const a = new URL(href), b = new URL(here);
        return a.origin === b.origin && a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
      } catch (_err) {
        return false;
      }
    },

    expired(startedAt, now, limit) {
      return now - startedAt > limit;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  // ----------------------------------------------------------------------------------------- DOM
  const meta = document.querySelector('meta[name="site-api"]');
  const card = document.getElementById("project");
  const status = document.getElementById("status");
  const hint = document.getElementById("signin-hint");
  if (!meta || !card || !status || !hint) return;

  const API = meta.content.replace(/\/+$/, "");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const say = text => { status.textContent = text; status.hidden = !text; };
  const remembered = () => {
    try { return localStorage.getItem(HINT_KEY) === "1"; } catch (_err) { return false; }
  };

  function notFound() {
    say(MESSAGES.missing);
    hint.hidden = false;
  }

  async function send(path) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const resp = await fetch(API + path, { mode: "cors", credentials: "include", cache: "no-store",
                                              signal: ctl.signal });
      let body = null;
      try { body = await resp.json(); } catch (_err) { /* not JSON */ }
      return { type: "response", status: resp.status, body };
    } catch (_err) {
      return { type: "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  function link(href, text) {
    const p = document.createElement("p");
    const a = document.createElement("a");
    a.className = "mail";
    a.href = href;
    a.rel = "noopener";
    a.textContent = text + " →";
    p.append(a);
    return p;
  }

  function nameNode(title) {
    const { group, name } = Logic.titleParts(title);
    const node = document.createElement("span");
    node.className = "name";
    if (group) {
      const small = document.createElement("span");
      small.className = "group";
      small.textContent = group;
      node.append(small);
    }
    node.append(document.createTextNode(name));
    return node;
  }

  function render(m) {
    const pill = document.getElementById("p-pill");
    pill.className = "pill " + m.badge;
    pill.textContent = m.badgeLabel;
    document.getElementById("p-name").replaceWith(Object.assign(nameNode(m.title), { id: "p-name" }));
    const summary = document.getElementById("p-summary");
    summary.textContent = m.summary;
    summary.hidden = !m.summary;
    if (m.appUrl) {
      card.append(link(m.appUrl, "Open now"));
    } else if (m.href && !Logic.isSelfLink(m.href, location.href)) {
      card.append(link(m.href, m.linkLabel));
    }
    document.title = m.title + " · vojtah.cz";
    card.hidden = false;
  }

  async function wake(id, appUrl) {
    const started = Date.now();
    say(MESSAGES.starting);
    for (;;) {
      const kind = Logic.classifyWake(await send("/sections/" + encodeURIComponent(id) + "/wake"));
      if (kind === "ready") { say(MESSAGES.ready); location.replace(appUrl); return; }
      if (kind === "hidden") { notFound(); card.hidden = true; return; }
      if (kind === "error") { say(MESSAGES.error); return; }
      if (Logic.expired(started, Date.now(), WAKE_GIVE_UP_MS)) { say(MESSAGES.slow); return; }
      await sleep(WAKE_POLL_MS);
    }
  }

  async function load() {
    const id = Logic.sectionIdFromPath(location.pathname);
    if (!id || !window.fetch || !window.AbortController || !remembered()) { notFound(); return; }
    say(MESSAGES.loading);
    const started = Date.now();
    for (;;) {
      const outcome = await send("/sections/" + encodeURIComponent(id));
      const kind = Logic.classify(outcome);
      if (kind === "ok") {
        const m = Logic.pageModel(outcome.body);
        render(m);
        if (m.appUrl) await wake(id, m.appUrl);
        else say("");
        return;
      }
      if (kind === "hidden") { notFound(); return; }
      if (kind === "cold" || kind === "db_waking") {
        if (Logic.expired(started, Date.now(), GIVE_UP_MS)) { say(MESSAGES.unavailable); return; }
        if (Date.now() - started > SHOW_AFTER_MS) say(MESSAGES[kind]);
        await sleep(kind === "cold" ? COLD_RETRY_MS : DB_POLL_MS);
        continue;
      }
      say(MESSAGES.error);
      return;
    }
  }

  load();
})();
