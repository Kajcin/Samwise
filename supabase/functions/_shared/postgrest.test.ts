import { assertEquals } from 'jsr:@std/assert@1';
import { RELATIONSHIP_NOT_FOUND, withSchemaRetry } from './postgrest.ts';

const notYet = { data: null, error: { message: 'Could not find a relationship', code: RELATIONSHIP_NOT_FOUND } };

Deno.test('withSchemaRetry waits while the schema reloads, then returns the result', async () => {
  const answers = [notYet, notYet, { data: 'task', error: null }];
  const waits: number[] = [];

  const result = await withSchemaRetry(async () => answers.shift()!, async (ms) => void waits.push(ms));

  assertEquals(result, { data: 'task', error: null });
  assertEquals(waits, [1000, 2000]);
});

Deno.test('withSchemaRetry gives up after a few tries, and passes other errors straight on', async () => {
  let calls = 0;
  const stuck = await withSchemaRetry(async () => (calls++, notYet), async () => {}, 3);
  assertEquals([stuck, calls], [notYet, 3]);

  calls = 0;
  const other = { data: null, error: { message: 'permission denied', code: '42501' } };
  assertEquals(await withSchemaRetry(async () => (calls++, other), async () => {}), other);
  assertEquals(calls, 1);
});
