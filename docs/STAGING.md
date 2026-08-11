# Setting up staging

Every merge to `master` goes straight to real users. When the catalogue went
blank on 10 Aug, the live site was where it was discovered — by the person who
owns the business, not by a test.

This is the one backlog item that cannot be fixed in code: it needs services
created in the Render, Vercel and Supabase dashboards. What follows is the
shape to create and why each piece is there, so it is a checklist rather than a
research project.

---

## What already exists

**Vercel previews.** Every pull request already gets its own deployment of the
web app. That covers front-end changes and is why the checkbox fix could be
checked before merging.

The gap is everything else: the preview talks to the **production** API and the
**production** database. A PR that changes an endpoint, a model, or a migration
cannot be tried anywhere before it is live.

---

## What to create

### 1. A staging branch

```
master     -> production   (Render + Vercel, as today)
staging    -> staging      (new)
```

Work merges into `staging`, is checked there, and is promoted to `master`. The
branch is the cheap part; the environments below are what make it mean
anything.

### 2. A staging database (Supabase)

Either a second Supabase project or a branch of the existing one. Two things
matter:

- **It must be built by migrations, not by hand.** `alembic upgrade head` on an
  empty database now produces the full schema — that is what migrations 0025
  and 0026 were for. If staging is ever reconciled by hand it stops being a
  rehearsal of the production deploy.
- **It must not hold real applicant data.** `loan_applications` carries PAN and
  income; `mechanics` carries a peppered Aadhaar digest. Do not copy production
  rows into staging. Seed it from the migrations' own lender data and create
  test accounts.

Use a **different `KYC_HASH_PEPPER`** in staging. Sharing it would make the
Aadhaar and PAN digests in the two databases comparable, which is exactly the
property the pepper exists to remove.

### 3. A staging API service (Render)

A second Render web service from the same repo, `staging` branch, with its own
environment:

| Variable | Staging value |
|---|---|
| `DATABASE_URL` / `ASYNC_DATABASE_URL` | the staging database |
| `ENVIRONMENT` | `staging` |
| `KYC_HASH_PEPPER` | **different** from production |
| `MARKETPLACE_ENABLED` | as you want to test it |
| Razorpay keys | test-mode keys, never live ones |
| WhatsApp credentials | leave unset — see below |

Leaving the WhatsApp credentials unset matters: a staging run that sends real
messages to real phone numbers is worse than one that sends none.

### 4. A staging web deployment (Vercel)

Point a second Vercel project — or a branch deployment — at `staging`, with
`environment.ts`'s `apiUrl` set to the staging API. The existing per-PR previews
stay as they are.

---

## Deploy flow once this exists

```
PR  ->  Vercel preview + CI (SQLite, Postgres, migrations, smoke tests)
     ->  merge to staging  ->  staging API + staging web, real Postgres
     ->  look at it
     ->  merge to master   ->  production
```

The step that would have caught 10 Aug is the third one: the blank catalogue was
a Postgres-and-data problem that no amount of CI could see, and five minutes on
a staging site would have.

---

## Cheaper interim, if a second Render service is not worth it yet

Run the API locally against a copy of the staging schema before merging:

```bash
cd apps/api
docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 -d postgres:16
DATABASE_URL=postgresql+asyncpg://postgres:x@localhost:5432/postgres \
ASYNC_DATABASE_URL=postgresql+asyncpg://postgres:x@localhost:5432/postgres \
  alembic upgrade head
```

Then point the Angular dev server at `http://localhost:8000`. It is not a
staging environment, but it is a real Postgres with the real schema, which is
where the interesting failures live.
