# Retro Booth website

Marketing site for Retro Booth (retrobooth.com.au), hosted on Fly.io.

## Layout

- `site/` — the static website (HTML, images, sitemap, robots.txt, llms.txt). Edit pages here.
- `server.js` — small Node server (no dependencies) that serves `site/` and emails enquiries from the homepage form (`POST /api/enquiry`).
- `Dockerfile`, `fly.toml` — Fly.io build and app settings (Sydney region).

## Enquiry email

The form posts to `/api/enquiry`. The server checks the spam trap, rate-limits (5 per connection per 10 minutes), then sends the enquiry through [Resend](https://resend.com) with the visitor's email as the reply-to address.

Set these once as Fly secrets (never commit them):

```sh
fly secrets set RESEND_API_KEY=re_xxx \
  ENQUIRY_TO=hello@retrobooth.com.au \
  ENQUIRY_FROM="Retro Booth website <website@retrobooth.com.au>"
```

`ENQUIRY_FROM` must be on a domain verified in Resend (add the DNS records Resend gives you for retrobooth.com.au).

## Deploy

```sh
brew install flyctl
fly auth login
# App already exists: retro-booth-site-mmim3a (The Instabooth org)
fly secrets set ...                    # see above
fly deploy
fly certs add retrobooth.com.au
fly certs add www.retrobooth.com.au
```

Then point DNS at Fly using the records `fly certs show retrobooth.com.au` prints. After that, `fly deploy` publishes any change.

## Run locally

```sh
node server.js   # http://localhost:8080
```
