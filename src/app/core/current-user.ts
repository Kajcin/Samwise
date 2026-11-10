import { supabase } from './supabase-client';

/** The signed-in user's id, for setting `user_id` on inserts (RLS requires it to match auth.uid()). */
export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}
