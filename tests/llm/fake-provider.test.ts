import { z } from "zod";
import { describe, expect, it } from "vitest";
import { generateStructured } from "../../src/llm/client.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { LlmProviderError } from "../../src/llm/types.js";

const schema = z.object({ answer: z.string(), confidence: z.number() });
const configuration = { modelId: "fake-model-v1", temperature: 0, timeoutMs: 1_000 };
const messages = [{ role: "user" as const, content: "Return structured test data" }];

describe("fake LLM provider and structured-output boundary", () => {
  it("validates structured JSON and preserves usage metadata", async () => {
    const provider = new FakeLlmProvider([{
      output: JSON.stringify({ answer: "fixture", confidence: 1 }),
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      providerRequestId: "fake-request-1",
    }]);
    const result = await generateStructured(provider, {
      configuration,
      messages,
      responseSchemaName: "test_response",
      responseSchema: schema,
      responseJsonSchema: { type: "object" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { answer: "fixture", confidence: 1 },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      providerId: "fake",
      modelId: "fake-model-v1",
    });
    expect(provider.callCount).toBe(1);
  });

  it("maps invalid output and provider failures into typed errors", async () => {
    const invalid = new FakeLlmProvider([{ output: { answer: 42 } }]);
    await expect(generateStructured(invalid, {
      configuration,
      messages,
      responseSchemaName: "test_response",
      responseSchema: schema,
      responseJsonSchema: { type: "object" },
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INVALID_STRUCTURED_OUTPUT",
        retryable: false,
        validationDiagnostic: {
          parsedJson: { answer: 42 },
          actionDiscriminator: null,
          topLevelKeys: ["answer"],
          validationIssues: expect.arrayContaining([
            expect.objectContaining({ path: ["answer"], expected: "string", receivedType: "number" }),
          ]),
        },
      },
    });

    const failed = new FakeLlmProvider([
      new LlmProviderError("rate_limit", "Provider rate limit", true),
    ]);
    await expect(generateStructured(failed, {
      configuration,
      messages,
      responseSchemaName: "test_response",
      responseSchema: schema,
      responseJsonSchema: { type: "object" },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ERROR", providerCode: "rate_limit", retryable: true },
    });
  });

  it("distinguishes invalid JSON from valid JSON that violates the schema", async () => {
    const provider = new FakeLlmProvider([{ output: "{not-json" }]);
    await expect(generateStructured(provider, {
      configuration,
      messages,
      responseSchemaName: "test_response",
      responseSchema: schema,
      responseJsonSchema: { type: "object" },
    })).resolves.toMatchObject({ ok: false, error: { code: "INVALID_JSON", retryable: false } });
  });

  it("redacts secrets from parsed-output validation diagnostics", async () => {
    const previous = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = "diagnostic-secret-value";
    try {
      const provider = new FakeLlmProvider([{ output: { answer: 42, authorization: "Bearer diagnostic-secret-value" } }]);
      const result = await generateStructured(provider, {
        configuration,
        messages,
        responseSchemaName: "test_response",
        responseSchema: schema.strict(),
        responseJsonSchema: { type: "object" },
      });
      if (result.ok) throw new Error("Expected validation failure");
      const diagnostic = JSON.stringify(result.error.validationDiagnostic);
      expect(diagnostic).not.toContain("diagnostic-secret-value");
      expect(diagnostic).toContain("[REDACTED]");
    } finally {
      if (previous === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = previous;
    }
  });
});
