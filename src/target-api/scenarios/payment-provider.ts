import type { Request, Response } from "express";
import type { TargetState } from "../state.js";

export function createPaymentClient(
  _request: Request,
  response: Response,
  state: TargetState,
): void {
  const requestId = response.locals.requestId as string;
  const apiKey = state.data().configuration.PAYMENT_API_KEY;

  if (apiKey === undefined) {
    state.log(requestId, "error", "PAYMENT_CLIENT_CONFIGURATION_MISSING", {
      key: "PAYMENT_API_KEY",
    });
    response.status(503).json({ error: "payment provider unavailable", requestId });
    return;
  }

  response.status(200).json({ provider: "sandbox", configured: true });
}
