create table if not exists public.user_contracts (
  user_id text primary key,
  contract jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_contracts enable row level security;

-- This backend uses SUPABASE_SERVICE_ROLE_KEY server-side, which bypasses RLS.
-- Do not expose the service role key to Flutter or any client app.
