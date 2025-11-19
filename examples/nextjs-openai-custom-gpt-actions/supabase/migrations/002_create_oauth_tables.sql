-- Table for temporary authorization codes
create table if not exists oauth_codes (
  code text primary key,
  user_id uuid not null,
  client_id text not null,
  redirect_uri text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Table for long-lived refresh tokens
create table if not exists oauth_refresh_tokens (
  token text primary key,
  user_id uuid not null,
  client_id text not null,
  scope text,
  expires_at timestamptz not null,
  issued_at timestamptz default now(),
  last_used_at timestamptz
);

-- Enable RLS
alter table oauth_codes enable row level security;
alter table oauth_refresh_tokens enable row level security;

-- Create policies (allow service role full access, or implement specific policies if needed)
-- For now, we'll rely on the service role key (backend access) which bypasses RLS by default
-- but adding a basic policy is good practice
create policy "Service role can manage oauth codes"
  on oauth_codes
  using ( true )
  with check ( true );

create policy "Service role can manage refresh tokens"
  on oauth_refresh_tokens
  using ( true )
  with check ( true );

