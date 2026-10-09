import { EventEmitter } from "node:events";

// In-process event bus for pushing "something changed, refetch X" nudges to connected admin
// consoles over SSE (see routes/events.routes.ts). This replaces most of the console's
// constant polling: instead of every tab re-querying every few seconds, the server tells open
// consoles the moment the relevant data changes, and they refetch just those queries.
//
// SCALING SEAM: this bus is in-process, so an event emitted on one server instance only
// reaches SSE clients connected to THAT instance. For multiple instances, publish these events
// through a shared channel (Redis pub/sub) so every instance's connected clients are notified.
// emitInvalidate / subscribe are the seam.

const emitter = new EventEmitter();
// One listener per connected SSE client; a busy console deployment can have many, so lift the
// default 10-listener warning ceiling.
emitter.setMaxListeners(0);

export interface ServerEvent {
  type: "invalidate";
  // React Query keys the console should invalidate/refetch, e.g. ["agents", "dashboardSummary"].
  keys: string[];
}

export function emitInvalidate(keys: string[]): void {
  emitter.emit("event", { type: "invalidate", keys } satisfies ServerEvent);
}

export function subscribe(listener: (e: ServerEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
