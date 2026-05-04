import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PaymentModuleOptions } from "@medusajs/framework/types"
import { Modules, PaymentWebhookEvents } from "@medusajs/framework/utils"

/**
 * GET /hooks/paytrail
 *
 * Paytrail redirects/callbacks can target this endpoint after the
 * customer returns from checkout. The `checkout-*` values and signature
 * are received as query parameters.
 *
 * This handler doesn't process the payment synchronously. It forwards
 * the request data to Medusa's payment webhook pipeline by emitting
 * `PaymentWebhookEvents.WebhookReceived` through the event bus.
 *
 *  Code is taken from OOB POST route, but adapted to work with GET, since Paytrail sends data as query params.
 *  see: packages\medusa\src\api\hooks\payment\[provider]\route.ts
 *
 * Response behavior:
 * - `200` when the event is queued successfully
 * - `400` with `Webhook Error: ...` when queuing fails
 */

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const options: PaymentModuleOptions =
      // @ts-expect-error "Not sure if .options exists on a module"
      req.scope.resolve(Modules.PAYMENT).options || {}

    const event = {
      provider: "paytrail_paytrail",
      payload: { data: req.validatedQuery, rawData: "", headers: req.headers },
    }

    const eventBus = req.scope.resolve(Modules.EVENT_BUS)

    // we delay the processing of the event to avoid a conflict caused by a race condition
    await eventBus.emit(
      {
        name: PaymentWebhookEvents.WebhookReceived,
        data: event,
      },
      {
        delay: options.webhook_delay || 5000,
        attempts: options.webhook_retries || 3,
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(400).send(`Webhook Error: ${message}`)
    return
  }

  res.sendStatus(200)
}
