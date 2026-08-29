import type { Request, Response } from "express";
import type { TargetState } from "../state.js";

export function registerUser(request: Request, response: Response, state: TargetState): void {
  const requestId = response.locals.requestId as string;

  try {
    const normalizedName = (request.body as { profile: { name: string } }).profile.name.trim();
    response.status(201).json({ id: "user-100", name: normalizedName });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown registration error";
    state.log(requestId, "error", "USER_REGISTRATION_UNHANDLED", { message });
    response.status(500).json({ error: "user registration failed", requestId });
  }
}

export function assignProfileUpdateVersions(currentVersion: number, updateCount: number): number[] {
  return Array.from({ length: updateCount }, () => currentVersion + 1);
}

export function updateUserProfile(request: Request, response: Response, state: TargetState): void {
  const requestId = response.locals.requestId as string;
  const body = request.body as { displayName?: unknown; locale?: unknown };
  const updateCount = [body.displayName, body.locale].filter((value) => value !== undefined).length;
  const versions = assignProfileUpdateVersions(state.data().profileVersion, updateCount);

  if (new Set(versions).size !== versions.length) {
    state.log(requestId, "error", "PROFILE_UPDATE_VERSION_COLLISION", {
      currentVersion: state.data().profileVersion,
      attemptedVersions: versions,
      updateCount,
    });
    response.status(409).json({ error: "profile update conflict", requestId });
    return;
  }

  response.status(200).json({ applied: updateCount, version: versions.at(-1) ?? state.data().profileVersion });
}
