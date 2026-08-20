-- Dealer photographs wait for an admin before a buyer sees them.
--
-- From UAT: "If a Dealer uploads images, those images should not become
-- publicly visible immediately." Until now `car_images` had no notion of
-- review at all — a row existed and was readable by anyone, full stop.
--
-- WHY NOW IS THE CHEAP MOMENT
--
-- Nothing buyer-facing reads `car_images` yet: listing galleries come from the
-- API's image_urls. So there is no backlog of already-public photographs to
-- reclassify, and no window where a published image disappears from a live
-- listing. Adding the gate before the table is wired to a buyer page costs
-- nothing; adding it afterwards would mean hiding pictures people had already
-- seen.
--
-- WHY EXISTING ROWS ARE APPROVED, NOT PENDING
--
-- Whatever is already there was put there by the List Your Car flow, before
-- review existed, and its authors were told nothing about approval. Defaulting
-- them to pending would silently withdraw photographs those sellers believe
-- are on their listing. New rows default to pending; the ones that predate the
-- rule are grandfathered, which is the honest reading of "this rule starts
-- now".

BEGIN;

ALTER TABLE public.car_images
  ADD COLUMN IF NOT EXISTS status           text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by      text,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by     text;

-- Grandfather what is already there, then make pending the default for
-- everything after. Order matters: setting the default first would still
-- leave existing NULLs, and a NULL status is neither approved nor pending —
-- it is a row no policy can reason about.
UPDATE public.car_images SET status = 'approved' WHERE status IS NULL;

ALTER TABLE public.car_images ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.car_images ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_images_status_known'
  ) THEN
    ALTER TABLE public.car_images
      ADD CONSTRAINT car_images_status_known
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- A rejection without a reason is not a decision a dealer can act on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_images_rejection_has_reason'
  ) THEN
    ALTER TABLE public.car_images
      ADD CONSTRAINT car_images_rejection_has_reason
      CHECK (status <> 'rejected' OR nullif(btrim(rejection_reason), '') IS NOT NULL);
  END IF;
END $$;

-- The review queue is read by status, oldest first.
CREATE INDEX IF NOT EXISTS car_images_status_idx
  ON public.car_images (status, created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Read splits three ways, because "what a buyer sees" and "what a dealer sees
-- of their own submission" are different questions. A dealer must be able to
-- watch their photograph sit in the queue and read why it was refused; a
-- buyer must see only what an admin has passed.

DROP POLICY IF EXISTS "car_images_public_read"    ON public.car_images;
DROP POLICY IF EXISTS "car_images_seller_reads"   ON public.car_images;
DROP POLICY IF EXISTS "car_images_admin_reads"    ON public.car_images;

-- Buyers, signed in or not: approved only.
CREATE POLICY "car_images_public_read" ON public.car_images
  FOR SELECT USING (status = 'approved');

-- The dealer selling that car sees their own submissions at any status.
CREATE POLICY "car_images_seller_reads" ON public.car_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cars c
      WHERE c.id = car_images.car_id
        AND lower(c.seller_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Admins see everything, which is what a review queue is.
CREATE POLICY "car_images_admin_reads" ON public.car_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- The hole row-level security cannot close on its own
-- ---------------------------------------------------------------------------
--
-- 011 gave the seller of a car UPDATE on its photographs, so they can reorder
-- and replace them. With a status column that same policy would let a dealer
-- approve their own submission — the whole point of the queue, undone by one
-- UPDATE.
--
-- A policy cannot express "you may change the url but not the status": RLS
-- checks rows, not columns, and WITH CHECK cannot see the old row to compare
-- against. Column privileges do not help either, because Supabase signs
-- everybody in as the same `authenticated` role, so revoking the column from
-- sellers would revoke it from admins too.
--
-- A trigger can see both rows and the caller, so the rule lives here.
CREATE OR REPLACE FUNCTION public.car_images_guard_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
     AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
     AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at THEN
    RETURN NEW;  -- nothing about the review changed
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
      AND p.role = 'admin'
  ) INTO caller_is_admin;

  IF NOT caller_is_admin THEN
    RAISE EXCEPTION 'Only an admin can review a photograph.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Stamped here rather than trusted from the client, so the record of who
  -- decided cannot be written by whoever is asking.
  NEW.reviewed_by := auth.jwt() ->> 'email';
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS car_images_review_guard ON public.car_images;
CREATE TRIGGER car_images_review_guard
  BEFORE UPDATE ON public.car_images
  FOR EACH ROW EXECUTE FUNCTION public.car_images_guard_review_fields();

-- A dealer must not be able to submit something already approved either.
CREATE OR REPLACE FUNCTION public.car_images_force_pending_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
      AND p.role = 'admin'
  ) THEN
    -- An admin adding a photograph is the review.
    NEW.status := coalesce(NEW.status, 'approved');
  ELSE
    NEW.status := 'pending';
    NEW.rejection_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  NEW.submitted_by := coalesce(auth.jwt() ->> 'email', NEW.submitted_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS car_images_insert_status ON public.car_images;
CREATE TRIGGER car_images_insert_status
  BEFORE INSERT ON public.car_images
  FOR EACH ROW EXECUTE FUNCTION public.car_images_force_pending_on_insert();

COMMIT;
