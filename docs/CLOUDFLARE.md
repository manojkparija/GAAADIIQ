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
---

## 7. Caching (point 3)

**The code half is done.** Every response now carries a `Cache-Control` header —
`core/cache_policy.py` decides which. Four catalogue prefixes (`/cars`,
`/upcoming-cars`, `/news`, `/video-reviews`) get
`public, max-age=60, s-maxage=300, stale-while-revalidate=600`; **everything
else gets `no-store`**, deliberately, so a loan application or a mechanic's
record can never be held by an intermediary.

Cloudflare does not cache API responses by default even when they say they are
cacheable, so one rule is needed to opt in:

**Caching → Cache Rules → Create rule**

- Name: `catalogue reads`
- If: `Hostname` `equals` `api.gaadiiq.com` **and** URI Path `starts with` one
  of `/cars` `/upcoming-cars` `/news` `/video-reviews`
- Then: **Eligible for cache**
- Edge TTL: **Use cache-control header if present** — not a fixed number. The
  API is the thing that knows how long its own answers stay true, and hardcoding
  a TTL here means two places to change and one of them will be missed.
- Browser TTL: **Respect origin**

> **Do not add a blanket "cache everything" rule.** The reason the origin sends
> `no-store` on everything else is that most of this API's surface is
> per-caller. A cache rule that ignores the origin's header would override that
> and serve one user's data to another.

**Purging.** There is no purge-on-write hook yet, so `s-maxage=300` is the only
thing bounding how long an admin's catalogue edit stays invisible. After
editing the catalogue, either wait five minutes or **Caching → Configuration →
Purge Everything**. Raise the TTL in `cache_policy.py` only once a purge hook
exists — not before.

## 8. Rate limiting (point 4)

**The application half is already done and is stricter than most people expect.**
`core/limiter.py` applies `300/minute` to *every* route by default, and the
expensive endpoints carry their own tighter limits:

| Endpoint | Limit |
|---|---|
| `POST /diagnosis/analyse` | `5/minute; 20/hour` |
| `POST /diagnosis/stt` | `15/minute; 30/hour` |
| `POST /auth/login` | `5/minute` |
| `POST /auth/otp/verify` | `3/minute` |
| everything else | `300/minute` |

So the "10,000 requests to `/api/ai/diagnosis`" scenario is already bounded at
20/hour per IP — **but only in production** (`enabled=settings.is_production`),
and only after the request has reached Python, been parsed, and consumed a
worker. Cloudflare's rule refuses it before it leaves their network.

**Security → WAF → Rate limiting rules → Create rule**

Two rules, in this order:

**a. AI endpoints**
- If: `Hostname` equals `api.gaadiiq.com` and URI Path `starts with` `/diagnosis`
- Characteristics: **IP**
- Rate: **30 requests per 1 minute**
- Action: **Block**, duration 1 minute

Deliberately looser than the application's own `5/minute` — this rule is there
to stop a flood costing us CPU, not to be the limit. The precise limit stays in
the application, where it can distinguish endpoints and see the user. A tight
edge rule that fires before the app's does takes over that decision from the
place that reasons about it properly.

**b. Everything else**
- If: `Hostname` equals `api.gaadiiq.com`
- Characteristics: **IP**
- Rate: **600 requests per 1 minute**
- Action: **Managed Challenge**, duration 1 minute

Challenge rather than Block: at this rate the likeliest cause is a shared NAT or
a misbehaving client, not an attack, and a challenge lets a real browser through
while stopping a script.

> **`/health` must stay reachable.** If either rule ever grows a path that
> covers it, Render's liveness probe gets challenged and the platform restarts a
> service that is working. The rules above scope to `/diagnosis` and to a rate
> no probe approaches, so neither does today.

**Watch before you tighten.** Both rules can be created in **Log** action first
and switched to Block/Challenge after a day of real traffic. On a site with no
traffic baseline, a limit set from a guess is as likely to catch you as an
attacker.

### If you only get one rule

Pro's rate-limiting quota is shown in the rule builder; check it before writing
both. If it turns out to be one, spend it on **b, the global rule**, not on the
AI one — which is the opposite of what the threat model suggests and is worth
the paragraph:

`/diagnosis` is already bounded in code at `5/minute; 20/hour` per IP, so a
flood there gets cheap 429s from Python. Everything else sits on the `300/minute`
default, which is a great many Postgres queries. The global rule covers
`/diagnosis` *and* the rest; the AI rule covers one path the application already
guards well. More coverage per rule.

---

## What an edge rule cannot do

It is tempting to reach for a WAF custom rule to keep the public out during
testing — block everything whose `Origin` is not ours. **That does not work, and
it is worth writing down why so nobody spends an afternoon on it.**

The Android app's origin is `https://localhost`. `capacitor.config.ts` sets
`androidScheme: 'https'` and no `hostname`, so the WebView serves the bundle
from there; it is already in `allowed_origins` and pinned by
`tests/test_cors_android_app.py`, which exists because getting it wrong once
made the APK show "0 listings found" and "Could not reach the speech service" —
a CORS refusal never reaches JavaScript, so neither message could name the
cause.

Two consequences:

1. **A rule allowing only our origins must include `https://localhost`** — and
   the moment it does, it admits anyone, because that is also the origin of
   every developer's local page.
2. **`Origin` is client-controlled anyway.** `curl -H "Origin: https://localhost"`
   produces it. Any header a browser sends, an attacker can send. This is the
   same reason `CF-Connecting-IP` is only trusted behind the shared secret in
   step 4 — and the same reason CORS is not an access control: it stops a
   *browser on another site* reading a response, and stops nothing else.

There is no edge rule that gates access to a public client application, because
anything the client can send, an attacker can copy. The gate is authentication.
If the goal is "not open to the public yet", the controls that actually do it
are **Supabase → disable public sign-ups**, and Vercel **Deployment
Protection** on the frontend — neither of which is a Cloudflare rule.

The one client-side proof that *does* hold is the one in step 4, and it holds
only because the secret is injected by Cloudflare and never travels to a
browser.

---

## What this does and does not fix

**Does:** volumetric floods, most scripted abuse, and direct-to-origin access
once steps 4–6 are done.

**Does not:** an attacker with a botnet of real browsers hitting real endpoints
slowly enough to look human. That is what the application rate limits are for,
and why both layers exist.
