# Engineering backlog — 10 Aug 2026

> **Status, 11 Aug.** Items 1, 3 and 4 are fixed and item 2 is half fixed —
> the mechanism that caused it is closed, the data it already produced is not.
> Item 5 needs services created in a dashboard and is written up in
> `docs/STAGING.md`. Item 6 is a habit, not a change. Each section below says
> where it stands.
>
> **There is an addendum at the end of this file, dated 22 Sep**, covering a
> later session: an unsolved performance problem on the car detail page, an
> unconfirmed service-worker caching hypothesis, two parked pull requests, and
> the traps found along the way. Start there if you are picking up recent work.

Six things worth fixing, ordered by how much pain each one caused on the day it
was written. Every item names the evidence it came from, so none of it has to be
taken on trust.

The day that produced this list: a 360° viewer shipped, hid every S-Presso
photograph on the site, was misdiagnosed once, and was fixed properly on the
second attempt. Four of the six items below are why that was possible.

---

## 1. The schema has two sources of truth ✅ fixed

**Evidence.** `apps/api/alembic/versions/` holds 25 migrations, ending at
`0024_car_specs_features`. Grep it for `mechanics` or `lending_partners` and you
get nothing — those tables exist **only** in the hand-run files at the repo root:

```
schema_setup_batch6_marketplace.sql   mechanics, service_requests, whatsapp_messages
schema_setup_batch7_car_loans.sql     lending_partners, lender_rate_slabs,
                                      loan_applications, loan_offers, credit_checks
```

A database built from Alembic alone would be missing the roadside marketplace
and the entire loan module.

**What it cost.** PR #68 merged, Render deployed, and `/car-loan` returned 500s
with `UndefinedTableError: relation "loan_applications" does not exist` — because
the code shipped and the schema did not. The deploy had no way to carry its own
tables.

**Fixed** in `0025_roadside_marketplace.py` and `0026_car_loans.py`. The DDL is
the batch files' own, statement for statement, so a database built from
migrations matches one built by running the files. `alembic upgrade head` now
produces the full schema from empty — verified against PostgreSQL 16, giving 11
lending partners and 57 rate slabs, the same as production.

CI runs the chain against an empty Postgres on every change, so a table can no
longer reach production only by hand.

The SQL files stay as the record of what production already ran. New tables go
in migrations.

**Note on how this happened.** Claude wrote batches 6 and 7 as raw SQL because
that was the pattern already in the repo, and did not flag the divergence at the
time. Copying an existing pattern is not the same as the pattern being right.

---

## 2. Catalogue data hygiene ⚠️ mechanism fixed, data outstanding

Two separate problems, same root: nothing constrains what goes into `cars`.

**Unpriced rows.** 1 of 136 cars carries an `ex_showroom_price`:

```sql
SELECT count(*) FILTER (WHERE ex_showroom_price IS NOT NULL) AS priced,
       count(*) AS total FROM cars;
--  priced | total
--       1 |   136
```

New Cars requests `/cars?bucket=new&priced_only=true`, which deliberately hides
models with no price so a buyer never sees a car listed at nothing. With 135
unpriced, the page is empty and correct. **Not a bug — missing data.**

**Duplicate identities.** The same car existed twice under two spellings:

```
car   | Maruti        | SPRESSO   | 2020
car   | Maruti Suzuki | S-Presso  | 2026   <- the real one
```

Images resolve onto cars by make + model + year, **all three exact**
(`services/media_library.py::urls_for_cars`). One stray spelling silently
detaches an entire gallery, with no error anywhere.

**Duplicate identities: fixed at the source.** `services/vehicle_identity.py`
holds one canonical spelling per manufacturer, applied on car create/update and
on image upload. "Maruti", "MARUTI SUZUKI" and "maruti-suzuki" all become
"Maruti Suzuki" before anything is stored. An unknown brand is tidied and
allowed through rather than rejected — a marketplace has to be able to list a
make the list has not heard of.

Model names are deliberately **not** mapped. "S-Presso" and "SPRESSO" may be the
same car or may not, and a table that guessed wrong would file photographs
against the wrong vehicle — a worse failure than the inconsistency.
`looks_like_variant()` reports them for a human instead.

