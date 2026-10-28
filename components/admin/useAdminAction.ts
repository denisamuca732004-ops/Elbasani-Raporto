'use client';
/** Runs an admin Server Action, shows the result and reloads the server data of the page. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFailure } from '@/lib/client/action';

export function useAdminAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>, message: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      router.refresh();
      setNotice(message || null);
      return result;
    } catch (err) {
      setError(err as ActionFailure);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run, setNotice, setError };
}
