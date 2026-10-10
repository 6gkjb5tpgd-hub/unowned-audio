// Unowned Audio: tiny accounts + contributions API. No emails, no IPs stored, no analytics.
const enc = new TextEncoder();
const B32 = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 chars, no look-alikes
const WEEK = 7 * 86400;
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...h } });
const err = (m, s = 400) => J({ error: m }, s);
const now = () => Math.floor(Date.now() / 1000);
const hour = () => new Date().toISOString().slice(0, 13);
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max);

function rand(n) {
  let out = "";
  while (out.length < n) for (const x of crypto.getRandomValues(new Uint8Array(n * 2))) if (x < 248 && out.length < n) out += B32[x % 31];
  return out;
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
const eq = (a, b) => a.length === b.length && crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));

async function mk(env, kind, id) {
  const payload = `${kind}.${id}.${now() + WEEK}`;
  return `${payload}.${await hmac(env.SESSION_KEY, payload)}`;
}
const setCookie = (t, secure) => ["s=" + t, "Path=/", "HttpOnly", secure && "Secure", "SameSite=Strict", "Max-Age=" + (t ? WEEK : 0)].filter(Boolean).join("; ");
const today = () => new Date().toISOString().slice(0, 10);
async function session(req, env) {
  const m = /(?:^|;\s*)s=([^;]+)/.exec(req.headers.get("Cookie") || "");
  if (!m) return null;
  const [kind, id, exp, sig] = m[1].split(".");
  if (!sig || +exp < now()) return null;
  if (!eq(sig, await hmac(env.SESSION_KEY, `${kind}.${id}.${exp}`))) return null;
  return { kind, id };
}
async function limit(env, bucket, max) {
  const r = await env.DB.prepare("INSERT INTO rate(bucket,n) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n").bind(bucket).first();
  return r.n <= max;
}
function fields(b) {
  const title = clean(b.title, 120), author = clean(b.author, 120), url = clean(b.archive_url, 300);
  const lic = clean(b.licence_note, 600), notes = clean(b.content_notes, 400), status = b.status === "published" ? "published" : "claimed";
  if (!title) return { e: "Please give it a title." };
  if (url) {
    let u; try { u = new URL(url); } catch (x) { return { e: "That link isn't a valid web address." }; }
    if (u.protocol !== "https:" || !/^(www\.)?archive\.org$/.test(u.hostname) || !u.pathname.startsWith("/details/"))
      return { e: "The link must be an archive.org item page, starting with https://archive.org/details/" };
  }
  if (status === "published" && !url) return { e: "A published recording needs its archive.org link." };
  return { title, author, url, lic, notes, status };
}
const COLS = "c.id,c.title,c.author,c.archive_url,c.licence_note,c.content_notes,c.status,c.updated";

