/* vojtah.cz: wake the InBody app before opening it.
   The app runs on a Container App that scales to zero after an hour without traffic, so the first
   visit waits ~10-30 s for a cold start. On a click this page pings the app's /healthz (a
   cross-origin no-cors request: only "the server answered" matters, no cookies are sent), shows a
   short "starting" note while it waits, and opens the app as soon as it answers. Without JavaScript
   the card is a plain link and the browser just waits. */
(() => {
  "use strict";
  const link = document.querySelector("a[data-warm]");
  if (!link || !window.fetch || !window.AbortController) return;

  const probe = link.dataset.warm;
  const target = link.href;
  const note = link.querySelector(".warm");
  const SHOW_AFTER_MS = 1200;   // a warm app answers faster: no flicker
  const GIVE_UP_MS = 120000;    // then just open it and let the browser show what it gets
  let busy = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ping() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      await fetch(probe, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctl.signal });
      return true;
    } catch (_err) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function wakeAndOpen() {
    const started = Date.now();
    const reveal = setTimeout(() => {
      link.classList.add("waiting");
      note.hidden = false;
    }, SHOW_AFTER_MS);
    while (Date.now() - started < GIVE_UP_MS) {
      if (await ping()) break;
      await sleep(2000);
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