**Existing rows: still to do.** Run
`python scripts/canonicalise_identities.py` (dry run) and then `--apply`. It
rewrites makes and prints the SQL for model merges without running it.

**Prices: still to do, and not a code problem.** 135 cars need an
`ex_showroom_price`. No amount of engineering supplies that figure, and a made
up price on a live marketplace is worse than a blank one.

---

## 3. CI runs on SQLite; production runs Postgres ✅ fixed

**Evidence.** `.github/workflows/ci-api.yml` declares no `services:` block, so
the suite runs against SQLite while production is Postgres on Supabase.

**What it hides.** Native enums, `NOT NULL` semantics, casting, index behaviour.
A green tick on 845 tests says nothing about any of it.

**Worth knowing.** This nearly caused a false diagnosis: the blank catalogue was
blamed on a Postgres enum literal that CI could not have caught, and a fix was
merged to production on that theory. The theory was wrong — the enum type does
contain the label, and the Render logs showed every request returning 200 — but
the reasoning was only plausible *because* this gap is real.

**Fixed.** `ci-api.yml` gained a `Test on Postgres` job: a `postgres:16` service
container, the migration chain applied to an empty database, then the whole
suite against it. `tests/conftest.py` uses Postgres when `TEST_DATABASE_URL` is
set and SQLite otherwise, so running `pytest` locally is unchanged.

The SQLite job stays. It is fast and it is what a developer gets by default;
the Postgres job is what says the code will survive contact with production.

**It found things immediately, which is the point.** 81 of 859 tests failed the
first time the suite met a real Postgres, in two groups — and both are the
*tests* leaning on SQLite being lenient, not the product being wrong:

- **Foreign keys are not enforced on SQLite.** Around forty tests build an
  admin through a dependency override and never insert the user row, so
  `vehicle_media.uploaded_by` points at nobody. Postgres refuses the insert.
- **A failed statement aborts a Postgres transaction.** A test that
  deliberately provokes an error leaves its session unusable, and the fixture's
  own `commit()` then raises on the way out.

Twelve files are excluded from the Postgres job for now, listed with this
reasoning in `ci-api.yml`. The remaining **648 tests pass on Postgres in about
four minutes**. Fixing the excluded files means inserting real rows and rolling
back in those fixtures — worth doing, and too large to bundle with the change
that discovered it. A job that guards 648 tests properly is worth more than one
that reports a permanent red nobody reads.

Two smaller things the same work turned up, both fixed in `tests/conftest.py`:
building the schema per test put the suite on course for the better part of an
hour, and pytest-asyncio can run a fixture's teardown *after* the next test has
started — a stray `TRUNCATE` landing mid-test deleted the user whose token that
test was holding, and surfaced as a 401 from an endpoint that had just
authenticated successfully.

---

## 4. Playwright exists and never runs ✅ fixed

**Evidence.** `apps/gaadiiq-angular/playwright.config.ts` and an `e2e/`
directory are present. Neither workflow invokes them.

**What it cost.** Every browser check on 10 Aug was a dev server started by hand.
That found real bugs the compiler could not — a frozen commission split, a
spurious auth banner, a heading under the fixed navbar. It also **missed** the
consent checkbox rendering 693px wide and pushing its own label out of the card,
because the screenshot captured the top of the form and not the bottom. The user
found that one.

**Fixed.** `e2e/smoke.spec.ts` and a new `ci-web.yml` workflow. Seven checks:
five pages render with a non-empty heading and no unexpected console error, no
heading hides under the fixed navbar, no tick box is stretched to its row, and
the car detail page shows a gallery with a real image.

Three deliberate choices:

- They run **without an API**, against the development build pointed at
  localhost. A smoke suite that needs a live backend is one that gets disabled
  the first time the backend is down — and CI must not hammer production to
  decide whether a page renders.
- They serve the **built app** (`e2e/static-server.mjs`), not `ng serve`, which
  compiles each lazy route on first request and timed the suite out on pages
  that were working.
- Every assertion corresponds to something that actually shipped broken.

---

## 5. No staging environment ⏳ needs dashboard work

