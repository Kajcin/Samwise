// Wikipedia search and Wikidata items, through their public APIs (no key needed).
// Wikimedia asks API clients to send a descriptive User-Agent; it's configurable
// (WIKIMEDIA_USER_AGENT) so the operator can add contact details there.
import type { Language, TaxonEntity, WikiPage } from './lookup.ts';

export const DEFAULT_USER_AGENT = 'garden-plant-lookup/1.0 (personal, non-commercial)';

/** Botanical databases: an ID in any of them means the item is a plant. */
const PLANT_DATABASE_PROPERTIES = [
  'P961', // IPNI plant ID
  'P5037', // Plants of the World Online ID
  'P960', // Tropicos ID
  'P1070', // The Plant List ID
];

const SEARCH_RESULTS = 8;
const EXTRACT_SENTENCES = 2;

/** On "429 Too Many Requests": retry this many times, waiting as asked (Retry-After), at most this long. */
const RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_SECONDS = 5;

async function getJson(url: URL, userAgent: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await response.body?.cancel();
      const asked = Number(response.headers.get('Retry-After'));
      const seconds = Number.isFinite(asked) && asked >= 0 ? Math.min(asked, MAX_RETRY_WAIT_SECONDS) : 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`${url.hostname} answered ${response.status}`);
    return response.json();
  }
}

/** Full-text search with redirects resolved ("Rajče" → "Rajče jedlé"), with intros and Wikidata ids. */
export async function searchWikipedia(language: Language, query: string, userAgent = DEFAULT_USER_AGENT): Promise<WikiPage[]> {
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(SEARCH_RESULTS),
    prop: 'pageprops|extracts|info',
    ppprop: 'wikibase_item',
    exintro: '1',
    explaintext: '1',
    exsentences: String(EXTRACT_SENTENCES),
    exlimit: 'max',
    inprop: 'url',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  }).toString();
  const json = await getJson(url, userAgent);
  const pages: any[] = json.query?.pages ?? [];
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) // search rank
    .map((p) => ({
      title: p.title,
      wikidataId: p.pageprops?.wikibase_item ?? null,
      extract: p.extract ?? '',
      url: p.fullurl ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    }));
}

function claimValue(entity: any, property: string): any {
  return entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value ?? null;
}

export async function getEntities(ids: string[], userAgent = DEFAULT_USER_AGENT): Promise<Record<string, TaxonEntity>> {
  if (!ids.length) return {};
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|labels',
    languages: 'cs|en',
    format: 'json',
  }).toString();
  const json = await getJson(url, userAgent);
  const out: Record<string, TaxonEntity> = {};
  for (const [id, entity] of Object.entries<any>(json.entities ?? {})) {
    if (entity.missing !== undefined) continue;
    out[id] = {
      taxonName: claimValue(entity, 'P225'),
      rankId: claimValue(entity, 'P105')?.id ?? null,
      isPlant: PLANT_DATABASE_PROPERTIES.some((p) => entity.claims?.[p]?.length),
      labels: {
        ...(entity.labels?.cs ? { cs: entity.labels.cs.value } : {}),
        ...(entity.labels?.en ? { en: entity.labels.en.value } : {}),
      },
    };
  }
  return out;
}
