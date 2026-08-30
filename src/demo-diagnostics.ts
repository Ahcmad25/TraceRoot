import type { InvestigationEvent } from "./domain/investigation.js";

export type SafeDemoFailureReason =
  | "authentication_error"
  | "insufficient_quota"
  | "model_not_found"
  | "invalid_request"
  | "network_error"
  | "schema_parse_error"
  | "provider_response_error";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function safeDemoFailureReason(
  terminationReason: string,
  events: readonly InvestigationEvent[],
): SafeDemoFailureReason | null {
  if (terminationReason === "invalid_json" || terminationReason === "invalid_structured_output") {
    return "schema_parse_error";
  }
  if (terminationReason !== "provider_error") return null;

  const failure = [...events].reverse().find((event) => {
    if (event.type !== "agent-step-recorded") return false;
    return typeof record(event.structuredData)?.error === "string";
  });
  const data = failure?.type === "agent-step-recorded" ? record(failure.structuredData) : null;
  const providerCode = typeof data?.providerCode === "string" ? data.providerCode.toLowerCase() : "";

  if (["invalid_api_key", "missing_api_key", "authentication_error", "unauthorized", "http_401"].includes(providerCode)) {
    return "authentication_error";
  }
  if (providerCode === "insufficient_quota") return "insufficient_quota";
  if (["model_not_found", "unknown_model"].includes(providerCode)) return "model_not_found";
  if (["network_error", "timeout"].includes(providerCode)) return "network_error";
  if (["invalid_request", "invalid_request_error", "http_400", "unsupported_parameter"].includes(providerCode)) {
    return "invalid_request";
  }
  if (["invalid_response", "missing_output", "response_too_large", "refusal"].includes(providerCode)) {
    return "provider_response_error";
  }
  return "provider_response_error";
}
