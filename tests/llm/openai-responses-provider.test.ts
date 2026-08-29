import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiResponsesProvider, type OpenAiResponseShapeDiagnostics } from "../../src/llm/openai-responses-provider.js";

const input = {
  configuration: { modelId: "configured-model", temperature: 0, timeoutMs: 1_000 },
  messages: [{ role: "user" as const, content: "test" }],
  responseSchemaName: "test_schema",
  responseJsonSchema: { type: "object" },
};

const investigatorAction = "{\"action\":\"search_source\",\"arguments\":{\"query\":\"registerUser\"},\"reason\":\"Locate the request handler.\"}";

function providerFor(body: unknown, status = 200, debugLogger?: (value: OpenAiResponseShapeDiagnostics) => void) {
  const fakeFetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;
  return new OpenAiResponsesProvider({ fetchImplementation: fakeFetch, ...(debugLogger === undefined ? {} : { debugLogger }) });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenAiResponsesProvider", () => {
  it("requires credentials from the environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(new OpenAiResponsesProvider().invoke(input)).rejects.toMatchObject({ providerCode: "missing_api_key", retryable: false });
  });

  it("extracts structured Investigator output from the sanitized smoke response shape", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    const fixture = JSON.parse(await readFile(resolve("tests/fixtures/openai-responses/structured-investigator-response.json"), "utf8")) as unknown;
    const diagnostics: OpenAiResponseShapeDiagnostics[] = [];
    const result = await providerFor(fixture, 200, (value) => diagnostics.push(value)).invoke(input);

    expect(result).toEqual({
      output: investigatorAction,
      usage: { inputTokens: 120, outputTokens: 28, totalTokens: 148 },
      providerRequestId: "resp_sanitized_smoke",
    });
    expect(diagnostics).toEqual([{
      responseId: "resp_sanitized_smoke", httpStatus: 200, responseStatus: "completed",
      topLevelKeys: ["error", "id", "incomplete_details", "object", "output", "output_text", "status", "usage"],
      outputItemTypes: ["reasoning", "message"], contentItemTypes: ["output_text"],
      hasTopLevelOutputText: true, hasContentOutputText: true, hasParsedStructuredOutput: false,
    }]);
  });

  it("finds the final assistant message when other output items and commentary precede it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    const result = await providerFor({
      id: "resp-multiple", status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "not structured final output" }] },
        { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: investigatorAction }] },
      ],
    }).invoke(input);
    expect(result.output).toBe(investigatorAction);
  });

  it("supports parsed output content and the documented top-level output_text convenience field", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    const parsed = { action: "search_logs", arguments: { query: "ERROR" }, reason: "Inspect logs." };
    await expect(providerFor({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", parsed }] }] }).invoke(input))
      .resolves.toMatchObject({ output: parsed });
    await expect(providerFor({ status: "completed", output: [{ type: "reasoning" }], output_text: investigatorAction }).invoke(input))
      .resolves.toMatchObject({ output: investigatorAction });
  });

  it("does not accept unrelated text or a response with no structured output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    await expect(providerFor({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "input_text", text: investigatorAction }] }] }).invoke(input))
      .rejects.toMatchObject({ providerCode: "missing_output", retryable: false });
  });

  it("maps nullable-code API error envelopes instead of misclassifying their shape", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    await expect(providerFor({ error: { message: "Request schema rejected", type: "invalid_request_error", code: null } }, 400).invoke(input))
      .rejects.toMatchObject({ providerCode: "invalid_request_error", message: "Request schema rejected", retryable: false });
  });

  it("sends a no-tool strict structured-output request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    let capturedBody: Record<string, unknown> | undefined;
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: "completed", output_text: investigatorAction }), { status: 200 });
    }) as unknown as typeof fetch;
    await new OpenAiResponsesProvider({ fetchImplementation: fakeFetch }).invoke(input);
    expect(capturedBody).toMatchObject({
      model: "configured-model", temperature: 0, tools: [], tool_choice: "none", store: false,
      text: { format: { type: "json_schema", name: "test_schema", strict: true } },
    });
  });

  it("omits temperature entirely for a temperature-unsupported model family", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-provider-key");
    let capturedBody: Record<string, unknown> | undefined;
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: "completed", output_text: investigatorAction }), { status: 200 });
    }) as unknown as typeof fetch;
    await new OpenAiResponsesProvider({ fetchImplementation: fakeFetch }).invoke({
      ...input,
      configuration: { modelId: "gpt-5.6-sol", temperature: 0, timeoutMs: 1_000 },
    });
    expect(capturedBody?.model).toBe("gpt-5.6-sol");
    expect(capturedBody).not.toHaveProperty("temperature");
  });
});
