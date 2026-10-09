-- Let a profile be identified by a phone number as well as an email.
--
-- WHY THIS IS NEEDED
--
-- Signing up with a mobile number was asked for, and Supabase Auth supports it
-- directly: signInWithOtp({ phone }) mints a real session whose user has
-- `phone` set and `email` undefined. Everything downstream of that session in
-- this app, however, is keyed by email — user_profiles.email is NOT NULL
-- UNIQUE, and AuthService looks a profile up with .eq('email', email).
--
-- So a phone-only user could hold a perfectly valid Supabase session and still
-- have nowhere to store a name or a role. This migration is what makes the
-- profile table able to describe them.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--
-- email stops being NOT NULL. It stays UNIQUE, so nothing that exists today
-- changes meaning: every current row has an email and still cannot share it.
-- Dropping NOT NULL cannot fail on existing data and cannot orphan a row.
--
-- phone is added UNIQUE and nullable. UNIQUE matters more than it looks: a
-- phone number is the login credential for these accounts, so two profiles
-- carrying the same number would make "who is this" ambiguous at sign-in.
-- Postgres treats NULLs as distinct in a unique index, so the hundreds of
-- email-only rows that will never have a phone do not collide with each other.
--
-- The CHECK is the real guard. Without it the table would accept a row with
-- neither identifier — a profile belonging to nobody, unreachable by either
-- lookup path and invisible to every screen. That is the state this change
-- makes newly possible, so it is the state the constraint forbids.
--
-- NOT added: a foreign key to auth.users. The table has never had one. Profile
-- rows are created by the client with the anon key, and seeded rows in 006
-- exist for accounts that were never created in auth at all. Adding the
-- reference here would reject those seeds and is a separate decision.

ALTER TABLE public.user_profiles
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS phone text;

-- Partial-free unique index: NULL phones do not conflict in Postgres, so this
-- constrains only the rows that actually carry a number.
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_phone_key
  ON public.user_profiles (phone);

-- Named so a violation says what is wrong rather than quoting a serial number.
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_has_an_identifier;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_has_an_identifier
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

COMMENT ON COLUMN public.user_profiles.phone IS
  'E.164, +91XXXXXXXXXX. The login identifier for accounts created by phone '
  'OTP, which have no email. Null for every email-created account.';
