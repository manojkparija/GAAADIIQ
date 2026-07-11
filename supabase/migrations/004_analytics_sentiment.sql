-- ============================================================
-- GAADIIQ: Analytics, Sentiment & Subscription Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Subscription Plans catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  monthly_price int  NOT NULL DEFAULT 0,
  yearly_price  int  NOT NULL DEFAULT 0,
  badge         text,
  badge_color   text,
  description   text,
  features      jsonb NOT NULL DEFAULT '[]',
  cta_label     text,
  cta_link      text,
  highlight     boolean DEFAULT false,
  sort_order    int DEFAULT 0,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz
);

-- Seed with current plan data
INSERT INTO public.subscription_plans
  (id, name, monthly_price, yearly_price, badge, badge_color, description, features, cta_label, cta_link, highlight, sort_order)
VALUES
  ('free_buyer', 'Free Buyer', 0, 0, NULL, NULL,
   'Everything a car buyer needs to research and shortlist smarter.',
   '["✅ Browse all listings","✅ AI Car Advisor (5 queries/day)","✅ EMI Calculator","✅ Compare up to 2 cars","✅ 3 Price Alerts","✅ Write reviews","❌ Priority listings","❌ Dealer contact details","❌ AI Valuation"]',
   'Get Started Free', '/register', false, 1),

  ('buyer_pro', 'Buyer Pro', 299, 248, '⭐ Most Popular', 'purple',
   'Unlock the full buying intelligence stack for serious car shoppers.',
   '["✅ Everything in Free","✅ Unlimited AI Car Advisor","✅ Compare up to 5 cars","✅ Unlimited Price Alerts","✅ Full dealer contact details","✅ AI Valuation reports","✅ TCO & Resale analysis","✅ Priority customer support","❌ Dealer dashboard"]',
   'Start 7-Day Free Trial', '/register', true, 2),

  ('seller_basic', 'Seller Basic', 499, 414, NULL, NULL,
   'List your car and reach thousands of verified buyers.',
   '["✅ List up to 3 cars","✅ AI-powered listing optimiser","✅ Enquiry inbox","✅ WhatsApp lead notifications","✅ Basic analytics","✅ 30-day listing duration","❌ Featured placement","❌ Bulk uploads","❌ Dealer branding"]',
   'List Your Car', '/list-car', false, 3),

  ('dealer_pro', 'Dealer Pro', 2499, 2074, '🏢 Dealer', 'gold',
   'Full dealer intelligence platform for showrooms and used-car lots.',
   '["✅ Unlimited listings","✅ Featured placement on search","✅ Full Dealer Dashboard","✅ Lead CRM with pipeline stages","✅ Advanced analytics & reports","✅ Bulk inventory upload (CSV)","✅ Dealer branding & profile page","✅ AI pricing recommendations","✅ Dedicated account manager"]',
   'Start Dealer Trial', '/dealer-dashboard', false, 4)
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  monthly_price = EXCLUDED.monthly_price,
  yearly_price  = EXCLUDED.yearly_price,
  features      = EXCLUDED.features,
  description   = EXCLUDED.description,
  updated_at    = now();


-- 2. User Subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email   text NOT NULL,
  plan_id      text NOT NULL REFERENCES public.subscription_plans(id),
  billing      text NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'yearly'
  status       text NOT NULL DEFAULT 'trial',    -- 'trial' | 'active' | 'cancelled' | 'expired'
  started_at   timestamptz DEFAULT now(),
  expires_at   timestamptz,
  cancelled_at timestamptz,
  payment_ref  text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_email ON public.user_subscriptions(user_email);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status);