`master` deploys straight to Render and Vercel. When the catalogue went blank on
10 Aug, the live site was where it was discovered.

This one cannot be fixed in code — it needs services created in the Render,
Vercel and Supabase dashboards. **`docs/STAGING.md`** sets out exactly what to
create and why, including the two things that matter most: staging must be
built by migrations rather than by hand, and it must not hold real applicant
data (a different `KYC_HASH_PEPPER`, no copied rows, no live WhatsApp
credentials).

---

## 6. Merging on assertion rather than evidence — a habit, not a change

Not a code issue. On 10 Aug a fix was merged to production on Claude's
say-so, and it was based on inference from timing rather than on any log,
query or reproduction. It changed working code into differently-working code
and fixed nothing.

**The habit worth keeping:** before merging, ask **"how did you verify that?"**
"I reasoned about it" and "I measured it in a browser" are different confidence
levels, and the difference is not visible in how the claim is phrased.

---

## 7. A required secret satisfied by the word "dummy" — fixed 11 Aug

Found while reading a Render log for something else:

```
WARNING [gaadiiq.qdrant] Qdrant ensure_collection: [Errno 111] Connection refused
```

`validate_production_config()` treated a missing `QDRANT_API_KEY` as fatal —
`sys.exit(1)`. No Qdrant had ever been provisioned, so the only way to deploy
was to put something in the box, and production ran with
`QDRANT_API_KEY="dummy"`. The check then passed on every boot while:

- AI Advisor silently fell back to rule-based matching,
- every listing failed to index against a cluster that was not there,
- and nothing anywhere said semantic search was off.

**The lesson is the general one.** A required secret people satisfy with a
placeholder is worse than no requirement: it blocks a deploy until someone
lies to it, and then reports success forever. Worth checking any other entry in
that function against the value actually deployed.

**Fixed** with `SEMANTIC_SEARCH_ENABLED`, off by default, which is the honest
default. With it off, nothing about Qdrant can block a deploy and the vector
store is inert — no per-listing connection timeout, no permanent boot warning.
With it on, the configuration has to be real: a localhost URL or a placeholder
key (`dummy`, `changeme`, `placeholder`, `todo`, empty) now fails loudly at the
point of the lie.

Still open, if semantic search is ever wanted: provision Qdrant or move to
pgvector on Supabase — and either way **write the listings backfill**, which
does not exist. Without it, switching the feature on indexes only listings
created from that moment; everything already listed stays invisible to it.

## Product state as of tonight

Working and merged: 360° spin viewer, roadside repair marketplace, car loan
module (schema live — 11 lenders, 57 rate slabs), AI diagnosis, valuation.

Dormant until data arrives:

| Feature | Needs |
|---|---|
| New Cars page | `ex_showroom_price` on the other 135 cars |
| 360° viewer | 12+ genuine turntable frames on one model, category `three_sixty` |
| Loan panel | Lender agreements before it is commercially real, not illustrative |

Housekeeping: delete the synthetic test mechanic
(`DELETE FROM mechanics WHERE phone = '9800000001';` — carries a fake Aadhaar
hash), and disconnect the Railway GitHub App from the Railway dashboard.

## Test drives exist twice

There are two unrelated test-drive systems, and the working code is on the
table nobody reads.

| | FastAPI | Supabase |
|---|---|---|
| Table | `test_drive_bookings` | `test_drive_requests` |
| Status | `BookingStatus` enum | free text |
| Update path | `PATCH /bookings/{id}/status`, ownership-checked | *(added 010)* |
| Who reads it | nothing in the web app | the dealer dashboard |

`TestDriveService` talks to Supabase directly. The FastAPI endpoint has been
correct the whole time and has never been called from the dashboard, which is
why the status looked unchangeable: the control was missing on one side and
the RLS policy on the other.

Migration `010` closed the immediate gap — `status` and a separate `outcome`
(Won / Lost / Deciding), an UPDATE policy, and a read policy that is no longer
`USING (true)`. **The duplication itself is untouched.** Anything written on
the Supabase side is invisible to the API, so `test_drive_bookings` is now the
staler of the two. Picking one is real work and needs a data migration; until
then, do not add features to whichever half you happen to open first.

