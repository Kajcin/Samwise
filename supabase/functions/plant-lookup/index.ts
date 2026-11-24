// POST /functions/v1/plant-lookup  { query, language }  (user JWT required)
// Plants on Wikipedia / Wikidata matching a catalog search, to pre-fill the
// "Add a custom plant" form. Nothing is saved here except the shared result cache.
// Logic: ./lookup.ts; API calls: ./wikimedia.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, requireEnv } from '../_shared/http.ts';
import { cacheKey, Language, lookupPlant, PlantCandidate } from './lookup.ts';
import { DEFAULT_USER_AGENT, getEntities, getImageCredits, searchWikipedia } from './wikimedia.ts';

/** Cached results are used for this long (plant data rarely changes). */
const CACHE_DAYS = 30;
const MAX_QUERY_LENGTH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const userClient = createClient(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const language: Language = body?.language === 'en' ? 'en' : 'cs';
  if (!query || query.length > MAX_QUERY_LENGTH) return json({ error: 'bad_query' }, 400);

  // Service role: the cache table is closed to clients.
  const db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const key = cacheKey(query, language);
  const since = new Date(Date.now() - CACHE_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: cached } = await db.from('plant_lookup_cache').select('candidates').eq('key', key).gte('created_at', since)
    .maybeSingle();
  if (cached) return json({ candidates: cached.candidates as PlantCandidate[], cached: true });

  const userAgent = Deno.env.get('WIKIMEDIA_USER_AGENT') || DEFAULT_USER_AGENT;
  try {
    const candidates = await lookupPlant(
      {
        searchWikipedia: (lang, q) => searchWikipedia(lang, q, userAgent),
        getEntities: (ids) => getEntities(ids, userAgent),
        getImageCredits: (files) => getImageCredits(files, userAgent),
      },
      query,
      language,
    );
    const { error: cacheError } = await db.from('plant_lookup_cache')
      .upsert({ key, candidates, created_at: new Date().toISOString() });
    if (cacheError) console.error('plant-lookup cache write failed:', cacheError.message);
    return json({ candidates, cached: false });
  } catch (error) {
    console.error('plant-lookup failed:', error instanceof Error ? error.message : error);
    return json({ error: 'lookup_failed' }, 502);
  }
});
