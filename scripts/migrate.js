#!/usr/bin/env node
/**
 * One-shot migration runner for GAADIIQ Supabase schema.
 * Run once from your local machine (not from the app, not by end users).
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<your-service-role-key> node scripts/migrate.js
 *
 * Or create a .env.local file with SUPABASE_SERVICE_KEY=... and run:
 *   node -r dotenv/config scripts/migrate.js
 */

const https = require('https');

const SUPABASE_URL = 'https://gnhixykdvnuoxeccntjo.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_KEY environment variable before running.');
  console.error('  SUPABASE_SERVICE_KEY=eyJ... node scripts/migrate.js');
  process.exit(1);
}

// ── SQL to execute ─────────────────────────────────────────────────────────

const MIGRATION_SQL = `
-- 1. CAR REVIEWS
create table if not exists public.car_reviews (
  id          uuid primary key default gen_random_uuid(),
  car_id      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text not null,
  user_city   text default '',
  avatar      text default '',
  rating      smallint not null check (rating between 1 and 5),
  title       text not null default '',
  body        text not null,
  video_url   text default null,
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists car_reviews_car_id_idx on public.car_reviews(car_id);

alter table public.car_reviews enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='car_reviews' and policyname='Anyone can read reviews') then
    create policy "Anyone can read reviews" on public.car_reviews for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='car_reviews' and policyname='Anyone can insert reviews') then
    create policy "Anyone can insert reviews" on public.car_reviews for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='car_reviews' and policyname='Users can update their own reviews') then
    create policy "Users can update their own reviews" on public.car_reviews for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='car_reviews' and policyname='Users can delete their own reviews') then
    create policy "Users can delete their own reviews" on public.car_reviews for delete using (auth.uid() = user_id);
  end if;
end $$;

-- 2. NEWS ARTICLES
create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'news',
  title        text not null,
  slug         text unique,
  body         text not null default '',
  summary      text default '',
  image_url    text default '',
  author       text default 'GAADIIQ Editorial',
  source       text default 'GAADIIQ',
  tags         text[] default '{}',
  published_at timestamptz default now(),
  created_at   timestamptz not null default now()
);

create index if not exists news_articles_category_idx on public.news_articles(category);
create index if not exists news_articles_published_idx on public.news_articles(published_at desc);

alter table public.news_articles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='news_articles' and policyname='Anyone can read news articles') then
    create policy "Anyone can read news articles" on public.news_articles for select using (true);
  end if;
end $$;

-- 3. REVIEW LIKES
create table if not exists public.review_likes (
  review_id  uuid references public.car_reviews(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  primary key (review_id, user_id)
);

alter table public.review_likes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='review_likes' and policyname='Anyone can read likes') then
    create policy "Anyone can read likes" on public.review_likes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='review_likes' and policyname='Authenticated users can like') then
    create policy "Authenticated users can like" on public.review_likes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='review_likes' and policyname='Users can unlike') then
    create policy "Users can unlike" on public.review_likes for delete using (auth.uid() = user_id);
  end if;
end $$;

-- 4. SEED NEWS (idempotent — skip if rows exist)
insert into public.news_articles (category, title, summary, author, tags)
select category, title, summary, author, tags from (values
  ('news',          'Tata Punch EV gets new 45 kWh long-range battery option', 'Tata Motors has introduced a larger battery pack for the Punch EV, boosting range to 421 km MIDC.', 'GAADIIQ Editorial', array['Tata','EV','Punch']),
  ('expert-review', 'Maruti Suzuki Swift 2024 Review: Still the benchmark?',   'We drove the all-new Swift for 1,000 km. Here is what changed — and what did not.',              'Rohan Mehta',       array['Maruti','Swift','Review']),
  ('user-review',   'My 6-month experience with the Hyundai Creta Electric',   'Real-world ownership insights from a Bangalore owner covering charging, range, and service.',       'Amit K.',           array['Hyundai','Creta','EV','Owner']),
  ('special-report','Top 10 Cars Under ₹10L in 2025 — Complete Buyer Guide',   'We shortlisted the best value-for-money options across hatchbacks and compact sedans.',             'GAADIIQ Editorial', array['Budget','Guide','2025'])
) as v(category, title, summary, author, tags)
where not exists (select 1 from public.news_articles limit 1);
`;

const BUCKET_SQL = `
insert into storage.buckets (id, name, public)
values ('review-videos', 'review-videos', true)
on conflict (id) do nothing;
`;

// ── HTTP helper ────────────────────────────────────────────────────────────

function pgQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const url = new URL(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`);
    // Use the management API endpoint
    const mgmtUrl = new URL(`https://api.supabase.com/v1/projects/gnhixykdvnuoxeccntjo/database/query`);

    const options = {
      hostname: mgmtUrl.hostname,
      path: mgmtUrl.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Running GAADIIQ database migration...');
  console.log('   Project: gnhixykdvnuoxeccntjo');
  console.log('');

  try {
    console.log('⏳ Creating tables, indexes, RLS policies, and seed data...');
    await pgQuery(MIGRATION_SQL);
    console.log('✅ Schema migration complete.');

    console.log('⏳ Creating review-videos storage bucket...');
    await pgQuery(BUCKET_SQL);
    console.log('✅ Storage bucket ready.');

    console.log('');
    console.log('🎉 Migration finished! Car reviews will now save to Supabase.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('');
    console.error('Fallback: open https://supabase.com/dashboard/project/gnhixykdvnuoxeccntjo/sql');
    console.error('and paste the contents of supabase/migrations/001_reviews_and_news.sql');
    process.exit(1);
  }
}

main();
