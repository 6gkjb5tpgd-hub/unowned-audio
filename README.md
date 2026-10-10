# Unowned Audio: setup (free tier)

Needs: a free Cloudflare account and Node.js.

1. `npm i -g wrangler` then `wrangler login`
2. `wrangler d1 create unowned-audio`, then paste the database id into `wrangler.toml`
3. `wrangler d1 execute unowned-audio --remote --file=schema.sql`
4. Make three long random secrets (`openssl rand -base64 32`) and store them in your password manager:
   - `wrangler secret put ADMIN_SECRET` (your admin login)
   - `wrangler secret put SESSION_KEY`
   - `wrangler secret put PEPPER`
   Changing SESSION_KEY logs everyone out. Changing PEPPER locks everyone out of their accounts, so never change it.
5. `wrangler deploy`
6. In the Cloudflare dashboard: leave Web Analytics off. Optionally add a rate-limit rule for `/api/signup`.

Admin page: `/admin.html`. Your styling goes in `public/style.css`.
`recording-guide.md` needs converting to `recording-guide.html` (pandoc, or paste into your own template).

## Local development

`wrangler dev` uses its own local database, separate from the remote one. Set it up once (re-run after schema changes, it is safe to repeat):

```
npx wrangler d1 execute unowned-audio --local --file=schema.sql
npx wrangler dev
```

`.dev.vars` needs `ADMIN_SECRET`, `SESSION_KEY` and `PEPPER`. If you see "no such table", you skipped the first command.
