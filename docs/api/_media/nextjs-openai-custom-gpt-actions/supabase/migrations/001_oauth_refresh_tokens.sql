-- Create oauth_refresh_tokens table for storing OAuth refresh tokens
-- This is the bare minimum storage needed for OAuth flow

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on token for fast lookups
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_token ON oauth_refresh_tokens(token);

-- Create index on user_id for cleanup operations
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user_id ON oauth_refresh_tokens(user_id);

-- Create index on expires_at for automatic cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires_at ON oauth_refresh_tokens(expires_at);

-- Enable Row Level Security
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to manage all tokens (server-side operations)
-- Note: In production, you may want more restrictive policies
CREATE POLICY "Service role can manage refresh tokens"
  ON oauth_refresh_tokens
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Allow users to delete their own tokens
CREATE POLICY "Users can delete their own refresh tokens"
  ON oauth_refresh_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically clean up expired tokens (optional, can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM oauth_refresh_tokens
  WHERE expires_at < NOW();
END;
$$;

