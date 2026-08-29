import type { Server } from "node:http";
import { createTargetApi } from "./app.js";

export interface EphemeralTarget {
  readonly server: Server;
  readonly baseUrl: string;
}

export function startEphemeralTarget(): Promise<EphemeralTarget> {
  const runtime = createTargetApi();
  return new Promise((resolvePromise, reject) => {
    const server = runtime.app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Target API did not expose a TCP address"));
        return;
      }
      resolvePromise({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.on("error", reject);
  });
}

export function closeTarget(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
  });
}
