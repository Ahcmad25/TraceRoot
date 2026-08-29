import type { Request, Response } from "express";
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
