import { assertEquals } from 'jsr:@std/assert@1';
import { cacheKey, Language, LookupDeps, lookupPlant, TaxonEntity, WikiPage } from './lookup.ts';

// Shaped like the real answers for these searches (cs.wikipedia.org, Wikidata, Nov 2026).
const page = (title: string, wikidataId: string | null, extract = `${title} je…`): WikiPage => ({
  title, wikidataId, extract, url: `https://cs.wikipedia.org/wiki/${encodeURIComponent(title)}`,
});
const plant = (taxonName: string, rankId: string, cs: string, en: string): TaxonEntity => ({
  taxonName, rankId, isPlant: true, labels: { cs, en },
});

const ENTITIES: Record<string, TaxonEntity> = {
  Q2319755: plant('Nepeta racemosa', 'Q7432', 'šanta hroznovitá', 'Nepeta racemosa'),
  Q303820: plant('Nepeta', 'Q34740', 'šanta', 'Nepeta'),
  Q912457: plant('Nepeta ×faassenii', 'Q1306176', 'šanta zkřížená', 'Nepeta × faassenii'),
  Q23501: plant('Solanum lycopersicum', 'Q7432', 'rajče jedlé', 'tomato'),
  Q28425: { taxonName: 'Chiroptera', rankId: 'Q36602', isPlant: false, labels: { cs: 'letouni', en: 'Chiroptera' } },
  Q315796: { taxonName: null, rankId: null, isPlant: false, labels: { cs: 'Santa Claus' } },
};

function fakes(searches: Record<string, WikiPage[]>) {
  const log: string[] = [];
  const entityRequests: string[][] = [];
  const deps: LookupDeps = {
    searchWikipedia: (language: Language, query: string) => {
      log.push(`${language}: ${query}`);
      return Promise.resolve(searches[`${language}: ${query}`] ?? []);
    },
    getEntities: (ids) => {
      entityRequests.push(ids);
      return Promise.resolve(Object.fromEntries(ids.filter((id) => ENTITIES[id]).map((id) => [id, ENTITIES[id]])));
    },
  };
  return { deps, log, entityRequests };
}

Deno.test('finds plants and leaves out animals, people and pages without a Wikidata item', async () => {
  const { deps } = fakes({
    'cs: šanta': [
      page('Šanta', 'Q303820', 'Šanta (Nepeta) je rod…'),
      page('Santa Claus', 'Q315796'),
      page('Šanta zkřížená', 'Q912457'),
      page('Seznam šant', null),
    ],
  });

  const found = await lookupPlant(deps, 'šanta', 'cs');

  assertEquals(found.map((c) => [c.name, c.latinName, c.rank, c.cultivar]), [
    ['Šanta', 'Nepeta', 'genus', null],
    ['Šanta zkřížená', 'Nepeta ×faassenii', 'hybrid', null],
  ]);
  assertEquals(found[0].description, 'Šanta (Nepeta) je rod…');
  assertEquals(found[0].url, 'https://cs.wikipedia.org/wiki/%C5%A0anta');
  assertEquals(found[0].language, 'cs');
});

Deno.test('takes the words the plant doesn’t explain as the cultivar', async () => {
  const { deps } = fakes({
    "cs: šanta walker's low": [page('Šanta hroznovitá', 'Q2319755'), page('Letouni', 'Q28425')],
  });

  const [catmint] = await lookupPlant(deps, "šanta walker's low", 'cs');

  assertEquals(catmint.name, "Šanta Walker's Low");
  assertEquals(catmint.latinName, "Nepeta racemosa 'Walker's Low'");
  assertEquals(catmint.cultivar, "Walker's Low");
  assertEquals(catmint.articleTitle, 'Šanta hroznovitá');
});

Deno.test('a name in the other language isn’t mistaken for a cultivar', async () => {
  const { deps } = fakes({ 'cs: tomato': [page('Rajče jedlé', 'Q23501')] });

  const [tomato] = await lookupPlant(deps, 'tomato', 'cs');
  assertEquals([tomato.name, tomato.cultivar, tomato.latinName], ['Rajče jedlé', null, 'Solanum lycopersicum']);
});

Deno.test('tries the other Wikipedia, then fewer words', async () => {
  const { deps, log } = fakes({ "cs: šanta": [page('Šanta', 'Q303820')] });

  const [found] = await lookupPlant(deps, "šanta walker's low", 'en');

  assertEquals(log, ["en: šanta walker's low", "cs: šanta walker's low", "en: šanta walker's", "cs: šanta walker's", 'en: šanta', 'cs: šanta']);
  assertEquals([found.name, found.latinName, found.language], ["Šanta Walker's Low", "Nepeta 'Walker's Low'", 'cs']);
});

Deno.test('returns nothing for empty or one-letter searches, or when no plant is found', async () => {
  const { deps, log } = fakes({ 'cs: santa claus': [page('Santa Claus', 'Q315796')] });

  assertEquals(await lookupPlant(deps, '  ', 'cs'), []);
  assertEquals(await lookupPlant(deps, 'a', 'cs'), []);
  assertEquals(log, []);
  assertEquals(await lookupPlant(deps, 'santa claus', 'cs'), []);
});

Deno.test('the cache key ignores case, accents, spacing and punctuation but not the language', () => {
  assertEquals(cacheKey("  Šanta   Walker's LOW ", 'cs'), 'cs:santa walkers low');
  assertEquals(cacheKey('šanta', 'en'), 'en:santa');
});

Deno.test('asks Wikidata about each page only once per lookup, however many rounds', async () => {
  const bats = page('Letouni', 'Q28425');
  const { deps, entityRequests } = fakes({
    'en: xyzzy plant qq': [bats],
    'cs: xyzzy plant qq': [bats],
    'en: xyzzy plant': [bats, page('Santa Claus', 'Q315796')],
    'cs: xyzzy': [bats],
  });

  assertEquals(await lookupPlant(deps, 'xyzzy plant qq', 'en'), []);
  assertEquals(entityRequests, [['Q28425'], ['Q315796']]);
});
