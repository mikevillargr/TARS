# The browser container

Chromium in a box, with a display a human can attach to.

The harness does not launch a browser in production. It connects over CDP to
the Chromium living here. Two reasons that split earns a container:

1. **Blast radius.** Page content is untrusted, and prompt injection is the real
   risk of browser automation. A compromised page gets a container with no
   credentials on disk beyond the profile volume, not the harness host holding
   Postgres creds, OAuth tokens and the Anthropic key.
2. **Session lifetime.** Logging into a client portal by hand is tedious enough
   that it must survive a harness restart. The profile is a volume, so
   `pm2 restart tars-harness` does not sign you out of everything.

## What runs inside

| Process | Why |
|---|---|
| `Xvfb :99` | A display. Chromium runs headed so a human can drive it. |
| `launch.py` | Keeps one Chromium alive on the persistent profile, CDP on `127.0.0.1:9221`. |
| `socat` | Republishes CDP on `0.0.0.0:9222`. Chromium binds loopback only and ignores `--remote-debugging-address`; that is deliberate upstream behaviour, not a flag we got wrong. |
| `x11vnc` | Serves `:99` on 5900. |
| `websockify` | noVNC on 6080, so a browser can watch and drive. |

Chromium comes from Playwright's own image, so its revision matches exactly what
the harness's Playwright speaks CDP to. Debian's `chromium` package would drift
and the failure would surface months later as one API quietly misbehaving.

## Security

**CDP is unauthenticated.** Anyone who reaches port 9222 has total control of a
browser holding live logins. Compose binds it to `127.0.0.1` and nginx never
proxies it. Do not publish it.

noVNC is equally dangerous and is gated in nginx by `auth_request` against
`/api/browser/vnc-auth`, which validates the same `tars_token` cookie the rest
of the app uses. Its upstream is loopback-only, so `/browser-vnc/` is the only
door.

Keep the optional toolset members (`javascript_exec`, `file_upload`,
`read_console`, `read_network`) disabled unless a specific task needs them.

## Seeding a login

Agent runs never enter credentials. You do, once, by hand:

1. Open `https://tarsmv.duckdns.org/browser-vnc/` while logged into TARS.
2. Navigate to the site and log in. Paste the password from your vault via the
   noVNC clipboard so it never lives on the server.
3. Close the tab. Don't sign out.

Runs get a fresh isolated context seeded with that profile's cookies, so they
inherit the login without sharing (or being able to disturb) the profile.

Re-seed when the session expires. There is no way around that and it is fine:
it is a few minutes every few weeks.

## Operational notes

- **`docker stop`, never `docker kill`.** Chromium flushes cookies on clean
  shutdown; supervisor allows 25s for it. A hard kill loses anything written
  since the last flush, which can mean a login you just did by hand.
- **Session cookies are never persisted**, by browser design. If a site issues
  only a session cookie, the login will not survive a restart. That is the
  site's choice, not a bug here.
- **`shm_size: 1gb` is required.** Docker's 64MB default makes Chromium crash on
  heavy pages.

## Local development

You don't need any of this. With `BROWSER_CDP_URL` unset the harness launches
its own headless Chromium in-process. To exercise the container path locally:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d browser
export BROWSER_CDP_URL=http://127.0.0.1:9222
```