async function route(req, env) {
  const url = new URL(req.url), p = url.pathname, m = req.method;
  if (m !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) return err("Bad request", 415);
  for (const k of ["SESSION_KEY", "PEPPER", "ADMIN_SECRET"]) if (!env[k]) { console.error("Missing secret: " + k); return err("The server isn't set up yet (missing " + k + "). If you run this site, see the README.", 503); }
  if (!env.DB) { console.error("Missing D1 binding DB"); return err("The server isn't set up yet (database not connected).", 503); }
  const body = m === "GET" ? {} : await req.json().catch(() => ({}));
  const S = await session(req, env);
  const uid = S && S.kind === "u" ? S.id : null, admin = S && S.kind === "a";
  const DB = env.DB, ck = t => setCookie(t, url.protocol === "https:");

  if (p === "/api/session" && m === "GET") {
    if (admin) return J({ admin: true });
    if (!uid) return J({ loggedIn: false });
    const u = await DB.prepare("SELECT handle FROM users WHERE id=?").bind(uid).first();
    return J(u ? { loggedIn: true, handle: u.handle } : { loggedIn: false });
  }
  if (p === "/api/contributions" && m === "GET") {
    const r = await DB.prepare(`SELECT ${COLS}, u.handle, (c.user_id=?1) AS own, EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id=?1 AND b.contribution_id=c.id) AS saved FROM contributions c JOIN users u ON u.id=c.user_id WHERE c.removed=0 ORDER BY c.updated DESC, c.id DESC LIMIT 500`).bind(uid || "").all();
    return J(r.results.map(x => ({ ...x, own: !!x.own, saved: !!x.saved })));
  }
  if (p === "/api/signup" && m === "POST") {
    if (!await limit(env, "signup:" + hour(), 20)) return err("Too many new accounts right now. Please try again in an hour.", 429);
    let id; for (let i = 0; i < 5; i++) { id = rand(8); if (!await DB.prepare("SELECT 1 FROM users WHERE id=?").bind(id).first()) break; }
    const secret = rand(20);
    await DB.prepare("INSERT INTO users(id,secret_hash,handle) VALUES(?,?,?)").bind(id, await hmac(env.PEPPER, secret), clean(body.handle, 30)).run();
    return J({ key: (id + secret).match(/.{4}/g).join("-") }, 200, { "Set-Cookie": ck(await mk(env, "u", id)) });
  }
  if (p === "/api/login" && m === "POST") {
    const raw = String(body.key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (raw.length !== 28) return err("That key doesn't look right.", 401);
    const id = raw.slice(0, 8), u = await DB.prepare("SELECT secret_hash FROM users WHERE id=?").bind(id).first();
    if (!u || !eq(u.secret_hash, await hmac(env.PEPPER, raw.slice(8)))) return err("That key doesn't match an account.", 401);
    return J({ ok: true }, 200, { "Set-Cookie": ck(await mk(env, "u", id)) });
  }
  if (p === "/api/logout" && m === "POST") return J({ ok: true }, 200, { "Set-Cookie": ck("") });

  if (p === "/api/admin/login" && m === "POST") {
    if (!await limit(env, "admin:" + hour(), 10)) return err("Too many attempts. Try again later.", 429);
    const a = await hmac(env.SESSION_KEY, String(body.secret || "")), b = await hmac(env.SESSION_KEY, env.ADMIN_SECRET);
    if (!eq(a, b)) return err("Wrong secret.", 401);
    return J({ ok: true }, 200, { "Set-Cookie": ck(await mk(env, "a", "admin")) });
  }
  if (p.startsWith("/api/admin/")) {
    if (!admin) return err("Not logged in.", 401);
    if (p === "/api/admin/contributions" && m === "GET") {
      const r = await DB.prepare(`SELECT ${COLS}, c.removed, c.removed_reason, u.handle FROM contributions c JOIN users u ON u.id=c.user_id ORDER BY c.updated DESC LIMIT 500`).all();
      return J(r.results);
    }
    const x = /^\/api\/admin\/contributions\/(\d+)\/(remove|restore)$/.exec(p);
    if (x && m === "POST") {
      const rm = x[2] === "remove";
      await DB.prepare("UPDATE contributions SET removed=?, removed_reason=? WHERE id=?").bind(rm ? 1 : 0, rm ? clean(body.reason, 300) : "", +x[1]).run();
      return J({ ok: true });
    }
    const d = /^\/api\/admin\/contributions\/(\d+)$/.exec(p);
    if (d && m === "DELETE") {
      await DB.batch([
        DB.prepare("DELETE FROM bookmarks WHERE contribution_id=?").bind(+d[1]),
        DB.prepare("DELETE FROM contributions WHERE id=?").bind(+d[1]),
      ]);
      return J({ ok: true });
    }
    return err("Not found", 404);
  }

  if (!uid) return err("Please log in.", 401);
  if (p === "/api/me") {
    if (m === "GET") { const u = await DB.prepare("SELECT handle FROM users WHERE id=?").bind(uid).first(); return u ? J({ handle: u.handle }) : err("Please log in.", 401); }
    if (m === "POST") { await DB.prepare("UPDATE users SET handle=? WHERE id=?").bind(clean(body.handle, 30), uid).run(); return J({ ok: true }); }
    if (m === "DELETE") {
      await DB.batch([
        DB.prepare("DELETE FROM bookmarks WHERE user_id=? OR contribution_id IN (SELECT id FROM contributions WHERE user_id=?)").bind(uid, uid),
        DB.prepare("DELETE FROM contributions WHERE user_id=?").bind(uid),
        DB.prepare("DELETE FROM users WHERE id=?").bind(uid),
      ]);
      return J({ ok: true }, 200, { "Set-Cookie": ck("") });
    }
  }
  if (p === "/api/mine" && m === "GET") {
    const r = await DB.prepare(`SELECT ${COLS}, c.removed, c.removed_reason FROM contributions c WHERE c.user_id=? ORDER BY c.updated DESC`).bind(uid).all();
    return J(r.results);
  }
  if (p === "/api/bookmarks" && m === "GET") {
    const r = await DB.prepare(`SELECT ${COLS}, u.handle FROM bookmarks b JOIN contributions c ON c.id=b.contribution_id JOIN users u ON u.id=c.user_id WHERE b.user_id=? AND c.removed=0 ORDER BY b.rowid DESC`).bind(uid).all();
    return J(r.results);
  }
  const bm = /^\/api\/bookmarks\/(\d+)$/.exec(p);
  if (bm && m === "PUT") {
    if (!await DB.prepare("SELECT 1 FROM contributions WHERE id=? AND removed=0").bind(+bm[1]).first()) return err("That recording isn't available.", 404);
    const n = await DB.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE user_id=?").bind(uid).first();
    if (n.n >= 200) return err("You've reached the limit of 200 bookmarks.");
    await DB.prepare("INSERT OR IGNORE INTO bookmarks(user_id,contribution_id,created) VALUES(?,?,?)").bind(uid, +bm[1], today()).run();
    return J({ ok: true });
  }
  if (bm && m === "DELETE") {
    await DB.prepare("DELETE FROM bookmarks WHERE user_id=? AND contribution_id=?").bind(uid, +bm[1]).run();
    return J({ ok: true });
  }
  if (p === "/api/contributions" && m === "POST") {
    const f = fields(body); if (f.e) return err(f.e);
    const n = await DB.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id=?").bind(uid).first();
    if (n.n >= 50) return err("You've reached the limit of 50 contributions.");
    if (f.status === "claimed") {
      const k = await DB.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id=? AND status='claimed' AND removed=0").bind(uid).first();
      if (k.n >= 2) return err("You can have two open claims at a time. Finish or release one first.");
    }
    await DB.prepare("INSERT INTO contributions(user_id,title,author,archive_url,licence_note,content_notes,status,updated) VALUES(?,?,?,?,?,?,?,?)")
      .bind(uid, f.title, f.author, f.url, f.lic, f.notes, f.status, new Date().toISOString().slice(0, 10)).run();
    return J({ ok: true });
  }
  const c = /^\/api\/contributions\/(\d+)$/.exec(p);
  if (c && m === "PUT") {
    const f = fields(body); if (f.e) return err(f.e);
    if (f.status === "claimed") {
      const k = await DB.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id=? AND status='claimed' AND removed=0 AND id<>?").bind(uid, +c[1]).first();
      if (k.n >= 2) return err("You can have two open claims at a time. Finish or release one first.");
    }
    const r = await DB.prepare("UPDATE contributions SET title=?,author=?,archive_url=?,licence_note=?,content_notes=?,status=?,updated=? WHERE id=? AND user_id=? AND removed=0")
      .bind(f.title, f.author, f.url, f.lic, f.notes, f.status, new Date().toISOString().slice(0, 10), +c[1], uid).run();
    return r.meta.changes ? J({ ok: true }) : err("That contribution can't be edited.", 404);
  }
  if (c && m === "DELETE") {
    if (await DB.prepare("SELECT 1 FROM contributions WHERE id=? AND user_id=?").bind(+c[1], uid).first())
      await DB.batch([
        DB.prepare("DELETE FROM bookmarks WHERE contribution_id=?").bind(+c[1]),
        DB.prepare("DELETE FROM contributions WHERE id=? AND user_id=?").bind(+c[1], uid),
      ]);
    return J({ ok: true });
  }
  return err("Not found", 404);
}
export default { async fetch(req, env) { try { return await route(req, env); } catch (e) { console.error(e && e.stack || e); return err("Something went wrong on our side.", 500); } } };
