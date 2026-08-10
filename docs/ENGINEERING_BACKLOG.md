# Engineering backlog — 10 Aug 2026

Six things worth fixing, ordered by how much pain each one caused on the day it
was written. Every item names the evidence it came from, so none of it has to be
taken on trust.

The day that produced this list: a 360° viewer shipped, hid every S-Presso
photograph on the site, was misdiagnosed once, and was fixed properly on the
second attempt. Four of the six items below are why that was possible.

---

## 1. The schema has two sources of truth, and they have diverged

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

**Fix.** Backfill `0025`–`0027` from the two batch files so a deploy is
self-contained. Keep the SQL files as the record of what production already ran,
but stop adding new tables that way.

**Note on how this happened.** Claude wrote batches 6 and 7 as raw SQL because
that was the pattern already in the repo, and did not flag the divergence at the
time. Copying an existing pattern is not the same as the pattern being right.

---

## 2. Catalogue data hygiene is the real bottleneck

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

**Fix.** A canonical manufacturer list enforced at write time, and a cleanup
pass over existing rows. The admin year-dropdown fix (PR #65) stops *new*
uploads landing on a stale year; it does nothing for rows already stored.

---

## 3. CI runs on SQLite; production runs Postgres

**Evidence.** `.github/workflows/ci-api.yml` declares no `services:` block, so
the suite runs against SQLite while production is Postgres on Supabase.

**What it hides.** Native enums, `NOT NULL` semantics, casting, index behaviour.
A green tick on 845 tests says nothing about any of it.

**Worth knowing.** This nearly caused a false diagnosis: the blank catalogue was
blamed on a Postgres enum literal that CI could not have caught, and a fix was
merged to production on that theory. The theory was wrong — the enum type does
contain the label, and the Render logs showed every request returning 200 — but
the reasoning was only plausible *because* this gap is real.

**Fix.** Add a Postgres service container to `ci-api.yml`. Roughly ten lines.

---

## 4. Playwright exists and never runs

**Evidence.** `apps/gaadiiq-angular/playwright.config.ts` and an `e2e/`
directory are present. Neither workflow invokes them.

**What it cost.** Every browser check on 10 Aug was a dev server started by hand.
That found real bugs the compiler could not — a frozen commission split, a
spurious auth banner, a heading under the fixed navbar. It also **missed** the
consent checkbox rendering 693px wide and pushing its own label out of the card,
because the screenshot captured the top of the form and not the bottom. The user
found that one.

**Fix.** Two or three smoke tests in CI: home renders, a car detail page renders
its gallery, the loan form submits. Enough to catch a page that no longer works
at all, which is the failure mode that keeps recurring.

---

## 5. No staging environment

`master` deploys straight to Render and Vercel. When the catalogue went blank on
10 Aug, the live site was where it was discovered.

---

## 6. Merging on assertion rather than evidence

Not a code issue. On 10 Aug a fix was merged to production on Claude's
say-so, and it was based on inference from timing rather than on any log,
query or reproduction. It changed working code into differently-working code
and fixed nothing.

**The habit worth keeping:** before merging, ask **"how did you verify that?"**
"I reasoned about it" and "I measured it in a browser" are different confidence
levels, and the difference is not visible in how the claim is phrased.

---

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