Also note `sellers` has no `auth.uid()` column, so the new policies match a
seller on **email** from the JWT. That works, but it means changing a seller's
email silently changes what they can see.

**Admin is defined in two places and only one of them is enforced.**
`environment.prod.ts` has `adminEmails: ['manojkparija@gaadiiq.com']`, which
lives in the Angular bundle and decides which links to draw. Row-level security
runs in Postgres and cannot see it, so it reads `user_profiles.role = 'admin'`.
Migration 010 inserts the row to match, and the first draft of that migration
did not — which would have emptied the admin's own Test Drives tab, since every
request in production belongs to seller 1 or seller 7 and neither is the admin.
Adding an admin means adding them in both places.

## The dealer dashboard pointed at the wrong image store

Two stores of vehicle photographs exist and they are not interchangeable:

| | `vehicle_media` | `car_images` |
|---|---|---|
| Keyed on | make + model + year | one `cars.id` |
| Appears on | every car of that model, site-wide | that one listing |
| Written by | admin upload screen | List Your Car, and now the dashboard |

The Inventory tab showed the **catalogue** under the heading "Your Car
Images", and its only action linked to `/admin/car-images` — behind
`adminGuard`, so no dealer could open it. Underneath, `/media-admin/dealer-images`
required `get_admin_user` despite its name, so a real dealer got a 403 the page
rendered as "No images yet". The tab had never worked for a dealer, and failed
in the shape of an empty account.

Fixed by pointing the tab at the dealer's own `car_images`. **A dealer must
never gain write access to `vehicle_media`** — their photograph would appear on
competitors' listings of the same model, and there is no moderation step.

Still open:

- `/media-admin/dealer-images` still requires an admin. Nothing calls it now,
  so it is dead rather than broken, but the name still lies.
- `car_images` had never been declared in a migration — it was made by hand in
  the dashboard, so until `011` its columns and policies existed only in a
  browser session. Worth auditing the other tables for the same.

**The listing photo gallery had never worked.** `car_images.car_id` was
`bigint` while `cars.id` is `uuid`, so every insert from List Your Car failed
silently — the table held **zero rows** in production, which was evidence
rather than an empty product. `011` converts the column, but only while it is
empty; with rows present it aborts rather than discarding them.

