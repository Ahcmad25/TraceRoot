import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { failureCaseSchema } from "../domain/case.js";
import { PathSandbox, SandboxError } from "../security/path-sandbox.js";
import type { ArtifactLoadResult, CaseArtifacts, LoadedArtifact } from "./types.js";

const CASE_ID_PATTERN = /^case-\d{3}$/u;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function countLines(content: string): number {
  return content === "" ? 0 : content.split(/\r?\n/u).length;
}

function artifact(workspaceRoot: string, absolutePath: string, content: string): LoadedArtifact {
  return Object.freeze({
    path: relative(workspaceRoot, absolutePath).replaceAll("\\", "/"),
    content,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content, "utf8"),
    lines: countLines(content),
  });
}

function mapSandboxError(error: SandboxError) {
  if (error.code === "READ_LIMIT_EXCEEDED") {
    return { code: "ARTIFACT_TOO_LARGE" as const, message: error.message };
  }
  if (["PATH_TRAVERSAL", "PATH_OUTSIDE_SANDBOX", "PATH_DENIED", "PATH_NOT_PERMITTED"].includes(error.code)) {
    return { code: "ARTIFACT_ACCESS_DENIED" as const, message: error.message };
  }
  return { code: "ARTIFACT_LOAD_FAILED" as const, message: error.message };
}

export class ArtifactLoader {
  public constructor(private readonly workspaceRoot: string) {}

  public async load(caseId: string): Promise<ArtifactLoadResult> {
    if (!CASE_ID_PATTERN.test(caseId)) {
      return { ok: false, error: { code: "INVALID_CASE_ID", message: "Case id must match case-NNN" } };
    }

    try {
      const publicCasesRoot = resolve(this.workspaceRoot, "cases", "public");
      const caseRoot = resolve(publicCasesRoot, caseId);
      const manifestPath = resolve(caseRoot, "case.json");
      const manifestSandbox = await PathSandbox.create({
        roots: [publicCasesRoot],
        deniedRoots: [
          resolve(this.workspaceRoot, "cases", "ground-truth"),
          resolve(this.workspaceRoot, "cases", "internal"),
          resolve(this.workspaceRoot, "results"),
        ],
        allowedFiles: [manifestPath],
        maxBytes: 64 * 1024,
        maxLines: 1_000,
      });
      let manifestRead;
      try {
        manifestRead = await manifestSandbox.readText(manifestPath);
      } catch (error: unknown) {
        if (error instanceof SandboxError && error.code === "FILE_NOT_FOUND") {
          return { ok: false, error: { code: "CASE_NOT_FOUND", message: `Unknown case: ${caseId}` } };
        }
        throw error;
      }

      let manifest: unknown;
      try {
        manifest = JSON.parse(manifestRead.content);
      } catch {
        return { ok: false, error: { code: "INVALID_MANIFEST", message: "Case manifest is not valid JSON" } };
      }
      const parsed = failureCaseSchema.safeParse(manifest);
      if (!parsed.success || parsed.data.id !== caseId) {
        return { ok: false, error: { code: "INVALID_MANIFEST", message: "Case manifest failed schema or id validation" } };
      }

      const sourcePaths = parsed.data.permittedSourceFiles.map((path) => resolve(this.workspaceRoot, path));
      const logPaths = parsed.data.initialLogFiles.map((path) => resolve(this.workspaceRoot, path));
      const sourceSandbox = await PathSandbox.create({
        roots: [resolve(this.workspaceRoot, "src", "target-api")],
        deniedRoots: [
          resolve(this.workspaceRoot, "cases", "ground-truth"),
          resolve(this.workspaceRoot, "cases", "internal"),
          resolve(this.workspaceRoot, "results"),
        ],
        allowedFiles: sourcePaths,
        maxBytes: 256 * 1024,
        maxLines: 5_000,
      });
      const logSandbox = await PathSandbox.create({
        roots: [caseRoot],
        deniedRoots: [
          resolve(this.workspaceRoot, "cases", "ground-truth"),
          resolve(this.workspaceRoot, "cases", "internal"),
          resolve(this.workspaceRoot, "results"),
        ],
        allowedFiles: logPaths,
        maxBytes: 256 * 1024,
        maxLines: 5_000,
      });

      const sources = await Promise.all(sourcePaths.map(async (path) => {
        const read = await sourceSandbox.readText(path);
        return artifact(this.workspaceRoot, read.absolutePath, read.content);
      }));
      const logs = await Promise.all(logPaths.map(async (path) => {
        const read = await logSandbox.readText(path);
        return artifact(this.workspaceRoot, read.absolutePath, read.content);
      }));
      sources.sort((left, right) => left.path.localeCompare(right.path));
      logs.sort((left, right) => left.path.localeCompare(right.path));
      const manifestArtifact = artifact(this.workspaceRoot, manifestRead.absolutePath, manifestRead.content);
      const hashIndex = [
        { path: manifestArtifact.path, sha256: manifestArtifact.sha256 },
        ...sources.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
        ...logs.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
      ];
      const artifacts: CaseArtifacts = Object.freeze({
        caseId,
        manifest: Object.freeze(structuredClone(parsed.data)),
        manifestArtifact,
        sources: Object.freeze(sources),
        logs: Object.freeze(logs),
        hashes: Object.freeze({
          manifest: manifestArtifact.sha256,
          sources: Object.freeze(Object.fromEntries(sources.map((item) => [item.path, item.sha256]))),
          logs: Object.freeze(Object.fromEntries(logs.map((item) => [item.path, item.sha256]))),
          aggregate: sha256(JSON.stringify(hashIndex)),
        }),
      });
      return { ok: true, artifacts };
    } catch (error: unknown) {
      if (error instanceof SandboxError) {
        return { ok: false, error: mapSandboxError(error) };
      }
      return {
        ok: false,
        error: {
          code: "ARTIFACT_LOAD_FAILED",
          message: error instanceof Error ? error.message : "Unknown artifact loading failure",
        },
      };
    }
  }
}
