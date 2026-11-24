import { assertEquals } from 'jsr:@std/assert@1';
import { cacheKey, ImageCredit, Language, LookupDeps, lookupPlant, TaxonEntity, WikiPage } from './lookup.ts';

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

function fakes(searches: Record<string, WikiPage[]>, credits: Record<string, ImageCredit> = {}) {
  const log: string[] = [];
  const entityRequests: string[][] = [];
  const imageRequests: string[][] = [];
  const deps: LookupDeps = {
    searchWikipedia: (language: Language, query: string) => {
      log.push(`${language}: ${query}`);
      return Promise.resolve(searches[`${language}: ${query}`] ?? []);
    },
    getEntities: (ids) => {
      entityRequests.push(ids);
      return Promise.resolve(Object.fromEntries(ids.filter((id) => ENTITIES[id]).map((id) => [id, ENTITIES[id]])));
    },
    getImageCredits: (files) => {
      imageRequests.push(files);
      return Promise.resolve(Object.fromEntries(Object.entries(credits).filter(([file]) => files.some((f) => f.replaceAll('_', ' ') === file))));
    },
  };
  return { deps, log, entityRequests, imageRequests };
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
  assertEquals(cacheKey("  Šanta   Walker's LOW ", 'cs'), 'v3:cs:santa walkers low');
  assertEquals(cacheKey('šanta', 'en'), 'v3:en:santa');
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

Deno.test('adds each plant’s free picture with its credit, in one request', async () => {
  const withImage = (p: WikiPage, file: string): WikiPage => ({ ...p, image: { file, thumbUrl: `https://upload.wikimedia.org/thumb/${file}` } });
  const { deps, imageRequests } = fakes(
    {
      'cs: šanta': [
        withImage(page('Šanta', 'Q303820'), 'Nepeta_racemosa.jpg'),
        withImage(page('Šanta zkřížená', 'Q912457'), 'No_licence.jpg'),
        page('Šanta hroznovitá', 'Q2319755'),
      ],
    },
    {
      'Nepeta racemosa.jpg': {
        author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Nepeta_racemosa.jpg',
      },
    },
  );

  const found = await lookupPlant(deps, 'šanta', 'cs');

  assertEquals(imageRequests, [['Nepeta_racemosa.jpg', 'No_licence.jpg']]);
  assertEquals(found[0].image, {
    url: 'https://upload.wikimedia.org/thumb/Nepeta_racemosa.jpg',
    author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Nepeta_racemosa.jpg',
  });
  assertEquals(found[1].image, null); // its licence is unknown: not shown
  assertEquals(found[2].image, null); // the article has no picture
});

Deno.test('asks for no credits when no plant has a picture', async () => {
  const { deps, imageRequests } = fakes({ 'cs: šanta': [page('Šanta', 'Q303820')] });

  await lookupPlant(deps, 'šanta', 'cs');
  assertEquals(imageRequests, []);
});

Deno.test('next to an exact match, results that only guess a cultivar are left out', async () => {
  const ENTITY = (taxonName: string, cs: string): TaxonEntity => ({ taxonName, rankId: 'Q7432', isPlant: true, labels: { cs } });
  const { deps } = fakes({
    'cs: šalvěj lékařská': [page('Šalvěj lékařská', 'Q1'), page('Šalvěj', 'Q2'), page('Šalvěj luční', 'Q3')],
  });
  deps.getEntities = () => Promise.resolve({
    Q1: ENTITY('Salvia officinalis', 'šalvěj lékařská'),
    Q2: ENTITY('Salvia', 'šalvěj'),
    Q3: ENTITY('Salvia pratensis', 'šalvěj luční'),
  });

  const found = await lookupPlant(deps, 'šalvěj lékařská', 'cs');

  assertEquals(found.map((c) => [c.name, c.cultivar]), [['Šalvěj lékařská', null]]);
});
