import { supabase } from '../core/supabase-client';
import { FunctionError } from '../core/edge-functions';
import { PlantLookupService } from './plant-lookup.service';

describe('PlantLookupService', () => {
  function stubInvoke(result: { data: unknown; error: unknown }): jasmine.Spy {
    const invoke = jasmine.createSpy('invoke').and.resolveTo(result);
    spyOnProperty(supabase, 'functions', 'get').and.returnValue({ invoke } as any);
    return invoke;
  }

  it('asks the plant-lookup function with the search and the language', async () => {
    const candidates = [{ wikidataId: 'Q303820', name: 'Šanta' }];
    const invoke = stubInvoke({ data: { candidates, cached: false }, error: null });

    expect(await new PlantLookupService().lookup("šanta walker's low", 'cs')).toEqual(candidates as any);
    expect(invoke).toHaveBeenCalledWith('plant-lookup', { body: { query: "šanta walker's low", language: 'cs' } });
  });

  it('reports an unreachable server', async () => {
    stubInvoke({ data: null, error: { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') } });

    await expectAsync(new PlantLookupService().lookup('šanta', 'cs')).toBeRejectedWith(new FunctionError('unreachable'));
  });

  it("passes on the function's error code", async () => {
    const context = new Response(JSON.stringify({ error: 'lookup_failed' }), { status: 502 });
    stubInvoke({ data: null, error: { name: 'FunctionsHttpError', context } });

    await expectAsync(new PlantLookupService().lookup('šanta', 'cs')).toBeRejectedWith(new FunctionError('lookup_failed'));
  });
});
