import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTargetApi } from "../../src/target-api/app.js";
import { createExecuteReproductionTool } from "../../src/tools/execute-reproduction.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const runtime = createTargetApi();
  await new Promise<void>((resolvePromise, reject) => {
    server = runtime.app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Missing target address"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolvePromise();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
  });
});

const reproductionInput = {
  scenarioId: "scenario-001",
  request: {
    method: "POST",
    path: "/api/users/register",
    body: { email: "ada@example.test" },
  },
  expectations: {
    required: {
      method: "POST",
      path: "/api/users/register",
      status: 500,
      bodyContains: "user registration failed",
    },
    supporting: { logContains: ["USER_REGISTRATION_UNHANDLED"] },
  },
};

describe("execute_reproduction", () => {
  it("resets deterministically and captures only correlated logs", async () => {
    let evidenceSequence = 0;
    const tool = createExecuteReproductionTool({
      baseUrl,
      correlationId: () => "repro-case-001-fixed",
      clock: () => new Date("2026-08-29T00:00:00.000Z"),
      evidenceId: () => `evidence-${++evidenceSequence}`,
    });

    const first = await tool(reproductionInput);
    const second = await tool(reproductionInput);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.outcome).toBe("reproduced");
    expect(second.data).toEqual(first.data);
    expect(first.data.logs.length).toBeGreaterThan(0);
    expect(first.data.logs.every((log) => log.requestId === "repro-case-001-fixed")).toBe(true);
    expect(first.data.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(first.evidence.map((evidence) => evidence.kind)).toEqual(["http", "log"]);
  });

  it("returns reproduced when required signatures match even if one supporting marker fails", async () => {
    const tool = createExecuteReproductionTool({ baseUrl, correlationId: () => "repro-supporting-mismatch" });
    const result = await tool({
      ...reproductionInput,
      expectations: {
        ...reproductionInput.expectations,
        supporting: { logContains: ["USER_REGISTRATION_UNHANDLED", "profile"] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("reproduced");
    expect(result.data.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log", requirement: "supporting", expected: "USER_REGISTRATION_UNHANDLED", passed: true }),
      expect.objectContaining({ kind: "log", requirement: "supporting", expected: "profile", passed: false }),
    ]));
    expect(result.data.assertions.filter((assertion) => assertion.requirement === "required").every((assertion) => assertion.passed)).toBe(true);
  });

  it("returns not-reproduced when the required status does not match", async () => {
    const tool = createExecuteReproductionTool({ baseUrl, correlationId: () => "repro-mismatch" });
    const result = await tool({
      ...reproductionInput,
      expectations: {
        ...reproductionInput.expectations,
        required: { ...reproductionInput.expectations.required, status: 200 },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("not-reproduced");
    expect(result.data.assertions).toContainEqual(expect.objectContaining({ kind: "status", requirement: "required", passed: false }));
  });

  it("returns not-reproduced when the required response signature does not match", async () => {
    const tool = createExecuteReproductionTool({ baseUrl, correlationId: () => "repro-body-mismatch" });
    const result = await tool({
      ...reproductionInput,
      expectations: {
        ...reproductionInput.expectations,
        required: { ...reproductionInput.expectations.required, bodyContains: "different failure" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("not-reproduced");
    expect(result.data.assertions).toContainEqual(expect.objectContaining({ kind: "body", requirement: "required", passed: false }));
  });

  it.each([
    ["method", "GET", "/api/users/register"],
    ["path", "POST", "/api/users/other"],
  ] as const)("returns not-reproduced when the required %s differs", async (_criterion, method, path) => {
    const tool = createExecuteReproductionTool({ baseUrl, correlationId: () => `repro-${_criterion}-mismatch` });
    const result = await tool({
      ...reproductionInput,
      expectations: {
        ...reproductionInput.expectations,
        required: { ...reproductionInput.expectations.required, method, path },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("not-reproduced");
    expect(result.data.assertions).toContainEqual(expect.objectContaining({ kind: _criterion, requirement: "required", passed: false }));
  });

  it("returns inconclusive for reset transport failure and keeps forbidden requests typed", async () => {
    const unavailable = createExecuteReproductionTool({
      baseUrl: "http://127.0.0.1:1",
      timeoutMs: 500,
      correlationId: () => "repro-unavailable",
    });
    await expect(unavailable(reproductionInput)).resolves.toMatchObject({
      ok: true,
      data: { outcome: "inconclusive", resetSucceeded: false, response: { status: null } },
    });

    const live = createExecuteReproductionTool({ baseUrl, correlationId: () => "repro-control-denied" });
    await expect(live({
      ...reproductionInput,
      request: { method: "GET", path: "/__control/logs" },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
  });
});
