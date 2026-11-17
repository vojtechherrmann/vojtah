/* A project page whose content is NOT in this repository: the text comes from the site API
   (GET /sections/<id>) and only for a signed-in visitor who may see it. For everybody else the API
   answers 404 (missing, inactive and forbidden look the same), and this page shows a neutral
   message. The id is read from ?id=<section id>; nothing about any project is published here.
   No dependencies, no inline code, only text is ever inserted into the page. */
(function () {
  "use strict";

  const COLD_RETRY_MS = 2000;
  const DB_POLL_MS = 3000;
  const ATTEMPT_TIMEOUT_MS = 45000;
  const GIVE_UP_MS = 150000;
  const SHOW_AFTER_MS = 1200;   // a warm API answers faster: no flicker
  const BADGES = { public: "Public", semi: "Semi-public", request: "On request", private: "Private" };
  const MESSAGES = {
    loading: "Loading…",
    cold: "The server is starting up. Please wait, this can take up to 60 seconds.",
    db_waking: "The database is waking up. This can take up to a minute.",
    hidden: "There is nothing to show here. If you have been invited, sign in on the start page and open the project from there.",
    unavailable: "The server is not reachable right now. Try again later.",
    error: "Something went wrong. Please try again.",
  };

  // ------------------------------------------------------------------ pure logic (no DOM, no network)
  const Logic = {
    BADGES,
    MESSAGES,

    /* ?id=<section id> -> the id, or null when it is missing or not a plain slug. */
    parseId(search) {
      const raw = new URLSearchParams(search || "").get("id");
      return raw && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw) ? raw : null;
    },

    /* outcome = {type: "network"} | {type: "response", status, body} */
    classify(outcome) {
      if (!outcome || outcome.type === "network") return "cold";   // hang / abort / no CORS headers
      const { status, body } = outcome;
      if (status >= 200 && status < 300) return "ok";
      if (status === 503 && body && body.error === "db_waking") return "db_waking";
      if (status === 502 || status === 503 || status === 504) return "cold";   // ingress, no app yet
      if (status === 401 || status === 403 || status === 404) return "hidden";
      return "error";
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
    pageModel(section) {
      const s = section || {};
      const badge = Object.prototype.hasOwnProperty.call(BADGES, s.badge) ? s.badge : "private";
      return {
        title: String(s.title || ""),
        badge,
        badgeLabel: BADGES[badge],
        summary: s.summary ? String(s.summary) : "",
        href: Logic.safeUrl(s.url),
        linkLabel: s.link_label ? String(s.link_label) : "Open",
      };
    },

    expired(startedAt, now) {
      return now - startedAt > GIVE_UP_MS;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  // ----------------------------------------------------------------------------------------- DOM
  const meta = document.querySelector('meta[name="site-api"]');
  const card = document.getElementById("project");
  const status = document.getElementById("status");
  if (!meta || !card || !status || !window.fetch || !window.AbortController) return;

  const API = meta.content.replace(/\/+$/, "");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const say = text => { status.textContent = text; status.hidden = !text; };

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

  function render(section) {
    const m = Logic.pageModel(section);
    const pill = document.getElementById("p-pill");
    pill.className = "pill " + m.badge;
    pill.textContent = m.badgeLabel;
    document.getElementById("p-name").textContent = m.title;
    const summary = document.getElementById("p-summary");
    summary.textContent = m.summary;
    summary.hidden = !m.summary;
    if (m.href) {
      const p = document.createElement("p");
      const a = document.createElement("a");
      a.className = "mail";
      a.href = m.href;
      a.rel = "noopener";
      a.textContent = m.linkLabel + " →";
      p.append(a);
      document.getElementById("p-more").before(p);
    }
    document.title = m.title + " · vojtah.cz";
    say("");
    card.hidden = false;
  }

  async function load() {
    const id = Logic.parseId(location.search);
    if (!id) { say(MESSAGES.hidden); return; }
    const started = Date.now();
    for (;;) {
      const outcome = await send("/sections/" + encodeURIComponent(id));
      const kind = Logic.classify(outcome);
      if (kind === "ok") { render(outcome.body); return; }
      if (kind === "hidden") { say(MESSAGES.hidden); return; }
      if (kind === "cold" || kind === "db_waking") {
        if (Logic.expired(started, Date.now())) { say(MESSAGES.unavailable); return; }
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
