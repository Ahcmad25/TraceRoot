import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SandboxErrorCode =
  | "PATH_TRAVERSAL"
  | "PATH_OUTSIDE_SANDBOX"
  | "PATH_DENIED"
  | "PATH_NOT_PERMITTED"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "READ_LIMIT_EXCEEDED";

export class SandboxError extends Error {
  public constructor(
    public readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export interface PathSandboxOptions {
  readonly roots: readonly string[];
  readonly deniedRoots?: readonly string[];
  readonly allowedFiles?: readonly string[];
  readonly maxBytes?: number;
  readonly maxLines?: number;
}

export interface BoundedTextRead {
  readonly absolutePath: string;
  readonly content: string;
  readonly bytes: number;
  readonly lines: number;
}

const canonical = (path: string): string => resolve(path).toLocaleLowerCase("en-US");

function isWithin(path: string, root: string): boolean {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function containsTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

function containsDeniedBenchmarkPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return ["ground-truth", "internal"].some((directory) =>
    normalized.includes(`/cases/${directory}/`) || normalized.endsWith(`/cases/${directory}`));
}

export class PathSandbox {
  readonly #roots: readonly string[];
  readonly #deniedRoots: readonly string[];
  readonly #allowedFiles: ReadonlySet<string> | undefined;
  readonly #maxBytes: number;
  readonly #maxLines: number;

  private constructor(input: {
    roots: readonly string[];
    deniedRoots: readonly string[];
    allowedFiles?: ReadonlySet<string>;
    maxBytes: number;
    maxLines: number;
  }) {
    this.#roots = input.roots;
    this.#deniedRoots = input.deniedRoots;
    this.#allowedFiles = input.allowedFiles;
    this.#maxBytes = input.maxBytes;
    this.#maxLines = input.maxLines;
  }

  public static async create(options: PathSandboxOptions): Promise<PathSandbox> {
    if (options.roots.length === 0) {
      throw new SandboxError("PATH_OUTSIDE_SANDBOX", "At least one sandbox root is required");
    }
    const roots = await Promise.all(options.roots.map(async (root) => canonical(await realpath(root))));
    const deniedCandidates = [
      ...(options.deniedRoots ?? []),
      ...options.roots.map((root) => resolve(root, "cases", "ground-truth")),
      ...options.roots.map((root) => resolve(root, "cases", "internal")),
    ];
    const deniedRoots = await Promise.all(deniedCandidates.map(async (root) => {
      try {
        return canonical(await realpath(root));
      } catch {
        return canonical(root);
      }
    }));
    const allowedFiles = options.allowedFiles === undefined
      ? undefined
      : new Set(await Promise.all(options.allowedFiles.map(async (file) => {
          try {
            return canonical(await realpath(file));
          } catch {
            return canonical(file);
          }
        })));

    return new PathSandbox({
      roots,
      deniedRoots,
      ...(allowedFiles === undefined ? {} : { allowedFiles }),
      maxBytes: options.maxBytes ?? 256 * 1024,
      maxLines: options.maxLines ?? 5_000,
    });
  }

  public async resolveReadable(inputPath: string): Promise<string> {
    if (containsTraversal(inputPath)) {
      throw new SandboxError("PATH_TRAVERSAL", "Parent-directory traversal is not permitted");
    }
    if (containsDeniedBenchmarkPath(resolve(inputPath))) {
      throw new SandboxError("PATH_DENIED", "Private benchmark paths are explicitly denied");
    }

    const candidate = isAbsolute(inputPath)
      ? resolve(inputPath)
      : resolve(this.#roots[0] ?? "", inputPath);
    let resolvedPath: string;
    try {
      resolvedPath = canonical(await realpath(candidate));
    } catch {
      throw new SandboxError("FILE_NOT_FOUND", `Readable file not found: ${inputPath}`);
    }

    if (containsDeniedBenchmarkPath(resolvedPath) || this.#deniedRoots.some((root) => isWithin(resolvedPath, root))) {
      throw new SandboxError("PATH_DENIED", "The resolved path is explicitly denied");
    }
    if (!this.#roots.some((root) => isWithin(resolvedPath, root))) {
      throw new SandboxError("PATH_OUTSIDE_SANDBOX", "The resolved path is outside permitted roots");
    }
    if (this.#allowedFiles !== undefined && !this.#allowedFiles.has(resolvedPath)) {
      throw new SandboxError("PATH_NOT_PERMITTED", "The file is not in the explicit allowlist");
    }
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      throw new SandboxError("NOT_A_FILE", "The resolved path is not a regular file");
    }
    return resolvedPath;
  }

  public async readText(
    inputPath: string,
    limits: { maxBytes?: number; maxLines?: number } = {},
  ): Promise<BoundedTextRead> {
    const absolutePath = await this.resolveReadable(inputPath);
    const maxBytes = Math.min(limits.maxBytes ?? this.#maxBytes, this.#maxBytes);
    const maxLines = Math.min(limits.maxLines ?? this.#maxLines, this.#maxLines);
    const buffer = await readFile(absolutePath);
    if (buffer.byteLength > maxBytes) {
      throw new SandboxError("READ_LIMIT_EXCEEDED", `File exceeds the ${maxBytes}-byte read limit`);
    }
    const content = buffer.toString("utf8");
    const lines = content === "" ? 0 : content.split(/\r?\n/u).length;
    if (lines > maxLines) {
      throw new SandboxError("READ_LIMIT_EXCEEDED", `File exceeds the ${maxLines}-line read limit`);
    }
    return { absolutePath, content, bytes: buffer.byteLength, lines };
  }
}
