import { z } from "zod"

/**
 * Validates Paytrail redirect/callback query parameters.
 * @see https://docs.paytrail.com/#/?id=redirect-and-callback-url-parameters
 */
const toNumber = (val: unknown) =>
  typeof val === "string" ? Number(val) : val

export const PaytrailCallbackQuery = z.object({
  "checkout-account": z.preprocess(toNumber, z.number().int().positive()),
  "checkout-algorithm": z.string().min(1),
  "checkout-amount": z.preprocess(
    toNumber,
    z.number().int().min(0).max(99999999)
  ),
  "checkout-settlement-reference": z.string().optional(),
  "checkout-stamp": z.string().max(200).min(1),
  "checkout-reference": z.string().max(200).min(1),
  "checkout-transaction-id": z.string().min(1).optional(),
  "checkout-status": z.enum(["ok", "fail", "pending", "delayed"]),
  "checkout-provider": z.string().min(1),
  signature: z.string().min(1),
})

export type PaytrailCallbackQuery = z.infer<typeof PaytrailCallbackQuery>
