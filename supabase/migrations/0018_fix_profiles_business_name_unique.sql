-- 0018_fix_profiles_business_name_unique.sql
-- Drop the global UNIQUE constraint on profiles.business_name_lower and replace
-- it with a partial unique index that excludes empty strings. This allows two
-- collaborator accounts (placeholder profiles with business_name = '') to coexist
-- without a constraint violation when they are created via the handle_new_user
-- trigger extension in 0019.

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_business_name_lower_key;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_business_name_lower_unique
  ON profiles (business_name_lower)
  WHERE business_name_lower <> '';