-- 3. User Events (raw activity log for analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  text,               -- null = anonymous session
  session_id  text,
  event_type  text NOT NULL,
  -- event_type values:
  --   page_view | car_view | car_compare_add | ai_query | ai_result_view
  --   search | filter_apply | price_alert_set | test_drive_book
  --   listing_created | listing_price_edit | journey_complete | journey_retake
  --   plan_viewed | plan_cta_clicked | login | register | logout
  event_data  jsonb,              -- { car_id?, query?, plan_id?, make?, model?, budget?, ... }
  page        text,
  city        text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_events_email      ON public.user_events(user_email);
CREATE INDEX IF NOT EXISTS idx_user_events_type       ON public.user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_session    ON public.user_events(session_id);
CREATE INDEX IF NOT EXISTS idx_user_events_created_at ON public.user_events(created_at DESC);


-- 4. Buyer Journeys (persist profiles, not just localStorage)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.buyer_journeys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      text,
  session_id      text,
  budget          text,
  use_case        text,
  fuel_preference text,
  transmission    text,
  body_type       text,
  city            text,
  priority        text,
  completed_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_journeys_email ON public.buyer_journeys(user_email);


-- 5. User Sentiment Scores (aggregated, updated by analytics service)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_sentiment (
  user_email        text PRIMARY KEY,
  engagement_score  int DEFAULT 0,    -- 0–100: frequency + recency of events
  intent_score      int DEFAULT 0,    -- 0–100: high-intent actions (AI, price alerts, test drives)
  sentiment_label   text DEFAULT 'passive',
  -- 'hot_lead' | 'active_browser' | 'returning_buyer' | 'passive' | 'churned'
  top_interest      text,             -- 'suv' | 'ev' | 'budget' | 'luxury' etc.
  preferred_budget  text,
  preferred_fuel    text,
  event_count       int DEFAULT 0,
  last_active_at    timestamptz,
  updated_at        timestamptz DEFAULT now()
);


-- 6. Analytics helper view: per-user event summary
-- ============================================================
CREATE OR REPLACE VIEW public.v_user_analytics AS
SELECT
  user_email,
  COUNT(*)                                                           AS total_events,
  COUNT(*) FILTER (WHERE event_type = 'car_view')                   AS car_views,
  COUNT(*) FILTER (WHERE event_type = 'ai_query')                   AS ai_queries,
  COUNT(*) FILTER (WHERE event_type = 'price_alert_set')            AS price_alerts,
  COUNT(*) FILTER (WHERE event_type = 'test_drive_book')            AS test_drives,
  COUNT(*) FILTER (WHERE event_type = 'listing_created')            AS listings_created,
  COUNT(*) FILTER (WHERE event_type = 'journey_complete')           AS journeys_completed,
  COUNT(*) FILTER (WHERE event_type = 'plan_cta_clicked')           AS plan_cta_clicks,
  MAX(created_at)                                                    AS last_active_at,
  MIN(created_at)                                                    AS first_seen_at,
  COUNT(DISTINCT DATE(created_at))                                   AS active_days
FROM public.user_events
WHERE user_email IS NOT NULL
GROUP BY user_email;


-- 7. Analytics helper view: funnel by event type
-- ============================================================
CREATE OR REPLACE VIEW public.v_event_funnel AS
SELECT
  event_type,
  COUNT(*)                          AS total,
  COUNT(DISTINCT user_email)        AS unique_users,
  COUNT(DISTINCT session_id)        AS unique_sessions,
  DATE_TRUNC('day', created_at)     AS day
FROM public.user_events
GROUP BY event_type, DATE_TRUNC('day', created_at)
ORDER BY day DESC, total DESC;


-- 8. RLS policies (open for now — tighten per auth setup)
-- ============================================================
ALTER TABLE public.subscription_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_journeys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sentiment        ENABLE ROW LEVEL SECURITY;

-- Plans: readable by all
DROP POLICY IF EXISTS "plans_read" ON public.subscription_plans;
CREATE POLICY "plans_read" ON public.subscription_plans FOR SELECT USING (true);

-- Events: anyone can insert (tracks anonymous too), no read via anon key
DROP POLICY IF EXISTS "events_insert" ON public.user_events;
CREATE POLICY "events_insert" ON public.user_events FOR INSERT WITH CHECK (true);

-- Buyer journeys: anyone can insert
DROP POLICY IF EXISTS "journeys_insert" ON public.buyer_journeys;
CREATE POLICY "journeys_insert" ON public.buyer_journeys FOR INSERT WITH CHECK (true);

-- User subscriptions: insert/read by matching email
DROP POLICY IF EXISTS "subs_insert" ON public.user_subscriptions;
CREATE POLICY "subs_insert" ON public.user_subscriptions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "subs_read" ON public.user_subscriptions;
CREATE POLICY "subs_read" ON public.user_subscriptions FOR SELECT USING (true);

-- Sentiment: insert/update by service
DROP POLICY IF EXISTS "sentiment_upsert" ON public.user_sentiment;
CREATE POLICY "sentiment_upsert" ON public.user_sentiment FOR ALL USING (true);
