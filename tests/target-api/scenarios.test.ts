import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createTargetApi, type TargetApiRuntime } from "../../src/target-api/app.js";
import type { ScenarioId } from "../../src/target-api/types.js";

let runtime: TargetApiRuntime;

beforeEach(() => {
  runtime = createTargetApi();
});

async function reset(scenarioId: ScenarioId): Promise<void> {
  await request(runtime.app)
    .post(`/__control/reset/${scenarioId}`)
    .expect(200, { scenarioId, reset: true });
}

describe("controlled target API failure scenarios", () => {
  it("case-001 fails deterministically when profile is absent", async () => {
    await reset("scenario-001");
    const response = await request(runtime.app)
      .post("/api/users/register")
      .send({ email: "ada@example.test" })
      .expect(500);

    expect(response.body).toEqual({
      error: "user registration failed",
      requestId: "trace-0001",
    });
    expect(runtime.state.logs("trace-0001").map((log) => log.message)).toEqual([
      "REQUEST_RECEIVED",
      "USER_REGISTRATION_UNHANDLED",
    ]);
  });

  it("case-002 fails because the payment configuration name is mismatched", async () => {
    await reset("scenario-002");
    const response = await request(runtime.app)
      .get("/api/payments/provider")
      .expect(503);

    expect(response.body).toEqual({
      error: "payment provider unavailable",
      requestId: "trace-0001",
    });
    expect(runtime.state.logs("trace-0001")[1]).toMatchObject({
      message: "PAYMENT_CLIENT_CONFIGURATION_MISSING",
      details: { key: "PAYMENT_API_KEY" },
    });
  });

  it("case-003 exposes string concatenation in the computed total", async () => {
    await reset("scenario-003");
    const response = await request(runtime.app)
      .post("/api/orders/total")
      .send({ unitPrice: 10, quantity: "2" })
      .expect(500);

    expect(response.body).toEqual({
      error: "order total calculation failed",
      requestId: "trace-0001",
    });
    expect(runtime.state.logs("trace-0001")[1]).toMatchObject({
      message: "ORDER_TOTAL_INVALID_TYPE",
      details: { computedType: "string", computedValue: "102" },
    });
  });

  it("case-004 logs a loud secondary error after the true lookup failure", async () => {
    await reset("scenario-004");
    const response = await request(runtime.app)
      .get("/api/accounts/ext-42")
      .expect(500);

    expect(response.body).toEqual({
      error: "account resolution failed",
      requestId: "trace-0001",
    });
    expect(runtime.state.logs("trace-0001").map((log) => [log.level, log.message])).toEqual([
      ["info", "REQUEST_RECEIVED"],
      ["warn", "ACCOUNT_LOOKUP_RETURNED_NO_RESULT"],
      ["error", "AUDIT_PIPELINE_FATAL_DELIVERY_FAILURE"],
    ]);
  });

  it("case-005 rejects the current session key after selecting a different key", async () => {
    await reset("scenario-005");
    const response = await request(runtime.app)
      .get("/api/sessions/validate/key-current")
      .expect(401);

    expect(response.body).toEqual({ error: "session validation failed", requestId: "trace-0001" });
    expect(runtime.state.logs("trace-0001")[1]).toMatchObject({
      message: "SESSION_SIGNATURE_REJECTED",
      details: { requestedKeyId: "key-current", selectedKeyId: "key-retired" },
    });
  });

  it("case-006 selects an unusable payment retry endpoint deterministically", async () => {
    await reset("scenario-006");
    const response = await request(runtime.app).get("/api/payments/retry-health").expect(503);
    expect(response.body).toEqual({ error: "payment retry service unavailable", requestId: "trace-0001" });
    expect(runtime.state.logs("trace-0001")[1]).toMatchObject({
      message: "PAYMENT_RETRY_ENDPOINT_UNUSABLE",
      details: { selectedSource: "legacy", selectedLength: 0 },
    });
  });

  it("case-007 exposes the serialized coupon flag boundary before a secondary error", async () => {
    await reset("scenario-007");
    const response = await request(runtime.app)
      .post("/api/orders/invoice")
      .send({ subtotal: 100, couponEnabled: "false" })
      .expect(500);
    expect(response.body).toEqual({ error: "invoice calculation failed", requestId: "trace-0001" });
    expect(runtime.state.logs("trace-0001").map((log) => [log.level, log.message])).toEqual([
      ["info", "REQUEST_RECEIVED"],
      ["warn", "COUPON_APPLICATION_REJECTED"],
      ["error", "BILLING_METRICS_EXPORT_FAILED"],
    ]);
  });

  it("case-008 assigns colliding optimistic versions reproducibly", async () => {
    await reset("scenario-008");
    const response = await request(runtime.app)
      .post("/api/users/profile")
      .send({ displayName: "Ada Lovelace", locale: "en-PH" })
      .expect(409);
    expect(response.body).toEqual({ error: "profile update conflict", requestId: "trace-0001" });
    expect(runtime.state.logs("trace-0001")[1]).toMatchObject({
      message: "PROFILE_UPDATE_VERSION_COLLISION",
      details: { currentVersion: 7, attemptedVersions: [8, 8], updateCount: 2 },
    });
  });

  it("reset restores seed data, clears logs, and restarts request IDs", async () => {
    await reset("scenario-004");
    await request(runtime.app).get("/api/accounts/ext-42").expect(500);
    const firstRunLogs = runtime.state.logs();

    await reset("scenario-004");
    expect(runtime.state.logs()).toEqual([]);
    expect(runtime.state.data().accounts).toEqual([
      { id: "account-7", externalId: "ext-42", displayName: "Example Account" },
    ]);
    await request(runtime.app).get("/api/accounts/ext-42").expect(500);

    expect(runtime.state.logs()).toEqual(firstRunLogs);
  });

  it("rejects unknown reset scenarios", async () => {
    await request(runtime.app)
      .post("/__control/reset/not-a-scenario")
      .expect(404, { error: "unknown scenario" });
  });
});
