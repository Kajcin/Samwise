// Finds plants on Wikipedia / Wikidata for a catalog search like "šanta walker's low",
// with its I/O injected so it can be unit-tested (index.ts wires it up).

export type Language = 'en' | 'cs';
export type Rank = 'family' | 'genus' | 'species' | 'hybrid' | 'subspecies' | 'variety' | 'cultivar';

/** A Wikipedia search hit. */
export interface WikiPage {
  title: string;
  wikidataId: string | null;
  /** The article's first sentences, plain text. */
  extract: string;
  url: string;
  /** The article's main free image (pageimages), if any. */
  image?: { file: string; thumbUrl: string } | null;
}

/** Who made a Commons picture and under which licence, to credit it. */
export interface ImageCredit {
  /** Plain text; null when Commons doesn't name one. */
  author: string | null;
  license: string;
  licenseUrl: string | null;
  /** The picture's page on Wikimedia Commons. */
  sourceUrl: string;
}

/** A free picture of the plant, with what's needed to credit it. */
export interface PlantImage extends ImageCredit {
  url: string;
}

/** The parts of a Wikidata item the lookup uses. */
export interface TaxonEntity {
  /** Taxon name (P225), e.g. "Nepeta racemosa"; null if the item isn't a taxon. */
  taxonName: string | null;
  /** Taxon rank (P105) item id, e.g. Q7432 = species. */
  rankId: string | null;
  /** Has an ID in a botanical database (IPNI, POWO, Tropicos, The Plant List): it's a plant. */
  isPlant: boolean;
  /** Common names, e.g. { cs: 'šanta hroznovitá', en: 'Nepeta racemosa' }. */
  labels: Partial<Record<Language, string>>;
}

export interface LookupDeps {
  searchWikipedia(language: Language, query: string): Promise<WikiPage[]>;
  getEntities(ids: string[]): Promise<Record<string, TaxonEntity>>;
  /** Credits for Commons files, by file name; files without a known licence are left out. */
  getImageCredits(files: string[]): Promise<Record<string, ImageCredit>>;
}

/** A plant found for the query, to pre-fill the "Add a custom plant" form. */
export interface PlantCandidate {
  wikidataId: string;
  /** Suggested name: the article's, or the query's words when it asked for a cultivar. */
  name: string;
  /** "Nepeta racemosa", or "Nepeta racemosa 'Walker's Low'" for a cultivar. */
  latinName: string;
  rank: Rank | null;
  /** Words of the query the found plant doesn't account for, as a cultivar name. */
  cultivar: string | null;
  /** The article this came from (its description and link). */
  articleTitle: string;
  description: string;
  url: string;
  /** Which Wikipedia: its texts are in this language. */
  language: Language;
  /** The article's free main picture with its credit; null if none or its licence is unknown. */
  image: PlantImage | null;
}

const RANKS: Record<string, Rank> = {
  Q35409: 'family',
  Q34740: 'genus',
  Q7432: 'species',
  Q1306176: 'hybrid', // nothospecies
  Q68947: 'subspecies',
  Q767728: 'variety',
  Q4886: 'cultivar',
};

const MAX_CANDIDATES = 5;
/** "šanta walker's low" → "šanta walker's" → "šanta": at most this many words dropped. */
const MAX_DROPPED_WORDS = 3;

/** Lowercase, without diacritics or punctuation, for comparing words. */
function normalize(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => normalize(w));
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** "walker's low" → "Walker's Low". */
function titleCase(text: string): string {
  return words(text).map(capitalize).join(' ');
}

/**
 * The plant's names known in any language; query words found in none of them are
 * taken as a cultivar ("šanta walker's low" vs "Šanta hroznovitá" → "Walker's Low").
 */
function splitQuery(query: string, page: WikiPage, entity: TaxonEntity) {
  const known = new Set(
    [page.title, entity.taxonName ?? '', ...Object.values(entity.labels)].flatMap(words).map(normalize),
  );
  const queryWords = words(query);
  const matched = queryWords.filter((w) => known.has(normalize(w)));
  const rest = queryWords.filter((w) => !known.has(normalize(w)));
  return { matched, cultivar: rest.length ? titleCase(rest.join(' ')) : null };
}

function toCandidate(query: string, page: WikiPage, entity: TaxonEntity, language: Language): PlantCandidate {
  const { matched, cultivar } = splitQuery(query, page, entity);
  const taxonName = entity.taxonName!;
  return {
    wikidataId: page.wikidataId!,
    name: cultivar && matched.length ? `${capitalize(matched.join(' '))} ${cultivar}` : page.title,
    latinName: cultivar ? `${taxonName} '${cultivar}'` : taxonName,
    rank: RANKS[entity.rankId ?? ''] ?? null,
    cultivar,
    articleTitle: page.title,
    description: page.extract.trim(),
    url: page.url,
    language,
    image: null,
  };
}

