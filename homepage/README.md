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

`login.js` (one file, no dependencies, no inline code) adds a "Login" button (a box with a user icon) in the top right; once signed in the same box shows the user name and opens a menu with Change password and Sign out
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
`index.html` names the API host: change both together.

### Change password

When signed in, "Change password" next to "Sign out" opens a second `<dialog>` (current password,
new password, repeat; `autocomplete` = `current-password` / `new-password`, plus a visually hidden
username field for password managers). It posts `{current_password, new_password}` to
`POST /account/password` through the same `send()` / `call()` helpers as sign-in (so the container
cold start and database waking messages are reused) with the session cookie and the session-bound
`X-CSRF-Token` from `/login` / `/me`. Before any request the page checks what it can (current
password given, the two new ones equal, the policy: at least 8 characters, an uppercase letter, a
lowercase letter, a digit, differs from the current one) because the API counts every attempt; the
server stays the authority and answers with rule codes the page turns into plain text
(`textContent` only). Wrong current password, policy miss, too many attempts and an expired session
each have their own message; on success the dialog closes, a short confirmation appears under the
header and the other devices are signed out by the API (this one stays signed in). The fields are
wiped whenever the dialog closes and passwords are never stored, logged or kept anywhere else.
If `/me` reports `user.password_admin_set` (an admin assigned the password), a small non-blocking
hint "Your password was set by the admin - consider changing it." is shown until the password is
changed. The pure parts (`Logic.classifyPasswordChange`, `passwordRules`, `checkNewPassword`,
`passwordMessage`, `showAdminHint`, `buildPasswordRequest`) are tested under node; the policy
numbers must match `config.PASSWORD_MIN_LENGTH` in the API. Tests: `tests/` (`node --test tests`).
