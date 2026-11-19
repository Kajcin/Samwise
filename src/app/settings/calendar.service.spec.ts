import { CalendarConnectError, CalendarService } from './calendar.service';
import { supabase } from '../core/supabase-client';

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
  });

  it('isConnected() asks the has_calendar_connection RPC', async () => {
    spyOn(supabase, 'rpc').and.resolveTo({ data: true, error: null } as any);

    expect(await service.isConnected()).toBeTrue();
    expect(supabase.rpc).toHaveBeenCalledWith('has_calendar_connection');
  });

  it('connect() posts the code to the connect-calendar function', async () => {
    const invoke = jasmine.createSpy('invoke').and.resolveTo({ data: { connected: true, backfilled: 4, failed: 1 }, error: null });
    // supabase.functions is a getter that builds a new client each time.
    spyOnProperty(supabase, 'functions', 'get').and.returnValue({ invoke } as any);

    expect(await service.connect('code-1')).toEqual({ backfilled: 4, failed: 1 });
    expect(invoke).toHaveBeenCalledWith('connect-calendar', { body: { code: 'code-1' } });
  });

  it("connect() throws the function's error code", async () => {
    const context = new Response(JSON.stringify({ error: 'google_rejected_code' }), { status: 400 });
    const invoke = jasmine.createSpy('invoke').and.resolveTo({ data: null, error: { message: 'non-2xx', context } });
    spyOnProperty(supabase, 'functions', 'get').and.returnValue({ invoke } as any);

    await expectAsync(service.connect('code-1')).toBeRejectedWith(new CalendarConnectError('google_rejected_code'));
  });

  it('connect() falls back to a generic code when the response has no body', async () => {
    const invoke = jasmine.createSpy('invoke').and.resolveTo({ data: null, error: { message: 'network' } });
    spyOnProperty(supabase, 'functions', 'get').and.returnValue({ invoke } as any);

    await expectAsync(service.connect('code-1')).toBeRejectedWith(new CalendarConnectError('connect_failed'));
  });
});
