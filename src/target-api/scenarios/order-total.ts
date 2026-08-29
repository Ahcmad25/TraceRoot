import type { Request, Response } from "express";
import type { TargetState } from "../state.js";

export function calculateOrderTotal(
  request: Request,
  response: Response,
  state: TargetState,
): void {
  const requestId = response.locals.requestId as string;
  const body = request.body as { unitPrice?: unknown; quantity?: unknown };

  const total = (body.unitPrice as number) + (body.quantity as number);
  if (typeof total !== "number" || !Number.isFinite(total)) {
    state.log(requestId, "error", "ORDER_TOTAL_INVALID_TYPE", {
      unitPriceType: typeof body.unitPrice,
      quantityType: typeof body.quantity,
      computedType: typeof total,
      computedValue: total,
    });
    response.status(500).json({ error: "order total calculation failed", requestId });
    return;
  }

  response.status(200).json({ total });
}

export function normalizeCouponEnabled(value: unknown): boolean {
  return Boolean(value);
}

export function calculateInvoice(
  request: Request,
  response: Response,
  state: TargetState,
): void {
  const requestId = response.locals.requestId as string;
  const body = request.body as { subtotal?: unknown; couponEnabled?: unknown };
  const couponEnabled = normalizeCouponEnabled(body.couponEnabled);

  if (couponEnabled) {
    state.log(requestId, "warn", "COUPON_APPLICATION_REJECTED", {
      inputType: typeof body.couponEnabled,
      inputValue: body.couponEnabled,
      normalizedValue: couponEnabled,
    });
    state.log(requestId, "error", "BILLING_METRICS_EXPORT_FAILED", {
      message: "metrics collector unavailable",
    });
    response.status(500).json({ error: "invoice calculation failed", requestId });
    return;
  }

  response.status(200).json({ total: body.subtotal });
}
