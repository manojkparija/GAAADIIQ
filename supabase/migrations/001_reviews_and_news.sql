-- ============================================================
-- GAADIIQ — Reviews & News schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. CAR REVIEWS
-- ============================================================
create table if not exists public.car_reviews (
  id          uuid primary key default gen_random_uuid(),
  car_id      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text not null,
  user_city   text default '',
  avatar      text default '',           -- initials e.g. "RK"
  rating      smallint not null check (rating between 1 and 5),
  title       text not null default '',
  body        text not null,
  video_url   text default null,         -- Supabase Storage public URL
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Index for fast per-car lookup
create index if not exists car_reviews_car_id_idx on public.car_reviews(car_id);

-- RLS: anyone can read; authenticated users can insert their own
alter table public.car_reviews enable row level security;

create policy "Anyone can read reviews"
  on public.car_reviews for select using (true);

create policy "Anyone can insert reviews"
  on public.car_reviews for insert
  with check (true);

create policy "Users can update their own reviews"
  on public.car_reviews for update
  using (auth.uid() = user_id);

create policy "Users can delete their own reviews"
  on public.car_reviews for delete
  using (auth.uid() = user_id);


-- 2. NEWS ARTICLES
-- ============================================================
create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'news',  -- news | expert-review | user-review | special-report
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

-- RLS: public read; only service role can write (admin CMS)
alter table public.news_articles enable row level security;

create policy "Anyone can read news articles"
  on public.news_articles for select using (true);


-- 3. REVIEW LIKES (separate so a user can like once)
-- ============================================================
create table if not exists public.review_likes (
  review_id  uuid references public.car_reviews(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  primary key (review_id, user_id)
);

alter table public.review_likes enable row level security;

create policy "Anyone can read likes"
  on public.review_likes for select using (true);

create policy "Authenticated users can like"
  on public.review_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can unlike"
  on public.review_likes for delete
  using (auth.uid() = user_id);


-- 4. SUPABASE STORAGE — review-videos bucket
-- ============================================================
-- Run this separately in the Supabase dashboard OR via the API:
--
--   insert into storage.buckets (id, name, public)
--   values ('review-videos', 'review-videos', true);
--
--   create policy "Public read for review videos"
--     on storage.objects for select
--     using (bucket_id = 'review-videos');
--
--   create policy "Authenticated users can upload review videos"
--     on storage.objects for insert
--     with check (bucket_id = 'review-videos' and auth.uid() is not null);


-- 5. SEED — sample news articles
-- ============================================================
insert into public.news_articles (category, title, summary, author, tags) values
  ('news',          'Tata Punch EV gets new 45 kWh long-range battery option', 'Tata Motors has introduced a larger battery pack for the Punch EV, boosting range to 421 km MIDC.', 'GAADIIQ Editorial', array['Tata','EV','Punch']),
  ('expert-review', 'Maruti Suzuki Swift 2024 Review: Still the benchmark?', 'We drove the all-new Swift for 1,000 km. Here is what changed — and what did not.', 'Rohan Mehta', array['Maruti','Swift','Review']),
  ('user-review',   'My 6-month experience with the Hyundai Creta Electric', 'Real-world ownership insights from a Bangalore owner covering charging, range, and service.', 'Amit K.', array['Hyundai','Creta','EV','Owner']),
  ('special-report','Top 10 Cars Under ₹10L in 2025 — Complete Buyer Guide', 'We shortlisted the best value-for-money options across hatchbacks and compact sedans.', 'GAADIIQ Editorial', array['Budget','Guide','2025']);
