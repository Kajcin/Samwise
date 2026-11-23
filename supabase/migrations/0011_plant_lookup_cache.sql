-- Results of the plant lookup (the plant-lookup Edge Function, which asks Wikipedia and
-- Wikidata), so repeating a search is instant and doesn't hit their APIs again.
-- Shared by all users: the results are public data, not anyone's personal data.
create table plant_lookup_cache (
  -- language + normalized query, e.g. 'cs:santa walkers low'
  key text primary key,
  candidates jsonb not null,
  created_at timestamptz not null default now()
);

-- Only the Edge Function (service role) reads and writes it.
alter table plant_lookup_cache enable row level security;
revoke all on plant_lookup_cache from anon, authenticated;
