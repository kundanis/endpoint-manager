import { Router } from "express";
import { subscribe } from "../events/bus";

// Server-Sent Events stream for the admin console. The browser opens one long-lived GET here
// (EventSource) and the server pushes "invalidate" events as data changes, so the console
// refreshes instantly instead of polling. One-directional (server -> client) and plain HTTP,
// so it needs no WebSocket upgrade and rides the same auth cookie as every other admin call.
export const eventsRouter = Router();

eventsRouter.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform stops any intermediary from buffering/compressing the stream; X-Accel-
    // Buffering disables nginx proxy buffering if one is ever put in front.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Tell the client to wait 5s before reconnecting if the stream drops.
  res.write("retry: 5000\n\n");
  res.write(": connected\n\n");

  const unsubscribe = subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Keepalive comment every 25s so idle NAT/proxy timeouts don't silently drop the stream.
  const keepalive = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});
