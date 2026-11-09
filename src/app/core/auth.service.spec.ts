import { AuthService } from './auth.service';
import { supabase } from './supabase-client';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it('starts with no current user', () => {
    expect(service.currentUser()).toBeNull();
  });

  it('signInWithGoogle calls supabase OAuth with google provider, basic scopes only, and returns to the app', async () => {
    spyOn(supabase.auth, 'signInWithOAuth').and.resolveTo({ data: { provider: 'google', url: '' }, error: null } as any);
    await service.signInWithGoogle();
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { scopes: 'email profile', redirectTo: window.location.origin },
    });
  });

  it('signOut calls supabase.auth.signOut and clears currentUser', async () => {
    spyOn(supabase.auth, 'signOut').and.resolveTo({ error: null } as any);
    (service as any).currentUserSignal.set({ id: 'u1' } as any);
    await service.signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(service.currentUser()).toBeNull();
  });

  it('whenReady resolves only after the stored session has been restored', async () => {
    const user = { id: 'u1' } as any;
    spyOn(supabase.auth, 'getSession').and.resolveTo({ data: { session: { user } }, error: null } as any);
    const fresh = new AuthService();
    await fresh.whenReady();
    expect(fresh.currentUser()).toBe(user);
  });
});
