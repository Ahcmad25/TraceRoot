import type { CaseArtifacts, LoadedArtifact } from "../artifacts/types.js";

export interface EvidenceReferenceValidation {
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
}

function validateArtifactReference(reference: string, prefix: "source:" | "log:", artifacts: readonly LoadedArtifact[]): boolean {
  if (!reference.startsWith(prefix)) return false;
  const body = reference.slice(prefix.length);
  const markerIndex = body.lastIndexOf(":L");
  if (markerIndex < 1) return false;
  const path = body.slice(0, markerIndex);
  const range = body.slice(markerIndex + 2);
  const match = /^(\d+)(?:-L(\d+))?$/u.exec(range);
  if (match === null) return false;
  const startLine = Number.parseInt(match[1] ?? "0", 10);
  const endLine = Number.parseInt(match[2] ?? match[1] ?? "0", 10);
  const artifact = artifacts.find((item) => item.path === path);
  return artifact !== undefined
    && startLine >= 1
    && endLine >= startLine
    && endLine <= artifact.lines;
}

export function validateEvidenceReferences(
  references: readonly string[],
  artifacts: CaseArtifacts,
): EvidenceReferenceValidation {
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const reference of references) {
    const valid = reference === `report:${artifacts.caseId}`
      || validateArtifactReference(reference, "source:", artifacts.sources)
      || validateArtifactReference(reference, "log:", artifacts.logs);
    (valid ? supported : unsupported).push(reference);
  }
  return Object.freeze({ supported: Object.freeze(supported), unsupported: Object.freeze(unsupported) });
}
