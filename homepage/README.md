# vojtah.cz homepage

Static pages (`index.html`, `style.css`, one small `script.js`, no external requests except the one described below): one card per project
with a visibility label (PUBLIC green, SEMI-PUBLIC yellow, ON REQUEST pink; legend at the bottom).
Today: AI FOR LIFE (public, a work-in-progress page `ai-for-life/`), InBody Aggregator (semi-public, links to `https://inbody.vojtah.cz/`) and two on-request
projects whose pages (`cimrmani/`, `euforie/`) show only a contact link, no content. Descriptions of
private projects are deliberately not published.

It is **not** part of the web app: the InBody app lives in its own repository (`inbody-aggregator`) on an Azure
Container App at `inbody.vojtah.cz`; the apex `vojtah.cz` serves this folder.

Hosting: GitHub Pages from this folder (free, HTTPS certificate included) via the manual workflow
`.github/workflows/homepage-pages.yml`. `CNAME` holds the custom domain. DNS at the registrar for
the apex: four `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
`185.199.111.153` (optionally the matching `AAAA`), plus `CNAME www -> <github-user>.github.io`.
Enable Pages once under Settings > Pages > Source: GitHub Actions.

## Waking the app

The InBody app scales to zero after an hour without traffic, so the first visit waits ~10-30 s for a
cold start. `script.js` handles a click on the InBody card: it pings `https://inbody.vojtah.cz/healthz`
(cross-origin `no-cors` fetch, no cookies; only "the server answered" matters), shows "The app is
starting up. Please wait, this can take up to 60 seconds." if that takes longer than 1.2 s, and opens
the app as soon as it answers (after 2 minutes it opens it anyway). Ctrl / Cmd / middle click and the
no-JavaScript case are a plain link. The probe URL is the `data-warm` attribute of the card.

## Optional sign-in

`login.js` (one file, no dependencies, no inline code) adds a small "Sign in" link in the top right
and a `<dialog>` with the form. It talks to the site API (code in a private repository; only its public host `https://api.vojtah.cz`,
named in `<meta name="site-api">`, appears here) with `fetch(..., credentials: "include")`; after a successful sign-in it
shows the user's name with "Sign out" and draws the sections `GET /me` returns: new cards, or the
real content of a static card that has `data-section="<id>"` (`cimrmani`, `euforie`; restored on
sign-out). Everything private comes from the API after authorization, never from these files.

The static page is complete without it: the UI is `hidden` until the script has run, anonymous
visitors never contact the API, and an unreachable API changes nothing. Two waiting states are
shown: "The server is starting up. Please wait, this can take up to 30 seconds." (the API container
scales to zero) and "The database is waking up. This can take up to a minute." (the API answers 503
`db_waking`; the page polls `/dbstatus` every 3 s and continues by itself). Only a `1` is kept in
localStorage (so the next visit restores the session in the background). The `<meta>` CSP in
`index.html` names the API host: change both together. Tests: `tests/` (`node --test tests`).