/**
 * When some result accounts for every searched word ("šalvěj lékařská" → Šalvěj lékařská),
 * results that only guess the rest is a cultivar (Šalvěj + 'Lékařská') are dropped.
 */
export function preferExactMatches(candidates: PlantCandidate[]): PlantCandidate[] {
  const exact = candidates.filter((c) => !c.cultivar);
  return exact.length ? exact : candidates;
}

/** Commons file names, as the image APIs write them ("A_b.jpg" and "A b.jpg" are one file). */
export function fileKey(file: string): string {
  return file.replace(/^File:/i, '').replaceAll('_', ' ').trim();
}

/** Adds each candidate's picture, if Commons knows its licence (one request for all). */
async function withImages(deps: LookupDeps, candidates: PlantCandidate[], pages: Map<string, WikiPage>) {
  const files = [...new Set(candidates.map((c) => pages.get(c.wikidataId)?.image?.file).filter((f): f is string => !!f))];
  if (!files.length) return candidates;
  const credits = await deps.getImageCredits(files);
  return candidates.map((c) => {
    const image = pages.get(c.wikidataId)?.image;
    const credit = image ? credits[fileKey(image.file)] : undefined;
    return credit && image ? { ...c, image: { url: image.thumbUrl, ...credit } } : c;
  });
}

/** Wikidata items fetched so far in one lookup: later rounds mostly find the same pages. */
type EntityMemo = Map<string, TaxonEntity | null>;

async function entitiesFor(deps: LookupDeps, ids: string[], memo: EntityMemo): Promise<Record<string, TaxonEntity>> {
  const missing = [...new Set(ids)].filter((id) => !memo.has(id));
  if (missing.length) {
    const fetched = await deps.getEntities(missing);
    for (const id of missing) memo.set(id, fetched[id] ?? null);
  }
  const out: Record<string, TaxonEntity> = {};
  for (const id of ids) {
    const entity = memo.get(id);
    if (entity) out[id] = entity;
  }
  return out;
}

/** The plants among the search hits, and the page each came from (for its picture). */
async function plantsIn(
  deps: LookupDeps,
  language: Language,
  query: string,
  originalQuery: string,
  memo: EntityMemo,
): Promise<{ candidates: PlantCandidate[]; pages: Map<string, WikiPage> }> {
  const pages = (await deps.searchWikipedia(language, query)).filter((p) => p.wikidataId);
  if (!pages.length) return { candidates: [], pages: new Map() };
  const entities = await entitiesFor(deps, pages.map((p) => p.wikidataId!), memo);
  const byId = new Map<string, WikiPage>();
  const candidates: PlantCandidate[] = [];
  for (const page of pages) {
    const entity = entities[page.wikidataId!];
    if (!entity?.isPlant || !entity.taxonName || byId.has(page.wikidataId!)) continue;
    byId.set(page.wikidataId!, page);
    candidates.push(toCandidate(originalQuery, page, entity, language));
  }
  return { candidates, pages: byId };
}

/**
 * Plants matching the query: Wikipedia in the user's language first, then the other one;
 * if neither finds a plant, again without the last word(s) ("šanta walker's low" →
 * "šanta"), keeping the dropped words as the cultivar.
 */
export async function lookupPlant(deps: LookupDeps, query: string, language: Language): Promise<PlantCandidate[]> {
  const queryWords = words(query);
  if (!queryWords.join('').length || normalize(query).length < 2) return [];
  const languages: Language[] = language === 'cs' ? ['cs', 'en'] : ['en', 'cs'];
  const memo: EntityMemo = new Map();

  for (let drop = 0; drop <= Math.min(MAX_DROPPED_WORDS, queryWords.length - 1); drop++) {
    const shorter = queryWords.slice(0, queryWords.length - drop).join(' ');
    for (const lang of languages) {
      const { candidates, pages } = await plantsIn(deps, lang, shorter, query, memo);
      if (candidates.length) return withImages(deps, preferExactMatches(candidates).slice(0, MAX_CANDIDATES), pages);
    }
  }
  return [];
}

/** Bumped when the cached result's shape changes (v2: pictures), so old entries aren't used. */
const CACHE_VERSION = 'v3'; // v3: no cultivar guesses next to an exact match

/** Lookup cache key: the same search in the same language. */
export function cacheKey(query: string, language: Language): string {
  return `${CACHE_VERSION}:${language}:${words(query).map(normalize).join(' ')}`;
}
