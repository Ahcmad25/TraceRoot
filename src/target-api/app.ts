import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { getAccount } from "./scenarios/account-lookup.js";
import { calculateOrderTotal } from "./scenarios/order-total.js";
import { createPaymentClient } from "./scenarios/payment-provider.js";
import { registerUser } from "./scenarios/user-registration.js";
import { TargetState } from "./state.js";
import { scenarioIdSchema, type ScenarioId } from "./types.js";

export interface TargetApiRuntime {
  readonly app: Express;
  readonly state: TargetState;
  reset(scenarioId: ScenarioId): void;
}

export function createTargetApi(): TargetApiRuntime {
  const app = express();
  const state = new TargetState();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.post("/__control/reset/:scenarioId", (request, response) => {
    const parsed = scenarioIdSchema.safeParse(request.params.scenarioId);
    if (!parsed.success) {
      response.status(404).json({ error: "unknown scenario" });
      return;
    }
    state.reset();
    response.status(200).json({ scenarioId: parsed.data, reset: true });
  });

  app.get("/__control/logs", (request, response) => {
    const requestId = typeof request.query.requestId === "string"
      ? request.query.requestId
      : undefined;
    response.status(200).json({ logs: state.logs(requestId) });
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const suppliedCorrelationId = request.header("x-correlation-id");
    const requestId = suppliedCorrelationId !== undefined && /^[a-zA-Z0-9._-]{1,100}$/u.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : state.nextRequestId();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    state.log(requestId, "info", "REQUEST_RECEIVED", {
      method: request.method,
      path: request.path,
    });
    next();
  });

  app.post("/api/users/register", (request, response) => registerUser(request, response, state));
  app.get("/api/payments/provider", (request, response) => createPaymentClient(request, response, state));
  app.post("/api/orders/total", (request, response) => calculateOrderTotal(request, response, state));
  app.get("/api/accounts/:externalId", (request, response) => getAccount(request, response, state));

  app.use((_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  return {
    app,
    state,
    reset: (_scenarioId) => state.reset(),
  };
}
