import type { FailureCase } from "../domain/case.js";

export interface LoadedArtifact {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly lines: number;
}

export interface ArtifactHashes {
  readonly manifest: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly logs: Readonly<Record<string, string>>;
  readonly aggregate: string;
}

export interface CaseArtifacts {
  readonly caseId: string;
  readonly manifest: FailureCase;
  readonly manifestArtifact: LoadedArtifact;
  readonly sources: readonly LoadedArtifact[];
  readonly logs: readonly LoadedArtifact[];
  readonly hashes: ArtifactHashes;
}

export type ArtifactLoadErrorCode =
  | "INVALID_CASE_ID"
  | "CASE_NOT_FOUND"
  | "INVALID_MANIFEST"
  | "ARTIFACT_ACCESS_DENIED"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_LOAD_FAILED";

export type ArtifactLoadResult =
  | { readonly ok: true; readonly artifacts: CaseArtifacts }
  | {
      readonly ok: false;
      readonly error: { readonly code: ArtifactLoadErrorCode; readonly message: string };
    };
