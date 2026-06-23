# Dominion Energy MCP Server

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes your live Dominion Energy account data (grid usage, solar generation, billing, weather, meter info) to any MCP-compatible client.

It runs in Docker, authenticates to Dominion via a real browser (Playwright) so 2FA works, keeps your session token alive, and serves an MCP endpoint you can expose to the public internet with [ngrok](https://ngrok.com) for clients like Claude or ChatGPT.

---

## 1. What you get

- A single Docker container running the MCP server on port `3456`.
- A small admin HTTP server on port `8080` that is **only** used to accept your 2FA code during sign-in.
- A persistent session file at `data/session.json` so you only have to do 2FA once in a while — not on every restart.
- A background poller that refreshes your energy data every 12 hours.
- An MCP endpoint that clients connect to.

You don't need to read or change any code to run this.

---

## 2. Project layout (so you know where things live)

```
.
├── dominionpower-mcp/            <-- the actual app
│   ├── docker-compose.yml        <-- what you run
│   ├── Dockerfile
│   ├── .env                      <-- your login (you create this)
│   ├── data/
│   │   └── session.json          <-- auto-generated, persists your token
│   ├── src/
│   │   ├── config.ts             <-- reads .env
│   │   ├── auth-browser/         <-- Playwright login + 2FA flow
│   │   ├── dominion/             <-- Dominion API client
│   │   ├── server/               <-- cache, background poller, reauth
│   │   └── mastra/               <-- MCP server registration
│   └── package.json
└── .env.example                  <-- template for the login vars
```

Everything that matters is inside `dominionpower-mcp/`. All commands below are run from that directory unless noted.

---

## 3. Prerequisites

- **Docker** + **Docker Compose** (v2; the `docker compose` command, not the legacy `docker-compose`).
- A Dominion Energy account at [dominionenergy.com](https://www.dominionenergy.com).
- Your 12-digit Dominion account number (printed on your bill).
- An [ngrok](https://ngrok.com) account and auth token (free tier is fine).

---

## 4. Configure your login

Create a file at `dominionpower-mcp/.env` with your real credentials:

```dotenv
DOMINION_USERNAME=you@example.com
DOMINION_PASSWORD=your-dominion-password
DOMINION_ACCOUNT_NUMBER=123456789012

# Optional — see "Ports" below
PORT=3456
ADMIN_PORT=8080
LOG_LEVEL=info
```

A template is provided at `dominionpower-mcp/.env.example` (and at the repo root as `.env.example`).

> **Security note:** `.env` is git-ignored. Treat it like a password file. Do not commit it. Do not share it.

---

## 5. Ports

The container publishes two ports to your host. Both are configurable via `.env`:

| Variable       | Default | What it is                                                           |
| -------------- | ------- | -------------------------------------------------------------------- |
| `PORT`         | `3456`  | The MCP server (and health check at `/health`).                      |
| `ADMIN_PORT`   | `8080`  | A tiny admin server used **only** for 2FA code entry. See below.     |

To change them, edit `.env`:

```dotenv
PORT=4000
ADMIN_PORT=9000
```

Then `docker compose down && docker compose up -d` to apply.

> Don't expose `ADMIN_PORT` to the public internet (and don't put it in your ngrok tunnel). It has no auth on the 2FA form.

---

## 6. Run it

From the `dominionpower-mcp/` directory:

```bash
docker compose up -d --build
```

The first run will:

1. Build the image (a few minutes — it includes Chromium for Playwright).
2. Start the container.
3. Launch a headless browser, navigate to Dominion, and try to log in with the credentials from `.env`.
4. If Dominion sends a 2FA code, **the server will start up and wait for you to enter it**. See the next step.

Watch the logs with:

```bash
docker compose logs -f
```

---

## 7. Entering the 2FA code

When 2FA is required, the container logs a line like:

```
[dominion-mcp] TFA code sent. Starting auth server for code entry.
[dominion-mcp] TFA entry UI at http://localhost:8080/admin/tfa
```

On the **same machine** that is running the container, open:

```
http://localhost:8080/admin/tfa
```

Type the 2FA code your phone/email just received and submit. The server will:

- Verify the code with Dominion.
- Store the resulting access token, refresh token, and cookies in `data/session.json`.
- Close the admin server.
- Start the background poller.

> The admin server only listens while 2FA is pending. Once auth completes, port `8080` is no longer in use.

If the code is wrong or expires, the server restarts the auth flow and you'll be prompted again the same way.

---

## 8. Token is kept alive automatically

You don't have to do anything to keep the token fresh. The server:

- Persists `token`, `refresh_token`, `token_expires`, `uuid`, and `cookies` to `data/session.json`.
- On every container start, it loads that file and silently refreshes the access token using the refresh token.
- A background poller refreshes your energy data every **12 hours**. If it ever detects a hard auth failure, it triggers a fresh login flow — which will again ask for a 2FA code at `http://localhost:8080/admin/tfa`.

In normal use you should only need to enter a 2FA code on the very first start, and occasionally afterwards when Dominion forces re-verification. **Do not delete `data/session.json` unless you want to re-authenticate from scratch.**

Because `docker-compose.yml` mounts `./data:/data`, your session survives container rebuilds and restarts.

---

## 9. Expose it with ngrok

The MCP server speaks HTTP on `PORT` (default `3456`). To use it from a remote MCP client (Claude, ChatGPT connectors, etc.), tunnel it with ngrok.

### One-time setup

```bash
ngrok config add-authtoken <your-ngrok-authtoken>
```

### Start the tunnel

```bash
ngrok http 3456
```

ngrok will print a public URL like `https://abc123.ngrok-free.app`. Your MCP endpoint is:

```
https://abc123.ngrok-free.app/api/mcp/dominion-energy/mcp
```

That's the URL you paste into your MCP client.

### If you changed `PORT`

```bash
ngrok http <PORT>
```

And the URL becomes:

```
https://<your-subdomain>.ngrok-free.app/api/mcp/dominion-energy/mcp
```

### (Optional) Reserve a stable subdomain

With a paid ngrok plan:

```bash
ngrok http 3456 --domain=your-name.ngrok.app
```

So your final MCP URL is always:

```
https://your-name.ngrok.app/api/mcp/dominion-energy/mcp
```

### Quick sanity checks

From the host machine:

```bash
# Health
curl http://localhost:3456/health

# From anywhere, via ngrok
curl https://abc123.ngrok-free.app/health
```

Both should return `200 OK`.

---

## 10. Connect a client

In your MCP client (Claude Desktop, Claude.ai, ChatGPT, Cursor, etc.), add a remote MCP server with:

- **URL:** `https://<your-ngrok-host>/api/mcp/dominion-energy/mcp`
- **Transport:** Streamable HTTP (the default for this server).

The server exposes tools like `getSensors`, `getSensor`, `getDailyUsage`, `getMonthlyUsage`, `getBillHistory`, and `getHealth`.

---

## 11. Common operations

```bash
# Start
docker compose up -d --build

# Logs
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose restart

# Wipe session and force re-auth (will require 2FA again)
docker compose down
rm dominionpower-mcp/data/session.json
docker compose up -d

# Update to the latest image
docker compose pull
docker compose up -d --build
```

---

## 12. Troubleshooting

**"Initial auth flow failed" in the logs, but no TFA prompt appeared.**
Open `http://localhost:8080/admin/tfa` — the server may be waiting there even if it didn't log it. If the page won't load, check that `ADMIN_PORT` is published and that nothing else on the host is using it.

**2FA form won't load.**
You're probably trying to reach it from a different machine. The admin server only listens on the host's `localhost`. SSH-tunnel if needed:
`ssh -L 8080:localhost:8080 user@host` then open `http://localhost:8080/admin/tfa` locally.

**ngrok tunnel works but the MCP client can't connect.**
- Make sure the URL ends in `/api/mcp/dominion-energy/mcp` (note the trailing `/mcp`).
- Free ngrok URLs change every restart. Use a reserved domain or restart the client with the new URL.

**Poller keeps erroring.**
Check `docker compose logs -f`. If the session is dead, delete `data/session.json` and restart to force a clean re-auth.

**Port already in use.**
Change `PORT` and/or `ADMIN_PORT` in `.env` and restart.

---

## 13. License & data

This project is a self-hosted bridge to your own Dominion Energy account. Your credentials never leave the container except to authenticate directly with `dominionenergy.com`. The cached usage/billing data lives only in the container and is exposed back to you via the MCP tools.
