import type { z } from "zod";
import type { StructuredOutputValidationDiagnostic, StructuredOutputValidationIssue } from "./types.js";

const SENSITIVE_KEY = /(authorization|cookie|api.?key|token|secret|password|credential)/iu;

function secretValues(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(([name, value]) => value !== undefined && value.length >= 4 && SENSITIVE_KEY.test(name))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

function redactString(value: string, secrets: readonly string[]): string {
  const redacted = secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_*.-]{6,}\b/gu, "[REDACTED]");
  return redacted.length <= 1_000 ? redacted : `${redacted.slice(0, 1_000)}…[truncated]`;
}

function sanitize(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth >= 8) return "[max-depth]";
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, secrets, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(child, secrets, depth + 1),
    ]));
  }
  return value;
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") current = current[segment];
    else if (current !== null && typeof current === "object") current = (current as Record<string, unknown>)[String(segment)];
    else return undefined;
  }
  return current;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function valueSummary(value: unknown, secrets: readonly string[]): string {
  if (typeof value === "string") return JSON.stringify(redactString(value, secrets).slice(0, 200));
  if (value === null || typeof value === "number" || typeof value === "boolean" || value === undefined) return String(value);
  if (Array.isArray(value)) return `array(length=${value.length})`;
  return `object(keys=${Object.keys(value as Record<string, unknown>).sort().slice(0, 20).join(",")})`;
}

function expected(issue: z.ZodIssue): string {
  switch (issue.code) {
    case "invalid_type": return issue.expected;
    case "invalid_literal": return `literal ${JSON.stringify(issue.expected)}`;
    case "invalid_enum_value": return `one of ${issue.options.map(String).join(", ")}`;
    case "invalid_union_discriminator": return `discriminator one of ${issue.options.map(String).join(", ")}`;
    case "unrecognized_keys": return `no additional keys (${issue.keys.join(", ")})`;
    case "too_small": return `${issue.type} ${issue.inclusive ? ">=" : ">"} ${issue.minimum}`;
    case "too_big": return `${issue.type} ${issue.inclusive ? "<=" : "<"} ${issue.maximum}`;
    case "invalid_string": return `string satisfying ${String(issue.validation)} constraint`;
    case "invalid_union": return "one valid union branch";
    default: return "schema constraint";
  }
}

function flattenIssues(issues: readonly z.ZodIssue[]): z.ZodIssue[] {
  return issues.flatMap((issue) => issue.code === "invalid_union"
    ? issue.unionErrors.flatMap((error) => flattenIssues(error.issues))
    : [issue]);
}

export function buildStructuredOutputValidationDiagnostic(
  parsedOutput: unknown,
  issues: readonly z.ZodIssue[],
  environment: NodeJS.ProcessEnv = process.env,
): StructuredOutputValidationDiagnostic {
  const secrets = secretValues(environment);
  const root = parsedOutput !== null && typeof parsedOutput === "object" && !Array.isArray(parsedOutput)
    ? parsedOutput as Record<string, unknown> : undefined;
  const validationIssues: StructuredOutputValidationIssue[] = flattenIssues(issues).slice(0, 50).map((issue) => {
    const received = valueAtPath(parsedOutput, issue.path);
    return {
      path: [...issue.path],
      expected: expected(issue),
      receivedType: valueType(received),
      receivedValueSummary: valueSummary(received, secrets),
      message: redactString(issue.message, secrets),
    };
  });
  return Object.freeze({
    parsedJson: sanitize(parsedOutput, secrets),
    actionDiscriminator: root === undefined || !("action" in root) ? null : sanitize(root.action, secrets),
    topLevelKeys: Object.freeze(root === undefined ? [] : Object.keys(root).sort()),
    validationIssues: Object.freeze(validationIssues),
  });
}
