-- Drop foreign key constraint to auth.users
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;

-- Drop RLS policies BEFORE altering the column (required because policies depend on the column)
DROP POLICY IF EXISTS "Users can view own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can insert own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;

-- Change user_id column type to text to support external IDs (like SolvaPay customerRef)
ALTER TABLE tasks ALTER COLUMN user_id TYPE text;

-- Update RLS policies to use the text user_id
-- OR better: The API uses the Service Role key, which bypasses RLS.
-- So we don't strictly need new policies for the Service Role to work.
-- But to be safe, we can leave RLS enabled and rely on Service Role bypass.