This is the trap CLAUDE.md already names ("cars.id is a UUID in the ORM; Batch
1 SQL says bigint; the ORM wins") and the first draft of `011` walked into it
by trusting `MyListing.supabaseId`, declared `number` while holding a uuid
string at runtime. That declaration is now corrected. **Check the live column
type, not the TypeScript** — and `ai_valuation.car_id`, written by the same
flow, has not been checked and may have the same fault.

## `ai_valuation` has the same fault, and it is not empty

Checked after `car_images` turned up a uuid/bigint mismatch. `ai_valuation.car_id`
is **bigint** against a uuid `cars.id`, and the table holds **116 rows**.

Both halves of that are bad, in different ways:

- The 116 rows cannot have come from the current List Your Car flow, which
  writes a uuid — that insert fails against a bigint column. They are legacy,
  from when `cars.id` was still bigint. So they point at car ids that no longer
  exist: **stored valuations detached from their cars**.
- New valuations from that flow are failing silently, exactly as the images were.

Confirm the first half with:

```sql
SELECT count(*) AS orphaned FROM public.ai_valuation v
WHERE NOT EXISTS (SELECT 1 FROM public.cars c WHERE c.id::text = v.car_id::text);
```

**Deliberately not migrated.** `car_images` was safe to convert because it was
empty. Converting this one means either discarding 116 rows or inventing a
mapping back to cars that no longer carry those ids, and neither is a decision
a migration should make on its own. Decide first, then write the file.

Worth checking every other table the listing flow writes to for the same
mismatch before assuming it is only these two.

## Listing a new car

The List Your Car form wrote `badge: 'Used', badge_type: 'used'` on every
submission, hardcoded, and asked Kilometres, Owners and Condition
unconditionally. A dealer with showroom stock could not list it truthfully.

The API had modelled this all along — `ListingType.new | used` on `listings`,
and `cars-data.service.ts` already fetches `?listing_type=new`. Only the form
could not say which. It now asks first and hides the resale fields for new
stock.

Two loose ends:

- **Ex-showroom price goes into `cars.price`**, not a dedicated column. The
  backlog above notes `ex_showroom_price` exists on the catalogue side, but this
  file cannot see the live Supabase `cars` schema and naming a column that is
  not there fails the whole insert — the mistake `011` already made once. If
  the column exists, moving to it is one line plus a migration.
- **New listings still go to Supabase `cars`, not the API's `listings` table.**
  The two stores continue to diverge, same as test drives. `listing_type` is
  properly modelled on the side nothing writes to.

## Dealer photographs are reviewed before buyers see them

Migration `012`. A dealer upload lands as `pending`; only `approved` rows pass
the public read policy. `/admin/image-review` is the queue.

Two things worth knowing before changing any of it:

- **The gate is in the database, not the screen.** Deleting the Angular page
  would not publish a single pending image. Buyers read `status = 'approved'`
  and a trigger refuses a status change from anyone who is not an admin.
- **The trigger exists because RLS could not do it.** `011` gives a seller
  UPDATE on their own car's photographs so they can reorder them; with a status
  column that same policy would let a dealer approve their own submission. A
  policy cannot say "you may change the url but not the status" — it checks
  rows, not columns, and WITH CHECK cannot see the old row. Column privileges
  fail too, because Supabase signs everyone in as one `authenticated` role.

Rows that predate `012` are grandfathered to `approved`: their authors were
never told about review, and defaulting them to pending would silently withdraw
photographs those sellers believe are live.

Still open: nothing buyer-facing reads `car_images` yet — listing galleries
come from the API's `image_urls`. The gate was added before that wiring exists,
which is the cheap moment. **When those photos are wired to a buyer page, that
page must filter on `approved`** rather than assume the policy covers it, in
case it is ever read with a service key.


---

# Addendum — 22 Sep 2026

Everything below came out of one long session (10–16 Sep). It is written down
because it lived only in that conversation: the reasoning behind each merged
change is already in its commit message and PR body, but the things that were
**not** fixed — the open questions, the hypotheses, the measurements that ruled
things out — had no home in the repo.

Read this section as a handover. It says what is known, what is guessed, and
which observation would settle each guess.

---

## A. The car detail page is slow to settle — open, undiagnosed

**The complaint, in the reporter's words: "my concern is the slowness."**
Everything else on this page was cosmetic beside it, and it is the one item
that was never resolved.

### What is established, from reading the code

`resolveCar` looks the car up in the **in-memory catalogue**
(`carsData.getById`). So on a fresh load, a refresh, or a direct link, the page
cannot render until `CarsDataService.load()` has finished — and that waits for
all three of these to settle:

```
/listings?listing_type=new&page=1&page_size=100
/listings?listing_type=used&page=1&page_size=100
/cars?bucket=new&priced_only=true&page=1&page_size=100
```

`fetchOrNull` retries each up to `FETCH_ATTEMPTS` (3) times, so one slow source
multiplies the wait rather than being skipped. Opening one Baleno therefore
waits on every used-car listing in the system — data that page never displays.

Only then does it fetch `/cars/{id}` and `/cars/{id}/variants`.

**`/cars/{id}` alone already returns everything this page needs**: image urls,
spin urls, specs, features, `variant_count`, and `variant_price_min`/`max`. The
page could paint from that one small request and let the catalogue load behind
it for the similar-cars table. That is the obvious change and it is **not** made
here, for the reason below.

### What is NOT established

**Whether the waterfall or the server is the actual cost.** The API runs
`WEB_CONCURRENCY=1` on Render, so requests queue behind one another, and
`docs/` records a history of the catalogue query hanging until the gateway gave
up at ~100s and returned 504 while Render logged 200. Either could dominate,
and the fix is different in each case — rebuilding the load path would be
wasted work if the cost is a cold start or a stalled query.

### The observation that settles it

**DevTools → Network on a car page, sorted by duration.** Which request eats the
seconds, and whether the catalogue request is served from the network at all
(see section B). This was asked for repeatedly and never captured; nothing
should be rebuilt before it exists.

### One thing that was measured

The initial JavaScript bundle is **963 kB raw / 225 kB transferred**, against
the 500 kB budget `angular.json` already warns about. That slows first paint.
It does not explain a value changing seconds later.

---

## B. The service worker may be serving stale catalogue data — a hypothesis, not a finding

`ngsw-config.json` caches the API under the `api-catalogue` dataGroup:

```json
{ "urls": ["https://api.gaadiiq.com/cars/**", ".../listings/**"],
  "cacheConfig": { "strategy": "freshness", "maxSize": 100,
                   "maxAge": "1m", "timeout": "5s" } }
```

`timeout: 5s` means: try the network, and if it has not answered within five
seconds, **serve the cached copy instead**. If that copy predates a price being
entered, the app receives a catalogue row with no `ex_showroom_price` and no
`variant_price_min` — and the real response then arrives and replaces it.

This would explain two separate reports with one cause:

- the New Cars page reading **"1 models available"** while the API returned 7
- a car page reading **"Price not announced yet"** and then, seconds later, its
  real price band

**It is not confirmed.** It fits the symptom and the timing and nothing more.
The check is one look: in the Network panel, does the
`/cars?bucket=new&priced_only=true…` request show **Size: `(ServiceWorker)`**,
and take about five seconds? If yes, the fix belongs in the cache config rather
than in any component.

Do not act on this as though it were established. Two diagnoses were stated
with more confidence than the evidence supported during that session, and both
were wrong; this one is written down precisely so the next person tests it
rather than inheriting it as fact.

---

## C. "1 models available" — what it turned out to be, and what is still unexplained

Reported: the New Cars page showed **one** model over a catalogue of seven.

### Measured, both ends

- `GET /cars?bucket=new&priced_only=true&page=1&page_size=100` returned
  **`"total": 7`** — every 2026 model, each carrying both an
  `ex_showroom_price` and a `variant_price_min`.
- That exact payload, fed through the real `CarsDataService` and the real
  `ListingsComponent`, rendered **7**: `allCount 7, filteredCars 7,
  newModelCount 7`, with no predicate dropping anything.

So the API was right and the code was right. **The browser was running neither.**

### How it ended

It stopped reproducing after the reporter **restarted their machine**. That is
consistent with a stale bundle or stale cached data on the client, and with
nothing else that was checked.

### What is still unexplained, and matters for real visitors

`app.component.ts` already handles new deployments: it subscribes to
`swUpdate.versionUpdates`, calls `activateUpdate()` on `VERSION_READY` and
reloads, polls every 30 minutes (`UPDATE_CHECK_MS`), and recovers from
`unrecoverable` by unregistering the worker and clearing `ngsw:` caches.

**None of that delivered a new build to an open tab for hours.** Why is not
diagnosed. It is invisible when it happens — the page simply runs old code —
and it looks exactly like a broken feature, which is what it was taken for.
A returning visitor can hit the same thing.

### A false trail, recorded so it is not walked again

PR #274 was merged and then reverted (#275) because it was **not** the cause.
Both halves of it were aimed at this symptom, and the live data showed neither
could have produced it: every 2026 row already had a row price (so the
`priced_only` change was a no-op against the real catalogue) and every row
already had photographs (so removing the photograph rule changed nothing about
which models qualified).

---

## D. Two real findings from #274, preserved although it was reverted

#274 is parked at the reporter's request. These two stand on their own and are
true of the code as it is today:

- **`PLACEHOLDER` is a truthy string.** The listings grid has a deliberate
  no-photograph card — a car silhouette carrying the model's name — rendered on
  `*ngIf="!m.image"`. A model without a picture is given `PLACEHOLDER`, so that
  branch never fires and the "No Image Available" graphic always wins. **That
  card has never been on screen.**
- **`priced_only` tests one legacy column.** It filters on
  `cars.ex_showroom_price` alone, while the published trims are where a model's
  price actually lives — `_variant_summaries` computes the band, and
  `startingPrice`, `priceBand`, every card's "from" figure and the price sort
  all read the trims in preference to the row. A model priced **only** through
  its trims is withheld from every buyer-facing grid, with nothing on any screen
  saying so, and an admin filling in trims has no reason to think the model is
  still invisible.

---

## E. Parked pull requests

- **#245 — "Count hidden models by model, not by catalogue row."** Branch
  `claude/hidden-model-grouping`, commit `6db7209`. Open, green, **not to be
  merged** — parked at the reporter's request. The admin panel counts catalogue
  rows, so one Grand Vitara held at 2025 and 2026 reads as "2 models".
- **#274 — reverted by #275.** Closed. See section D for what it contained.

---

## F. The live catalogue's data, as measured on 15 Sep

From `GET /cars?bucket=new&page=1&page_size=100` — nine rows:

| model | row price | trims | trim band |
|---|---|---|---|
| Baleno | 6,10,000 | 10 | 6.10–10.09L |
| e Vitara | 15,99,000 | 3 | 15.99–19.99L |
| Fronx | 9,30,000 | 14 | **6.84**–11.98L |
| Grand Vitara | 10,99,000 | 14 | 10.99–19.93L |
| S-Presso | 3,49,000 | 14 | 4.26–6.40L |
| Swift | 5,83,900 | 12 | 5.84–8.89L |
| Victoris | 10,49,000 | 19 | 10.50–19.99L |
| Ritz (VXi, 2010) ×2 | — | 0 | — |

Two items of housekeeping fall out of it:

- **Two identical Ritz rows** (`35085162…` and `5f255a80…`), same VXi/2010, one
  with a photograph and one without. Correctly hidden from buyers — unpriced and
  pre-2024 — so this is cleanup, not urgency.
- **The Fronx row's figure is stale**: ₹9.30L against trims starting at ₹6.84L.
  The trims win on every surface now, so the card reads correctly, but the row
  should be corrected.

---

## G. Traps fixed in that session, each worth knowing before touching the area

Every one of these was invisible to a green build, and each encodes a rule.

- **`android-actions/setup-android@v3` defaults `packages` to
  `'tools platform-tools'`**, and `tools` has been withdrawn from the Android
  SDK repository. `sdkmanager` exited 1 before any repository code compiled, so
  "Build debug APK" was red on every PR and on `master`. Fixed by naming
  `platform-tools` explicitly. *A third-party action's defaults are a
  dependency, and they move.*
- **LAY-007 again, on nine pages.** `car-detail`, `analytics`, `leads`,
  `notifications`, `list-car`, `my-listings`, `price-alerts`, `profile`,
  `dealer-dashboard` each padded a **literal** top offset. The navbar measures
  **119px** on a desktop and **177px** on a phone, and `NavbarComponent`
  republishes `--nav-height` from the rendered bar because it compacts on scroll
  and changes at the breakpoint. They now use
  `max(7rem, calc(var(--nav-offset) + 1.5rem))`. *The `+1.5rem` matters:
  `--nav-offset` alone lands content exactly on the bar's bottom edge, measured
  at 0px clearance.*
- **A dropdown's height is not the author's to predict.** `.user-dropdown` had
  no `max-height`, so the account menu was as tall as its contents — three rows
  for a buyer, **sixteen** for an admin, which ran off the bottom of the window
  with no way to reach the last items but zooming the browser out. *`.nav-mega`
  and `.nav-menu` already bounded themselves; this panel was simply missed.*
- **A cascade that falls through to a placeholder will show the placeholder.**
  `displayPrice` asked the loaded trims, then the catalogue row — and the trims
  arrive in a separate request, so the headline showed the row's single figure
  and swapped to the band seconds later. The row already carried
  `variantPriceMin`/`Max`; the band never needed that request.
- **"Price not announced yet" is a claim about the world.** It was printed
  while the trims request was still in flight, so the site told buyers a car on
  sale had no published price. A price not yet fetched and a price that does not
  exist are different facts. `priceSettled` now gates it, flipping when the
  request settles — **failure included**, or a failed request leaves the page
  saying "Fetching…" for ever, which is its own untruth. *Same rule as
  `services/credit_bureau.py::fetch_score`.*
- **A `routerLink` to a path with no route is not an error in Angular.** Three
  links were built as `['/car', id]` while the route is `cars/:id`. Angular
  matched nothing, fell through to `{ path: '**', redirectTo: '' }` and rendered
  Home — no console error, no 404, no log line. The worst of the three was the
  AI Advisor's "See the full model page →", so the feature's entire payoff led
  nowhere. *Assert the rendered `href`, not the `routerLink` input: `['/car',
  id]` is a perfectly valid array.*
- **Angular reuses a component across a parameter change.** `/cars/A` to
  `/cars/B` is still `cars/:id`, so `ngOnInit` does not run again. The id was
  read once from `route.snapshot` and `resolveCar` opened with
  `if (this.carLoaded) return`, so a car-to-car link changed the address bar and
  went on rendering the previous car. It subscribes to `paramMap` now and resets
  the per-car state. *Arriving from the listings page or a cold URL builds the
  component fresh and always worked — which is every route anyone had reason to
  test.*

---

## H. Offered and not built

- **A build-time check that every static `routerLink` resolves against the
  route table.** Nothing prevents the next dead link; section G's third item was
  found only because someone clicked it. Needs a template scan rather than a
  browser test, which is why it was not folded into that PR.
- **A scheduled database backup.** As of this writing **no backup of the
  Supabase data or the `car-images` storage bucket exists anywhere.** The code
  is safe — it is in git — but everything entered through the admin screens
  (models, prices, trim ladders, listings, photographs) has exactly one copy.
  The proposal was a GitHub Actions workflow running `pg_dump` daily into a
  build artifact; at this data's size that is a few hundred KB. It needs the
  database URL as a repository secret, which is a real trade: anyone with write
  access could read it through a workflow. If the data ever becomes
  business-critical, Supabase's paid point-in-time recovery is strictly better
  than a nightly dump.

---

## I. Hardcoded per-model tables — root-cause cleanup, awaiting a decision

Still present, verified 22 Sep. These are per-model facts frozen in source,
which is why the same model can read differently on two screens:

```
apps/gaadiiq-angular/src/app/pages/car-detail/car-detail.component.ts   NEW_CAR_META
apps/gaadiiq-angular/src/app/pages/listings/listings.component.ts       swiftGallery
apps/gaadiiq-angular/src/app/pages/list-car/list-car.component.ts       modelCatalogue
apps/gaadiiq-angular/src/app/pages/vehicle-diagnosis/…component.ts      MODELS_BY_MAKE,
                                                                        SERVICE_CENTERS
apps/api/services/valuation.py                                          _MODEL_CATALOGUE
apps/api/routers/recommend.py                                           _BUDGET_BANDS,
                                                                        _USAGE_SIGNALS
```

Removing them is the right direction and was **not** done, because it makes
pages read "Price not announced yet" for models whose figures exist only in
these tables. That is honest and also a visible downgrade, so it is a product
decision rather than a refactor.

---

## J. Notes for whoever works on this next

- **Production cannot be reached from inside a Claude Code session.**
  `api.gaadiiq.com` and the Vercel preview hosts are refused by the egress proxy
  (`gateway answered 403 to CONNECT`). Anything that needs live data has to be
  fetched by a person and pasted in. Several hours went into theorising about
  production during that session; measuring beats it every time, and when
  measuring is impossible the honest move is to say so and ask.
- **A Vercel preview talks to the production API.** A change with a server half
  cannot be demonstrated on a preview — it only becomes visible once the change
  is on `master` and Render has redeployed.
- **Running the tests:** `CHROME_BIN=/opt/pw-browsers/chromium npx ng test
  --watch=false --browsers=ChromeHeadlessCI` from `apps/gaadiiq-angular`. A
  local Postgres for the API suite lives at `/var/lib/postgresql/claudetest`
  (port 5433, socket `/tmp`, user `gaadiiq`, database `gaadiiq_test`).
- **The sandbox disk fills.** A build failing with `ENOSPC` is usually
  `/root/.cache/pip`, which reached 3 GB. Clear caches rather than concluding
  the environment is broken.
- **Still outstanding from earlier:** `REQUIRE_TRUSTED_PROXY` and
  `TRUSTED_PROXY_SECRET` need setting before `gaadiiq.com` is public.
