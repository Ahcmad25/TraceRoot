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
