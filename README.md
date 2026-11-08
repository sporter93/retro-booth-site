# Retro Booth website

Marketing site for Retro Booth: commercial photo booths that venues own.

Static site, no build step. Live at https://retrobooth.com.au (Netlify, deploys from `main`).

## Files

- `index.html`: the homepage (pre-rendered HTML with JSON-LD structured data)
- `robots.txt`, `sitemap.xml`, `llms.txt`: search and AI crawler files
- `favicon.*`, `apple-touch-icon.png`, `icon-*.png`, `site.webmanifest`: icons
- `assets/`: photos used on the page

## Enquiry form

The enquiry form uses Netlify Forms (form name `enquiry`, honeypot field `bot-field`). Submissions appear in the Netlify dashboard under Forms. Email notifications are set in the Netlify site's form notification settings.
