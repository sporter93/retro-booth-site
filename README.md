# Retro Booth website

Marketing site for Retro Booth (retrobooth.com.au), hosted on Fly.io.

## Layout

- `site/` — the static website (HTML, images, sitemap, robots.txt, llms.txt). Edit pages here.
- `server.js` — small Node server (no dependencies) that serves `site/` and emails enquiries from the homepage form (`POST /api/enquiry`).
- `Dockerfile`, `fly.toml` — Fly.io build and app settings (Sydney region).

## Enquiry email (Microsoft 365)

The form posts to `/api/enquiry`. The server checks the spam trap, rate-limits (5 per connection per 10 minutes), then sends the enquiry through Microsoft 365 (Microsoft Graph `sendMail`) from `hello@retrobooth.com.au`, with the visitor's email as the reply-to address. A copy is saved in the mailbox's Sent Items.

One-off setup in Microsoft 365:

1. Add `retrobooth.com.au` as a domain in the Microsoft 365 admin centre and add its DNS records (MX, SPF, autodiscover).
2. Create a shared mailbox `hello@retrobooth.com.au`.
3. In the Entra admin centre, create an app registration ("Retro Booth website"), add the Microsoft Graph **application** permission `Mail.Send`, grant admin consent, and create a client secret.
4. Recommended: limit the app to the shared mailbox only (Exchange RBAC for Applications or an application access policy).

Then set the Fly secrets (never commit them):

```sh
fly secrets set MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
  MAIL_FROM=hello@retrobooth.com.au ENQUIRY_TO=hello@retrobooth.com.au
```

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
