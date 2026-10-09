import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface ServerEvent {
  type: string;
  keys?: string[];
}

// Opens a single Server-Sent Events stream to the server and, when it pushes an "invalidate"
// event, refetches just those React Query keys. This is what makes the console update
// (near-)instantly instead of relying on polling - the remaining poll intervals are only a
// safety net for when the stream is briefly down. EventSource reconnects on its own; on each
// (re)connect we resync the push-driven queries in case an event was missed while offline.
//
// Mounted once, inside the authenticated shell (Layout), so it only runs while logged in.
export function useServerEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let closed = false;
    const source = new EventSource("/api/admin/events", { withCredentials: true });

    source.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ServerEvent;
        if (data.type === "invalidate" && Array.isArray(data.keys)) {
          for (const key of data.keys) queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onopen = () => {
      if (closed) return;
      // Catch up on anything that changed while the stream was down.
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
    };

    // EventSource retries automatically on error (honoring the server's retry hint), so there
    // is nothing to do in onerror except let it reconnect.

    return () => {
      closed = true;
      source.close();
    };
  }, [queryClient]);
}
