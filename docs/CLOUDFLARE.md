# Putting Cloudflare in front

The code half is done and shipped. This is the dashboard half, and the two are
designed together — the steps below refer to settings the API already reads.

**Nothing here is optional if the WAF is to mean anything.** Cloudflare's rules
apply only to traffic that goes through Cloudflare. An origin still reachable at
its own hostname can be addressed directly, and every rule configured at the
edge becomes decorative. Steps 1–3 route traffic through; steps 4–5 are what
stop it being bypassed.

---

## What the code already does

| Setting | Default | Meaning |
|---|---|---|
| `TRUSTED_PROXY_HOPS` | `1` | How many proxies sit in front. Render is one. `X-Forwarded-For` is read this many entries **from the right**. |
| `TRUSTED_PROXY_SECRET` | *(empty)* | Shared with the Cloudflare Transform Rule. While empty, `CF-Connecting-IP` is not trusted at all. |
| `TRUSTED_PROXY_SECRET_HEADER` | `X-Gaadiiq-Origin` | The header carrying it. |
| `REQUIRE_TRUSTED_PROXY` | `false` | Refuse anything that did not come through Cloudflare. Needs the secret too. |

The last one is deliberately two switches. A lock that turns itself on during a
deploy, on a service Cloudflare is not yet fronting, is a total outage on the
exact release meant to harden things.

---

## 1. Add the domain

Cloudflare → **Add a domain** → `gaadiiq.com` → Free plan.

It scans your existing DNS. Check every record came across — particularly the
`CNAME`/`A` records pointing at Vercel and Render — before continuing.

## 2. Change the nameservers at your registrar

Cloudflare gives you two. Replace the current ones at whoever you bought
`gaadiiq.com` from. Propagation is usually minutes, occasionally hours.

Until this is done, nothing else on this page has any effect.

## 3. Proxy the records that matter

In **DNS → Records**, the cloud icon must be **orange** (Proxied), not grey, for:

- `gaadiiq.com` and `www` — the Vercel frontend
- the API record — the Render service

Grey means DNS-only: the traffic bypasses Cloudflare entirely and you get none
of the protection.

> Vercel and Cloudflare both terminate TLS. Set **SSL/TLS → Overview** to **Full
> (strict)**. "Flexible" makes Cloudflare talk to your origin over plain HTTP,
> which is worse than no proxy at all.

## 4. Inject the shared secret

**Rules → Transform Rules → Modify Request Header → Create rule**

- Name: `origin lock`
- If: `Hostname` `equals` your API hostname
- Then: **Set static** — header `X-Gaadiiq-Origin`, value: a long random string

Generate it with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Then set the same value as `TRUSTED_PROXY_SECRET` in the Render dashboard.

This header never reaches a browser, so a client addressing the origin directly
cannot produce it. That is what makes it usable as proof of origin — and it is
why an IP allow-list was not used instead: Cloudflare's ranges change, and a
stale copy fails in the direction that locks out real users.

## 5. Turn the lock on — but only after checking

Set `REQUIRE_TRUSTED_PROXY=true` in Render **after** confirming step 4 works.

To confirm, watch the API log while real traffic flows. The lock logs every
refusal:

```
Refused a request that did not come through the trusted proxy: GET /cars
```

While `REQUIRE_TRUSTED_PROXY` is still `false` nothing is refused, so the safe
sequence is: set the secret, deploy, browse the site, and only flip the lock on
once you have seen ordinary requests succeed.

`/health` is exempt by design. Render's own health check does not come through
Cloudflare, and a liveness probe answered with 403 makes the platform restart a
service that is working perfectly.

## 6. Also lock the origin at Render

The application lock is the second line, not the first. In Render's settings,
restrict inbound traffic to [Cloudflare's published IP
ranges](https://www.cloudflare.com/ips/) so a flood never reaches the process at
all. The application lock still matters: it holds if that list is misconfigured,
or if the service becomes reachable by some other route.

---

## Settings worth turning on while you are there

- **Security → Bots → Bot Fight Mode** — free, and stops the bulk of scripted
  abuse before it costs anything.
- **Security → WAF → Managed rules** — the free managed ruleset.
- **Security → Settings → Security Level: High** during an incident, and know
  where **"I'm Under Attack"** is *before* you need it.
- **Rate limiting rules** — Cloudflare's own, at the edge. Ours runs after the
  request has already reached Python and been parsed; theirs runs before it
  leaves their network. They are not redundant, they are different layers.
- **Caching** — the brand grid and catalogue reads are the cheapest thing to
  serve from cache and the most expensive to serve from Postgres.

---

## What this does and does not fix

**Does:** volumetric floods, most scripted abuse, and direct-to-origin access
once steps 4–6 are done.

**Does not:** an attacker with a botnet of real browsers hitting real endpoints
slowly enough to look human. That is what the application rate limits are for,
and why both layers exist.
