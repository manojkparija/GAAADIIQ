-- Hand a live enquiry to a dealer, once there is a dealer to hand it to.
--
-- THE SITUATION THIS IS FOR
--
-- The site goes live with the catalogue loaded and no dealers onboarded.
-- Buyers enquire. Those enquiries are stored, admins are alerted (025) and can
-- work them. Later a dealer joins, and some of those conversations belong with
-- them.
--
-- THE SHAPE, AND WHY IT IS NOT A QUEUE
--
-- The obvious design parks enquiries in an "unassigned" holding pen and drains
-- it when a dealer appears. That was considered and deliberately not built.
--
-- A car enquiry has a shelf life of weeks. Someone asking about an e Vitara in
-- September has bought something by November. If dealers onboard three months
-- later, draining that queue is not handing over leads — it is asking a new
-- dealer to cold-call people who have moved on, and it begins the dealer
-- relationship with a batch of dead numbers.
--
-- So an admin works every enquiry immediately, using the status field 025
-- added. This column records a *transfer of a live lead*, not a queue being
-- emptied. assigned_to_dealer_at is what makes staleness visible: the gap
-- between created_at and the handover is how long the buyer waited, and a
-- handover long after the enquiry is a decision somebody should have to look
-- at rather than a default.
--
-- WHY sellers.id AND NOT users.id
--
-- Measured, not assumed. There are two seller identities in this database and
-- they are not the same thing:
--
--   listings.seller_id -> users.id  (uuid)   — who owns a catalogue listing
--   sellers.id         (integer)             — the dealer business record
--
-- The dealer dashboard identifies its user through `sellers` (user.sellerId),
-- and 010's working policy matches a dealer by sellers.email against the JWT.
-- That is the path a dealer can actually be recognised on, so assignment uses
-- it. test_drive_requests.seller_id (007) is the same column shape for the
-- same reason — this is the established way to say "this belongs to that
-- dealer".
--
-- NOT EVERY ENQUIRY IS A DEALER'S
--
-- An enquiry against catalogue stock has no dealer by construction — it is
-- manufacturer inventory, not somebody's advert, and it is a lead for the
-- business itself. Nothing here assigns automatically, precisely so that those
-- are not swept into a handover along with the rest. Assignment is an explicit
-- act by an admin who has looked at the row.
--
-- CONSENT
--
-- The enquiry form tells a buyer where their details go, and passing a phone
-- number to a third party is a different thing from holding it. The form's
-- wording is updated in the same change as this column, so the promise and the
-- behaviour ship together rather than the behaviour arriving first.

BEGIN;

ALTER TABLE public.car_enquiries
  ADD COLUMN IF NOT EXISTS assigned_seller_id    int REFERENCES public.sellers(id),
  ADD COLUMN IF NOT EXISTS assigned_to_dealer_at timestamptz;

-- A dealer's own inbox: "what has been given to me", newest first.
CREATE INDEX IF NOT EXISTS car_enquiries_assigned_seller_idx
  ON public.car_enquiries (assigned_seller_id, created_at DESC)
  WHERE assigned_seller_id IS NOT NULL;

-- The read policy gains a third way in. 024's two clauses are unchanged and
-- reproduced exactly: an admin sees everything, the owner of the listing an
-- enquiry names sees that one. Added below them: the dealer it was handed to.
--
-- Matched on sellers.email against the JWT, which is 010's pattern and the
-- only link between an authenticated caller and a sellers row — `sellers` has
-- no auth.uid() column. Worth fixing one day; not by holding this behind it.
DROP POLICY IF EXISTS "enquiries_seller_or_admin_select" ON public.car_enquiries;

CREATE POLICY "enquiries_seller_or_admin_select" ON public.car_enquiries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.users u ON u.id = l.seller_id
      WHERE l.id = car_enquiries.car_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = car_enquiries.assigned_seller_id
        AND lower(s.email) = lower(auth.jwt() ->> 'email')
    )
  );

-- And the same three ways for UPDATE, so a dealer handed a lead can move its
-- status. Whoever may read an enquiry may work it; that pairing is 025's rule
-- and this keeps read and write identical rather than letting them drift.
--
-- Note what a dealer still cannot do: assignment itself is an admin act. A
-- dealer can move a lead they were given, not take one they were not.
DROP POLICY IF EXISTS "enquiries_seller_or_admin_update" ON public.car_enquiries;

CREATE POLICY "enquiries_seller_or_admin_update" ON public.car_enquiries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.users u ON u.id = l.seller_id
      WHERE l.id = car_enquiries.car_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = car_enquiries.assigned_seller_id
        AND lower(s.email) = lower(auth.jwt() ->> 'email')
    )
  );

COMMIT;

-- Check it took:
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='car_enquiries'
--     AND column_name IN ('assigned_seller_id','assigned_to_dealer_at');
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='car_enquiries' ORDER BY policyname;
--
-- Expect the two columns, and still three policies — the two rewritten here
-- plus enquiries_insert.
