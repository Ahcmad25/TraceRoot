import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathSandbox } from "../../src/security/path-sandbox.js";

const workspaceRoot = resolve(".");
const temporaryPaths: string[] = [];

afterEach(async () => {
  for (const path of temporaryPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("PathSandbox", () => {
  it("rejects parent traversal and absolute paths outside its roots", async () => {
    const sandbox = await PathSandbox.create({ roots: [resolve("src/target-api")] });

    await expect(sandbox.resolveReadable("../domain/case.ts")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    });
    await expect(sandbox.resolveReadable(resolve("package.json"))).rejects.toMatchObject({
      code: "PATH_OUTSIDE_SANDBOX",
    });
  });

  it("explicitly rejects ground-truth files", async () => {
    const sandbox = await PathSandbox.create({
      roots: [workspaceRoot],
      deniedRoots: [resolve("cases/ground-truth")],
    });

    await expect(sandbox.resolveReadable(resolve("cases/ground-truth/case-001.json")))
      .rejects.toMatchObject({ code: "PATH_DENIED" });
  });

  it("explicitly rejects internal runtime mappings", async () => {
    const sandbox = await PathSandbox.create({ roots: [workspaceRoot] });

    await expect(sandbox.resolveReadable(resolve("cases/internal/runtime-map.json")))
      .rejects.toMatchObject({ code: "PATH_DENIED" });
  });

  it("rejects a symlink or junction that resolves into ground truth", async () => {
    await mkdir(resolve("tests"), { recursive: true });
    const temporaryRoot = await mkdtemp(resolve("tests", "sandbox-"));
    temporaryPaths.push(temporaryRoot);
    const link = resolve(temporaryRoot, "escaped-ground-truth");
    await symlink(resolve("cases/ground-truth"), link, "junction");
    const sandbox = await PathSandbox.create({
      roots: [workspaceRoot],
      deniedRoots: [resolve("cases/ground-truth")],
    });

    await expect(sandbox.resolveReadable(resolve(link, "case-001.json")))
      .rejects.toMatchObject({ code: "PATH_DENIED" });
  });

  it("enforces configured byte and line limits", async () => {
    const sandbox = await PathSandbox.create({
      roots: [resolve("src/target-api")],
      maxBytes: 10,
      maxLines: 1,
    });

    await expect(sandbox.readText(resolve("src/target-api/app.ts")))
      .rejects.toMatchObject({ code: "READ_LIMIT_EXCEEDED" });
  });
});
