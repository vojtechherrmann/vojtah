/* vojtah.cz: wake the InBody app before opening it, and wait IN the card (no page in between).
   The app runs on a Container App that scales to zero, and its database (Azure SQL free offer)
   auto-pauses. On a click this page polls the app's /dbstatus (CORS for this origin only; the
   InBody session cookie comes along because both hosts are the same site) and opens the app when:
     - the container answers, AND
     - the database is warm, or the visitor has no InBody session (the front page needs no
       database; /dbstatus starts the warm-up anyway, so it is awake by the next click).
   Otherwise the app would show its own "Starting the database" page. A short note in the card says
   what we are waiting for. Without JavaScript the card is a plain link and the browser just waits. */
(() => {
  "use strict";

  const MESSAGES = {
    cold: "The app is starting up. Please wait, this can take up to 60 seconds.",
    db: "The database is waking up. This can take up to a minute.",
  };

  const Logic = {
    MESSAGES,
    /* outcome = {type: "network"} | {type: "response", status, body} -> cold | db | go */
    classify(outcome) {
      if (!outcome || outcome.type === "network") return "cold";   // hang, abort, no CORS headers
      const { status, body } = outcome;
      if (status >= 500) return "cold";                             // ingress, no replica yet
      if (status !== 200 || !body) return "go";                     // let the app answer itself
      return body.warm === true || body.session === false ? "go" : "db";
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  const link = document.querySelector("a[data-warm]");
  if (!link || !window.fetch || !window.AbortController) return;

  const probe = link.dataset.warm;
  const target = link.href;
  const note = link.querySelector(".warm");
  const SHOW_AFTER_MS = 1200;   // a warm app answers faster: no flicker
  const RETRY_MS = 2000;
  const GIVE_UP_MS = 150000;    // then just open it and let the browser show what it gets
  let busy = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ask() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const resp = await fetch(probe, { mode: "cors", cache: "no-store", credentials: "include", signal: ctl.signal });
      let body = null;
      try { body = await resp.json(); } catch (_err) { /* not JSON */ }
      return { type: "response", status: resp.status, body };
    } catch (_err) {
      return { type: "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function wakeAndOpen() {
    const started = Date.now();
    let kind = "cold";
    const reveal = setTimeout(() => {
      link.classList.add("waiting");
      note.textContent = MESSAGES[kind];
      note.hidden = false;
    }, SHOW_AFTER_MS);
    while (Date.now() - started < GIVE_UP_MS) {
      kind = Logic.classify(await ask());
      if (kind === "go") break;
      if (!note.hidden) note.textContent = MESSAGES[kind];
      await sleep(RETRY_MS);
    }
    clearTimeout(reveal);
    window.location.href = target;
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
