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

export function resolvePaymentRetryEndpoint(configuration: Readonly<Record<string, string>>): string | undefined {
  return configuration.LEGACY_PAYMENT_RETRY_ENDPOINT ?? configuration.PAYMENT_RETRY_ENDPOINT;
}

export function checkPaymentRetryService(
  _request: Request,
  response: Response,
  state: TargetState,
): void {
  const requestId = response.locals.requestId as string;
  const endpoint = resolvePaymentRetryEndpoint(state.data().configuration);

  if (endpoint === undefined || endpoint.trim() === "") {
    state.log(requestId, "warn", "PAYMENT_RETRY_ENDPOINT_UNUSABLE", {
      selectedSource: "legacy",
      selectedLength: endpoint?.length ?? null,
    });
    response.status(503).json({ error: "payment retry service unavailable", requestId });
    return;
  }

  response.status(200).json({ available: true });
}
