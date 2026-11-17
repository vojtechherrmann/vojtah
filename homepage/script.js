/* vojtah.cz: wake the InBody app before opening it, and wait IN the card (no page in between).
   The app runs on a Container App that scales to zero, and its database (Azure SQL free offer)
   auto-pauses. On a click this page polls the app's /dbstatus (CORS for this origin only; the
   InBody session cookie comes along because both hosts are the same site) and opens the app when:
     - the container answers, AND
     - the database is warm, or the visitor has no InBody session and is not signed in here (the
       front page needs no database; /dbstatus starts the warm-up anyway).
   Otherwise the app would show its own "Starting the database" page. A short note in the card says
   what we are waiting for. Without JavaScript the card is a plain link and the browser just waits.

   Single sign-on: the accounts of this site and of InBody are the same. A visitor signed in here
   (the "1" login.js keeps in localStorage) gets a one-time ticket from the site API
   (POST /sso/inbody) once the app is up, and the browser opens the app's /sso?t=<ticket> (the
   card's data-sso), which signs them in there without a second login. If anything about that
   fails, the app opens as before, at its own login. */
(() => {
  "use strict";

  const MESSAGES = {
    cold: "The app is starting up. Please wait, this can take up to 60 seconds.",
    db: "The database is waking up. This can take up to a minute.",
    signin: "Signing you in…",
  };

  const Logic = {
    MESSAGES,
    /* outcome = {type: "network"} | {type: "response", status, body} -> cold | db | go.
       needDb: the visitor will be signed in (single sign-on), so the database must be warm. */
    classify(outcome, needDb) {
      if (!outcome || outcome.type === "network") return "cold";   // hang, abort, no CORS headers
      const { status, body } = outcome;
      if (status >= 500) return "cold";                             // ingress, no replica yet
      if (status !== 200 || !body) return "go";                     // let the app answer itself
      return body.warm === true || (!needDb && body.session === false) ? "go" : "db";
    },

    /* POST /sso/inbody -> the ticket, "retry" (API or its database starting), or null (no
       session here any more, an error: open the app without single sign-on). */
    ticketOf(outcome) {
      if (!outcome || outcome.type === "network") return "retry";
      const { status, body } = outcome;
      if (status === 200 && body && typeof body.ticket === "string" && /^[\w-]{20,128}$/.test(body.ticket)) {
        return body.ticket;
      }
      return status === 502 || status === 503 || status === 504 ? "retry" : null;
    },

    /* The app's /sso address with the ticket; only an https: address on the app's own host. */
    ssoUrl(sso, target, ticket) {
      try {
        const u = new URL(sso), t = new URL(target);
        if (u.protocol !== "https:" || u.host !== t.host) return null;
        u.search = "?t=" + encodeURIComponent(ticket);
        return u.href;
      } catch (_err) {
        return null;
      }
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  const link = document.querySelector("a[data-warm]");
  if (!link || !window.fetch || !window.AbortController) return;

  const probe = link.dataset.warm;
  const sso = link.dataset.sso || "";
  const target = link.href;
  const note = link.querySelector(".warm");
  const meta = document.querySelector('meta[name="site-api"]');
  const API = meta ? meta.content.replace(/\/+$/, "") : "";
  const SHOW_AFTER_MS = 1200;   // a warm app answers faster: no flicker
  const RETRY_MS = 2000;
  const GIVE_UP_MS = 150000;    // then just open it and let the browser show what it gets
  const TICKET_GIVE_UP_MS = 30000;
  let busy = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const signedInHere = () => {
    try { return localStorage.getItem("vojtah.signedin") === "1"; } catch (_err) { return false; }
  };

  async function ask(url, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const resp = await fetch(url, { mode: "cors", cache: "no-store", credentials: "include", signal: ctl.signal, ...init });
      let body = null;
      try { body = await resp.json(); } catch (_err) { /* not JSON */ }
      return { type: "response", status: resp.status, body };
    } catch (_err) {
      return { type: "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function ticket() {
    const started = Date.now();
    while (Date.now() - started < TICKET_GIVE_UP_MS) {
      const got = Logic.ticketOf(await ask(API + "/sso/inbody", { method: "POST" }));
      if (got !== "retry") return got;
      await sleep(RETRY_MS);
    }
    return null;
  }

  async function wakeAndOpen() {
    const started = Date.now();
    const single = Boolean(sso && API) && signedInHere();
    let kind = "cold";
    const reveal = setTimeout(() => {
      link.classList.add("waiting");
      note.textContent = MESSAGES[kind];
      note.hidden = false;
    }, SHOW_AFTER_MS);
    while (Date.now() - started < GIVE_UP_MS) {
      kind = Logic.classify(await ask(probe), single);
      if (kind === "go") break;
      if (!note.hidden) note.textContent = MESSAGES[kind];
      await sleep(RETRY_MS);
    }
    let url = target;
    if (single && kind === "go") {
      kind = "signin";
      if (!note.hidden) note.textContent = MESSAGES.signin;
      const t = await ticket();
      url = (t && Logic.ssoUrl(sso, target, t)) || target;
    }
    clearTimeout(reveal);
    window.location.assign(url);
  }

  link.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;   // new tab / window: leave it to the browser
    event.preventDefault();
    if (busy) return;
    busy = true;
    wakeAndOpen();
  });

  // Back button (bfcache): the card must be usable again.
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    busy = false;
    link.classList.remove("waiting");
    note.hidden = true;
  });
})();
