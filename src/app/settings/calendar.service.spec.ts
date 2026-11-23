import { CalendarError, CalendarService } from './calendar.service';
import { supabase } from '../core/supabase-client';

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
  });

  /** supabase.functions is a getter that builds a new client each time. */
  function stubInvoke(result: { data: unknown; error: unknown }): jasmine.Spy {
    const invoke = jasmine.createSpy('invoke').and.resolveTo(result);
    spyOnProperty(supabase, 'functions', 'get').and.returnValue({ invoke } as any);
    return invoke;
  }

  it('status() asks the calendar_connection_status RPC', async () => {
    spyOn(supabase, 'rpc').and.resolveTo({ data: 'revoked', error: null } as any);

    expect(await service.status()).toBe('revoked');
    expect(supabase.rpc).toHaveBeenCalledWith('calendar_connection_status');
  });

  it('status() rejects a value it does not know', async () => {
    spyOn(supabase, 'rpc').and.resolveTo({ data: 'maybe', error: null } as any);

    await expectAsync(service.status()).toBeRejectedWithError(/Unexpected calendar status/);
  });

  it('connect() posts the code to the connect-calendar function', async () => {
    const invoke = stubInvoke({ data: { connected: true, backfilled: 4, failed: 1 }, error: null });

    expect(await service.connect('code-1')).toEqual({ backfilled: 4, failed: 1 });
    expect(invoke).toHaveBeenCalledWith('connect-calendar', { body: { code: 'code-1' } });
  });

  it("connect() throws the function's error code", async () => {
    const context = new Response(JSON.stringify({ error: 'google_rejected_code' }), { status: 400 });
    stubInvoke({ data: null, error: { message: 'non-2xx', context } });

    await expectAsync(service.connect('code-1')).toBeRejectedWith(new CalendarError('google_rejected_code'));
  });

  it('connect() falls back to a generic code when the response has no body', async () => {
    stubInvoke({ data: null, error: { message: 'network' } });

    await expectAsync(service.connect('code-1')).toBeRejectedWith(new CalendarError('connect_failed'));
  });

  it('reports an unreachable server when the request never got an answer', async () => {
    stubInvoke({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch', context: new TypeError('Failed to fetch') } });

    await expectAsync(service.disconnect()).toBeRejectedWith(new CalendarError('unreachable'));
  });

  it('reports an unreachable server when the gateway answers instead of the function', async () => {
    // 503: local gateway with `supabase functions serve` not running; 404: function not deployed.
    const gatewayError = (status: number) => ({
      data: null,
      error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify({ message: 'name resolution failed' }), { status }) },
    });
    const invoke = stubInvoke(gatewayError(503));
    invoke.and.returnValues(Promise.resolve(gatewayError(503)), Promise.resolve(gatewayError(404)));

    await expectAsync(service.connect('code-1')).toBeRejectedWith(new CalendarError('unreachable'));
    await expectAsync(service.disconnect()).toBeRejectedWith(new CalendarError('unreachable'));
  });

  it("prefers the function's own error code over the status", async () => {
    const context = new Response(JSON.stringify({ error: 'disconnect_failed' }), { status: 500 });
    stubInvoke({ data: null, error: { name: 'FunctionsHttpError', context } });

    await expectAsync(service.disconnect()).toBeRejectedWith(new CalendarError('disconnect_failed'));
  });

  it('disconnect() calls the disconnect-calendar function', async () => {
    const invoke = stubInvoke({ data: { connected: false, calendarDeleted: true }, error: null });

    expect(await service.disconnect()).toEqual({ calendarDeleted: true });
    expect(invoke).toHaveBeenCalledWith('disconnect-calendar', { body: {} });
  });

  it('disconnect() throws the error code when it fails', async () => {
    stubInvoke({ data: null, error: { message: 'network' } });

    await expectAsync(service.disconnect()).toBeRejectedWith(new CalendarError('disconnect_failed'));
  });
});
