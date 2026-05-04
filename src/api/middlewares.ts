import {
  defineMiddlewares,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { PaytrailCallbackQuery } from "./hooks/paytrail/validators"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/paytrail",
      method: "GET",
      middlewares: [validateAndTransformQuery(PaytrailCallbackQuery, {})],
    },
  ],
})
