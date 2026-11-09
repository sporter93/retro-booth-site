# Retro Booth website

Marketing site for Retro Booth (retrobooth.com.au), hosted on Fly.io.

## Layout

- `site/` — the static website (HTML, images, sitemap, robots.txt, llms.txt). Edit pages here.
- `server.js` — small Node server (no dependencies) that serves `site/` and emails enquiries from the homepage form (`POST /api/enquiry`).
- `Dockerfile`, `fly.toml` — Fly.io build and app settings (Sydney region).

## Enquiry email (Resend)

The form posts to `/api/enquiry`. The server checks the spam trap, rate-limits (5 per connection per 10 minutes), then sends the enquiry through [Resend](https://resend.com) from the verified `mail.retrobooth.com.au` domain, with the visitor's email as the reply-to address.

One-off setup in Resend:

1. Add and verify the sending domain `mail.retrobooth.com.au` in Resend, adding the DKIM/SPF/MX/CNAME records it provides (DNS for retrobooth.com.au is managed in the Microsoft 365 admin centre).
2. Create a **sending-only** API key restricted to that domain.

Then set the Fly secrets (never commit them):

```sh
fly secrets set RESEND_API_KEY=re_... \
  MAIL_FROM='Retro Booth <enquiries@mail.retrobooth.com.au>' \
  ENQUIRY_TO=hello@retrobooth.com.au
```

The sender must be an address on the Resend-verified domain (`mail.retrobooth.com.au`); notifications are delivered to `ENQUIRY_TO` (any address).

## Deploy

```sh
brew install flyctl
fly auth login
# App already exists: retro-booth-site-mmim3a (The Instabooth org)
fly deploy
fly certs add retrobooth.com.au
fly certs add www.retrobooth.com.au
```

Then add the DNS records `fly certs show retrobooth.com.au` prints. DNS for retrobooth.com.au is managed in the Microsoft 365 admin centre (Settings → Domains → retrobooth.com.au → DNS records). After that, `fly deploy` publishes any change.

## Run locally

```sh
node server.js   # http://localhost:8080
```

## Tests

```sh
node --test test/*.test.js
```

No dependencies. The tests start the real server on a free port; the enquiry tests send to a local stub of the Resend API with a dummy key, so no email goes out. `SHOW_PAYLOAD=1` prints what the stub receives.
