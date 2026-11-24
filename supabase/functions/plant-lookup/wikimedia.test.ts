import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { getEntities, getImageCredits, plainText, searchWikipedia } from './wikimedia.ts';

function stubFetch(body: unknown, status = 200) {
  const original = globalThis.fetch;
  const calls: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test('searchWikipedia asks for intros and Wikidata ids, and keeps the search order', async () => {
  const f = stubFetch({
    query: {
      pages: [
        { index: 2, title: 'Šanta kočičí', pageprops: { wikibase_item: 'Q161139' }, extract: 'Šanta kočičí (Nepeta cataria)…', fullurl: 'https://cs.wikipedia.org/wiki/%C5%A0anta_ko%C4%8Di%C4%8D%C3%AD' },
        {
          index: 1, title: 'Šanta', pageprops: { wikibase_item: 'Q303820' }, extract: 'Šanta (Nepeta) je rod…',
          fullurl: 'https://cs.wikipedia.org/wiki/%C5%A0anta',
          pageimage: 'Nepeta_racemosa.jpg', thumbnail: { source: 'https://upload.wikimedia.org/thumb/Nepeta_racemosa.jpg' },
        },
        { index: 3, title: 'Seznam', extract: '' },
      ],
    },
  });
  try {
    const pages = await searchWikipedia('cs', 'šanta', 'test-agent/1.0');

    assertEquals(pages.map((p) => [p.title, p.wikidataId]), [['Šanta', 'Q303820'], ['Šanta kočičí', 'Q161139'], ['Seznam', null]]);
    const { url, init } = f.calls[0];
    assertEquals(url.origin, 'https://cs.wikipedia.org');
    assertEquals(url.searchParams.get('gsrsearch'), 'šanta');
    assertEquals(url.searchParams.get('ppprop'), 'wikibase_item');
    assertEquals(url.searchParams.get('redirects'), '1');
    assertEquals(url.searchParams.get('pilicense'), 'free'); // only freely licensed pictures
    assertEquals(pages[0].image, { file: 'Nepeta_racemosa.jpg', thumbUrl: 'https://upload.wikimedia.org/thumb/Nepeta_racemosa.jpg' });
    assertEquals(pages[1].image, null);
    assertEquals((init!.headers as Record<string, string>)['User-Agent'], 'test-agent/1.0');
  } finally { f.restore(); }
});

Deno.test('searchWikipedia handles no results and reports failures', async () => {
  let f = stubFetch({ batchcomplete: true });
  try {
    assertEquals(await searchWikipedia('en', 'zzz'), []);
  } finally { f.restore(); }
  f = stubFetch({}, 503);
  try {
    await assertRejects(() => searchWikipedia('en', 'zzz'), Error, '503');
  } finally { f.restore(); }
});

Deno.test('getEntities reads the taxon name, rank, plant databases and labels', async () => {
  const claim = (value: unknown) => [{ mainsnak: { datavalue: { value } } }];
  const f = stubFetch({
    entities: {
      Q2319755: {
        claims: { P225: claim('Nepeta racemosa'), P105: claim({ id: 'Q7432' }), P961: claim('1234-1') },
        labels: { cs: { value: 'šanta hroznovitá' }, en: { value: 'Nepeta racemosa' } },
      },
      Q28425: { claims: { P225: claim('Chiroptera'), P105: claim({ id: 'Q36602' }) }, labels: { cs: { value: 'letouni' } } },
      Q999: { missing: '' },
    },
  });
  try {
    const entities = await getEntities(['Q2319755', 'Q28425', 'Q999']);

    assertEquals(entities.Q2319755, {
      taxonName: 'Nepeta racemosa', rankId: 'Q7432', isPlant: true, labels: { cs: 'šanta hroznovitá', en: 'Nepeta racemosa' },
    });
    assertEquals(entities.Q28425.isPlant, false);
    assertEquals('Q999' in entities, false);
    assertEquals(f.calls[0].url.searchParams.get('ids'), 'Q2319755|Q28425|Q999');
  } finally { f.restore(); }
});

Deno.test('getEntities asks for nothing when there are no ids', async () => {
  const f = stubFetch({});
  try {
    assertEquals(await getEntities([]), {});
    assertEquals(f.calls.length, 0);
  } finally { f.restore(); }
});

Deno.test('retries when rate-limited (429), waiting as Wikimedia asks', async () => {
  const original = globalThis.fetch;
  const answers = [
    new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }),
    new Response(JSON.stringify({ query: { pages: [{ index: 1, title: 'Šanta', pageprops: { wikibase_item: 'Q303820' }, extract: '' }] } })),
  ];
  let calls = 0;
  globalThis.fetch = (() => { calls++; return Promise.resolve(answers.shift()!); }) as typeof fetch;
  try {
    assertEquals((await searchWikipedia('cs', 'šanta')).map((p) => p.title), ['Šanta']);
    assertEquals(calls, 2);
  } finally { globalThis.fetch = original; }
});

Deno.test('gives up after repeated rate limiting', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }));
  }) as typeof fetch;
  try {
    await assertRejects(() => getEntities(['Q1']), Error, '429');
    assertEquals(calls, 3);
  } finally { globalThis.fetch = original; }
});

Deno.test('plainText turns the author’s HTML into text', () => {
  assertEquals(plainText('<a href="//commons.wikimedia.org/wiki/User:Jane">Jane&nbsp;Doe</a> &amp; Co'), 'Jane Doe & Co');
  assertEquals(plainText(''), '');
});

Deno.test('getImageCredits reads author and licence, and skips files without a licence', async () => {
  const f = stubFetch({
    query: {
      pages: [
        {
          title: 'File:Nepeta racemosa.jpg',
          imageinfo: [{
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nepeta_racemosa.jpg',
            extmetadata: {
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a>' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
            },
          }],
        },
        { title: 'File:Mystery.jpg', imageinfo: [{ descriptionurl: 'x', extmetadata: {} }] },
      ],
    },
  });
  try {
    const credits = await getImageCredits(['Nepeta_racemosa.jpg', 'Mystery.jpg']);

    assertEquals(credits, {
      'Nepeta racemosa.jpg': {
        author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Nepeta_racemosa.jpg',
      },
    });
    assertEquals(f.calls[0].url.origin, 'https://commons.wikimedia.org');
    assertEquals(f.calls[0].url.searchParams.get('titles'), 'File:Nepeta racemosa.jpg|File:Mystery.jpg');
  } finally { f.restore(); }
});
