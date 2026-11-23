// The disconnect flow, with its I/O injected so it can be unit-tested (index.ts wires it up).
import { InvalidGrantError } from '../_shared/google.ts';

export interface DisconnectDeps {
  loadCredentials(userId: string): Promise<{ refresh_token: string | null; calendar_id: string } | null>;
  refreshAccessToken(refreshToken: string): Promise<{ access_token: string }>;
  deleteCalendar(accessToken: string, calendarId: string): Promise<void>;
  revokeToken(token: string): Promise<void>;
  deleteCredentials(userId: string): Promise<void>;
  /** Forget all of the user's event ids (their calendar is gone or no longer used). */
  clearEventIds(userId: string): Promise<void>;
}

export interface DisconnectResult {
  /**
   * False when Samwise had no access left to delete the "Samwise" calendar with
   * (the user removed it in their Google account): it's still there for them to delete.
   */
  calendarDeleted: boolean;
}

/**
 * Deletes the Samwise calendar, revokes Samwise's access, and forgets the connection.
 * If deleting the calendar fails, nothing is forgotten, so the user can try again.
 */
export async function disconnectCalendar(deps: DisconnectDeps, userId: string): Promise<DisconnectResult> {
  const credentials = await deps.loadCredentials(userId);
  if (!credentials) return { calendarDeleted: false };

  let calendarDeleted = false;
  if (credentials.refresh_token) {
    let accessToken: string | null = null;
    try {
      accessToken = (await deps.refreshAccessToken(credentials.refresh_token)).access_token;
    } catch (e) {
      // Access was removed in Google meanwhile: nothing left to delete or revoke with.
      if (!(e instanceof InvalidGrantError)) throw e;
    }
    if (accessToken) {
      await deps.deleteCalendar(accessToken, credentials.calendar_id); // an already-deleted one counts
      calendarDeleted = true;
      try {
        await deps.revokeToken(credentials.refresh_token);
      } catch (e) {
        // The calendar is gone and we forget the token below; the grant then just
        // lingers in the user's Google account, where they can remove it.
        console.error('token revoke failed:', e instanceof Error ? e.message : e);
      }
    }
  }

  // Deleting the row also stops the tasks webhook for this user (migration 0007),
  // so clearing the event ids below doesn't reach calendar-sync.
  await deps.deleteCredentials(userId);
  await deps.clearEventIds(userId);
  return { calendarDeleted };
}
