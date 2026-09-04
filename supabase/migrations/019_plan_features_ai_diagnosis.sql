-- ============================================================
-- GAADIIQ: list AI Diagnosis on the pricing plan cards
-- Run this in your Supabase SQL Editor
-- ============================================================
--
-- WHY THIS IS SQL AND NOT CODE
--
-- The plan cards' bullet list is `subscription_plans.features`, a jsonb array
-- read at runtime by services/subscription.service.ts. It is marketing copy
-- held as data, so adding a bullet is a row edit — there is nothing in the
-- Angular app to change.
--
-- The price is NOT here. It comes from the API, and the two were split after
-- a plan card advertised ₹299 while the order charged ₹999. This file touches
-- `features` only, deliberately.
--
-- THE NUMBERS BELOW ARE NOT FREE-FLOATING
--
-- They must match `MONTHLY_QUOTA` in apps/api/services/diagnosis_quota.py,
-- which is what the server actually enforces:
--
--     free           3 per month
--     seller_basic  10 per month
--     pro           unlimited      (Buyer Pro on this page)
--     dealer        unlimited      (Dealer Pro on this page)
--
-- No test can hold these in step, because no test can read this database.
-- That is the whole hazard: a card promising ten runs while the API grants
-- three is indistinguishable from a working system until a user is refused.
-- If the quota changes in that file, this file changes with it.
--
-- ID NAMES DIFFER FROM THE API's
--
-- This table's ids are free_buyer / buyer_pro / seller_basic / dealer_pro;
-- the API's SubscriptionTier is free / pro / seller_basic / dealer. Only
-- seller_basic happens to agree. Mapped explicitly below rather than joined
-- on, since there is nothing to join them by.

DO $$
DECLARE
  -- id, bullet. Free gets a "✅" rather than a "❌": signed-in free users do
  -- get runs, just few. The ❌ entries on these cards mark things the plan
  -- genuinely does not include, and one here would say the feature is absent
  -- when it is rationed.
  --
  -- Seller Basic states its number for the same reason Buyer Pro says
  -- "Unlimited": "AI Diagnosis" bare would read as uncapped on a paid card.
  plan     text;
  bullet   text;
  kept     jsonb;
  tail_at  int;
BEGIN
  FOR plan, bullet IN
    SELECT * FROM (VALUES
      ('free_buyer',   '✅ AI Diagnosis (3 per month)'),
      ('buyer_pro',    '✅ Unlimited AI Diagnosis'),
      ('seller_basic', '✅ AI Diagnosis (10 per month)'),
      ('dealer_pro',   '✅ Unlimited AI Diagnosis')
    ) AS v(id, bullet)
  LOOP
    -- Strip any existing AI Diagnosis bullet first, so re-running this file
    -- leaves exactly one and never a duplicate. Order is otherwise preserved.
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      INTO kept
      FROM subscription_plans p,
           jsonb_array_elements(p.features) WITH ORDINALITY AS t(elem, ord)
     WHERE p.id = plan
       AND elem::text NOT ILIKE '%AI Diagnosis%';

    -- No guard for a missing plan id is needed. The aggregate above returns
    -- one row whatever the FROM matches, so `kept` is '[]' rather than NULL,
    -- and the UPDATE below simply matches nothing. Verified by deleting a
    -- plan row and re-running: the other three are still updated correctly.

    -- Insert before the first "❌", not at the end. These cards list what a
    -- plan includes and then what it does not; appending a ✅ after the ❌
    -- block reads as an afterthought and breaks the pattern on every card.
    -- Plans with no ❌ at all (Dealer Pro) fall through to the end, which is
    -- the same place.
    SELECT COALESCE(MIN(ord), jsonb_array_length(kept) + 1)
      INTO tail_at
      FROM jsonb_array_elements(kept) WITH ORDINALITY AS t(elem, ord)
     WHERE elem::text LIKE '%❌%';

    UPDATE subscription_plans
       SET features = (
             SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
               FROM jsonb_array_elements(kept) WITH ORDINALITY AS t(elem, ord)
              WHERE ord < tail_at
           )
           || jsonb_build_array(bullet)
           || (
             SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
               FROM jsonb_array_elements(kept) WITH ORDINALITY AS t(elem, ord)
              WHERE ord >= tail_at
           ),
           updated_at = now()
     WHERE id = plan;
  END LOOP;
END $$;


-- Read this back before closing the editor. Four rows, one AI Diagnosis
-- bullet each, and the counts matching diagnosis_quota.py.
SELECT id,
       name,
       jsonb_path_query_array(features, '$[*] ? (@ like_regex "AI Diagnosis")')
         AS ai_diagnosis_bullets,
       jsonb_array_length(features) AS total_bullets
FROM public.subscription_plans
WHERE id IN ('free_buyer', 'buyer_pro', 'seller_basic', 'dealer_pro')
ORDER BY sort_order;
