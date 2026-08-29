import type { Request, Response } from "express";
import { selectSigningKey } from "../application-data.js";
import type { TargetState } from "../state.js";

export function findAccountByExternalId(externalId: string, state: TargetState) {
  return state.data().accounts.find((account) => account.id === externalId);
}

function publishLookupFailureAudit(state: TargetState): void {
  if (!state.data().auditSinkAvailable) {
    throw new Error("audit sink connection refused");
  }
}

export function getAccount(request: Request, response: Response, state: TargetState): void {
  const requestId = response.locals.requestId as string;
  const rawExternalId = request.params.externalId;
  const externalId = Array.isArray(rawExternalId)
    ? rawExternalId[0] ?? ""
    : rawExternalId ?? "";
  const account = findAccountByExternalId(externalId, state);

  if (account === undefined) {
    state.log(requestId, "warn", "ACCOUNT_LOOKUP_RETURNED_NO_RESULT", { externalId });
    try {
      publishLookupFailureAudit(state);
    } catch (error: unknown) {
      state.log(requestId, "error", "AUDIT_PIPELINE_FATAL_DELIVERY_FAILURE", {
        message: error instanceof Error ? error.message : "unknown audit failure",
      });
    }
    response.status(500).json({ error: "account resolution failed", requestId });
    return;
  }

  response.status(200).json(account);
}

export function validateSession(request: Request, response: Response, state: TargetState): void {
  const requestId = response.locals.requestId as string;
  const rawKeyId = request.params.keyId;
  const requestedKeyId = Array.isArray(rawKeyId) ? rawKeyId[0] ?? "" : rawKeyId ?? "";
  const selectedKey = selectSigningKey(requestedKeyId, state.data());

  if (selectedKey === undefined || selectedKey.id !== requestedKeyId || !selectedKey.active) {
    state.log(requestId, "warn", "SESSION_SIGNATURE_REJECTED", {
      requestedKeyId,
      selectedKeyId: selectedKey?.id ?? null,
    });
    response.status(401).json({ error: "session validation failed", requestId });
    return;
  }

  response.status(200).json({ valid: true, keyId: selectedKey.id });
}
