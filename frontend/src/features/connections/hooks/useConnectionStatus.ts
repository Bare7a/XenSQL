import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/api';
import type { ConnectionStatus } from '@/types';

// Fetches ConnectionStatus when live, clears otherwise; exposes setter so query:stream:done can refresh it.
export function useConnectionStatus(
  connectionId: string | undefined,
  isConnected: boolean
): {
  status: ConnectionStatus | null;
  setStatus: (status: ConnectionStatus | null) => void;
} {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    if (!connectionId || !isConnected) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    api
      .getConnectionStatus(connectionId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    // Drop a slow response if the connection changed, so it can't overwrite a newer status.
    return () => {
      cancelled = true;
    };
  }, [connectionId, isConnected]);

  return { status, setStatus };
}
