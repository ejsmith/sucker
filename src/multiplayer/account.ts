import { supabase } from './supabase';

type DeleteAccountResponse = {
  deleted?: boolean;
  error?: string;
};

export async function deleteCurrentAccount() {
  const { data, error } = await supabase.functions.invoke<DeleteAccountResponse>('delete-account');
  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }
  if (!data?.deleted) {
    throw new Error(data?.error ?? 'The account could not be deleted.');
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
  if (signOutError) {
    throw signOutError;
  }
}

async function getFunctionErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as DeleteAccountResponse;
        if (body.error) return body.error;
      } catch {
        // Fall back to the Supabase client message below.
      }
    }
  }

  return error instanceof Error ? error.message : 'The account could not be deleted.';
}
