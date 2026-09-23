import {
  AbstractPaymentProvider,
  MedusaError,
  BigNumber,
  MathBN,
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils"
import { container as medusaContainer } from "@medusajs/framework"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
  BigNumberInput,
} from "@medusajs/framework/types"
import {
  PaytrailClient,
  CreatePaymentRequest as PaytrailCreatePaymentRequest,
  CreateRefundRequest as PaytrailCreateRefundRequest,
  Item as PaytrailItem,
  Customer as PaytrailCustomer,
  Address as PaytrailAddress,
} from "@paytrail/paytrail-js-sdk"
import { plainToInstance } from "class-transformer"
import { randomUUID } from "crypto"
import type { PaytrailOptions } from "./types"

type PaytrailPaymentStatus =
  | "new"
  | "ok"
  | "fail"
  | "pending"
  | "delayed"
  | "authorization-hold"

class PaytrailProviderService extends AbstractPaymentProvider<PaytrailOptions> {
  static readonly identifier = "paytrail"

  protected client: PaytrailClient
  protected logger: any

  constructor(container: Record<string, unknown>, config: PaytrailOptions) {
    super(container, config)
    this.logger = container.logger as any

    this.client = new PaytrailClient({
      merchantId: config.merchantId,
      secretKey: config.secretKey,
      platformName: config.platformName,
    })
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.merchantId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail merchantId is required"
      )
    }
    if (!options.secretKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail secretKey is required"
      )
    }

    if (
      !Array.isArray(options.redirectUrlHostWhitelist) ||
      options.redirectUrlHostWhitelist.length === 0
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail redirectUrlHostWhitelist is required"
      )
    }
  }

  private mapPaytrailStatus(status: PaytrailPaymentStatus): PaymentSessionStatus {
    switch (status) {
      case "ok":
        return "captured"
      case "fail":
        return "error"
      case "pending":
      case "delayed":
      case "new":
      case "authorization-hold":
        return "pending"
      default:
        return "pending"
    }
  }

  // EUR uses 2 decimal places, so multiply by 100 to get cents.
  // Using BigNumber arithmetic to avoid floating point precision issues.
  private eurosToCents(amount: BigNumberInput): number {
    const cents = new BigNumber(MathBN.mult(amount, 100))
    return parseInt(cents.numeric.toString().split(".").shift()!, 10)
  }

  private getCallbackUrls() {
    const baseUrl = this.config.callbackBaseUrl
    if (!baseUrl) {
      return undefined
    }
    return {
      success: `${baseUrl}/hooks/paytrail`,
      cancel: `${baseUrl}/hooks/paytrail`,
    }
  }

  private getCallbackDelay() {
    if (this.config.callbackDelay === undefined) {
      return undefined
    }

    if (
      typeof this.config.callbackDelay !== "number" ||
      !Number.isFinite(this.config.callbackDelay) ||
      this.config.callbackDelay < 0 ||
      this.config.callbackDelay > 900
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail callbackDelay must be a number between 0 and 900 seconds"
      )
    }

    return this.config.callbackDelay
  }

  private getRedirectUrls(data?: unknown) {
    const inputData = (data ?? {}) as {
      redirect_success?: unknown
      redirect_cancel?: unknown
    }

    const successFromInput =
      typeof inputData.redirect_success === "string"
        ? inputData.redirect_success
        : undefined
    const cancelFromInput =
      typeof inputData.redirect_cancel === "string"
        ? inputData.redirect_cancel
        : undefined

    if (!successFromInput || !cancelFromInput) {
      return undefined
    }

    const whitelist =
      (this.config.redirectUrlHostWhitelist ?? [])
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    

    if (!whitelist.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail redirectUrlHostWhitelist is not configured"
      )
    }

    const validate = (
      rawUrl: string,
      field: "redirect_success" | "redirect_cancel"
    ) => {
      let parsed: URL

      try {
        parsed = new URL(rawUrl)
      } catch {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Paytrail: input.data.${field} must be a valid absolute URL`
        )
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Paytrail: input.data.${field} must use http or https`
        )
      }

      const host = parsed.host.toLowerCase()
      const isAllowed = whitelist.some((pattern) => {
        if (!pattern.includes("*")) {
          return pattern === host
        }

        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`)
        return regex.test(host)
      })

      if (!isAllowed) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Paytrail: input.data.${field} host '${host}' is not whitelisted`
        )
      }

      return rawUrl
    }

    return {
      success: validate(successFromInput, "redirect_success"),
      cancel: validate(cancelFromInput, "redirect_cancel"),
    }
  }

  // Maps a Medusa cart address to Paytrail's Address shape. All four fields are required by
  // Paytrail, so an incomplete address (e.g. no postal code yet) is omitted rather than sent partial.
  private toPaytrailAddress(address: any): PaytrailAddress | undefined {
    if (!address?.address_1 || !address?.postal_code || !address?.city || !address?.country_code) {
      return undefined
    }

    return {
      streetAddress: address.address_2
        ? `${address.address_1} ${address.address_2}`
        : address.address_1,
      postalCode: address.postal_code,
      city: address.city,
      country: String(address.country_code).toUpperCase(),
      ...(address.province ? { county: address.province } : {}),
    }
  }

  // Fetches cart data server-side, keyed off the trusted payment_session id (context.idempotency_key
  // — set by Medusa core, never client-controllable), and maps it to Paytrail's optional items[],
  // customer name/phone/company, deliveryAddress and invoicingAddress fields. Items are omitted if
  // they don't sum to the payment amount, since Paytrail requires that; customer/address fields have
  // no such constraint and are included independently whenever the cart data is available.
  //
  // Resolves Query from the app-wide `container` singleton (@medusajs/framework root export),
  // not `this.container`: the payment module only injects a hand-picked subset of dependencies
  // into its providers (logger, db manager, config, ...), never Query. The singleton is the
  // same root container Query gets registered on during app boot, so it works regardless of
  // the provider's own limited scope.
  private async getCartData(
    paymentSessionId: string,
    expectedAmountCents: number
  ): Promise<{
    items?: PaytrailItem[]
    customer?: Partial<PaytrailCustomer>
    deliveryAddress?: PaytrailAddress
    invoicingAddress?: PaytrailAddress
  }> {
    const query = medusaContainer.resolve<
      { graph: (config: Record<string, unknown>) => Promise<{ data: any[] }> } | undefined
    >(ContainerRegistrationKeys.QUERY, { allowUnregistered: true })
    if (!query) {
      return {}
    }

    try {
      const {
        data: [paymentSession],
      } = await query.graph({
        entity: "payment_session",
        fields: ["payment_collection.cart.id"],
        filters: { id: paymentSessionId },
      })

      const cartId = paymentSession?.payment_collection?.cart?.id
      if (!cartId) {
        return {}
      }

      // Cart totals are calculated on the fly, not stored columns. Per Medusa's docs, that
      // calculation only runs when the cart's own "total" field is requested — item and
      // shipping method totals come along as a side effect of that, not by requesting
      // items.total/shipping_methods.total on their own.
      const {
        data: [cart],
      } = await query.graph({
        entity: "cart",
        fields: [
          "total",
          "email",
          "items.id",
          "items.title",
          "items.quantity",
          "items.total",
          "items.subtotal",
          "items.tax_total",
          "items.product_id",
          "items.variant_sku",
          "shipping_methods.id",
          "shipping_methods.name",
          "shipping_methods.total",
          "shipping_methods.subtotal",
          "shipping_methods.tax_total",
          "billing_address.first_name",
          "billing_address.last_name",
          "billing_address.phone",
          "billing_address.company",
          "billing_address.address_1",
          "billing_address.address_2",
          "billing_address.city",
          "billing_address.province",
          "billing_address.postal_code",
          "billing_address.country_code",
          "shipping_address.address_1",
          "shipping_address.address_2",
          "shipping_address.city",
          "shipping_address.province",
          "shipping_address.postal_code",
          "shipping_address.country_code",
        ],
        filters: { id: cartId },
      })

      const contactAddress = cart?.billing_address ?? cart?.shipping_address
      const customer: Partial<PaytrailCustomer> | undefined =
        cart?.email || contactAddress
          ? {
              ...(cart?.email ? { email: cart.email } : {}),
              ...(contactAddress?.first_name ? { firstName: contactAddress.first_name } : {}),
              ...(contactAddress?.last_name ? { lastName: contactAddress.last_name } : {}),
              ...(contactAddress?.phone ? { phone: contactAddress.phone } : {}),
              ...(contactAddress?.company ? { companyName: contactAddress.company } : {}),
            }
          : undefined

      let items: PaytrailItem[] | undefined
      if (cart?.items?.length) {
        const vatPercentage = (subtotal: BigNumberInput, taxTotal: BigNumberInput) =>
          MathBN.gt(subtotal, 0)
            ? MathBN.mult(MathBN.div(taxTotal, subtotal), 100).toNumber()
            : 0

        const mapped: PaytrailItem[] = [
          ...cart.items.map((item: any) => ({
            unitPrice: this.eurosToCents(MathBN.div(item.total, item.quantity)),
            units: Number(item.quantity),
            vatPercentage: vatPercentage(item.subtotal, item.tax_total),
            productCode: String(item.variant_sku || item.product_id || item.id).slice(0, 100),
            description: item.title,
          })),
          ...(cart.shipping_methods ?? []).map((method: any) => ({
            unitPrice: this.eurosToCents(method.total),
            units: 1,
            vatPercentage: vatPercentage(method.subtotal, method.tax_total),
            productCode: String(method.id).slice(0, 100),
            description: method.name,
          })),
        ]

        const sum = mapped.reduce((total, item) => total + item.unitPrice * item.units, 0)
        if (sum === expectedAmountCents) {
          items = mapped
        } else {
          this.logger.error(
            "Paytrail: cart items do not sum to payment amount, omitting items",
            { paymentSessionId, sum, expectedAmountCents, cartItems: cart.items, mappedItems: mapped }
          )
        }
      }

      return {
        customer,
        deliveryAddress: this.toPaytrailAddress(cart?.shipping_address),
        invoicingAddress: this.toPaytrailAddress(cart?.billing_address),
        ...(items ? { items } : {}),
      }
    } catch (error: any) {
      this.logger.error("Paytrail: failed to fetch cart data for payment request", {
        paymentSessionId,
        error: error?.message,
      })
      return {}
    }
  }

  // Triggered by: POST /store/payment-collections/:id/payment-sessions
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input

    if (currency_code !== "eur") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Paytrail only supports EUR currency"
      )
    }

    try {
      const stamp = context?.idempotency_key + randomUUID()
      const amountCents = this.eurosToCents(amount)

      const cartData = context?.idempotency_key
        ? await this.getCartData(context.idempotency_key, amountCents)
        : {}

      // Both sources are server-side: context.customer.email (authenticated checkout) and
      // cartData.customer.email, i.e. cart.email (guest checkout). Client-supplied input.data.email
      // is never trusted.
      const email = context?.customer?.email ?? cartData.customer?.email

      if (!email) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Paytrail: a customer email is required to initiate payment"
        )
      }

      const redirectUrls = this.getRedirectUrls(input.data)
      if (!redirectUrls) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Paytrail: input.data.redirect_success and input.data.redirect_cancel are required"
        )
      }

      const callbackUrls = this.getCallbackUrls()
      const callbackDelay = this.getCallbackDelay()

      const createPaymentRequest = plainToInstance(PaytrailCreatePaymentRequest, {
        stamp,
        reference: input.data?.session_id as string | undefined,
        amount: amountCents,
        currency: currency_code.toUpperCase(),
        language: this.config.language,
        customer: {
          ...cartData.customer,
          email,
        },
        redirectUrls,
        ...(callbackUrls ? { callbackUrls } : {}),
        ...(callbackDelay !== undefined ? { callbackDelay } : {}),
        ...(cartData.items ? { items: cartData.items } : {}),
        ...(cartData.deliveryAddress ? { deliveryAddress: cartData.deliveryAddress } : {}),
        ...(cartData.invoicingAddress ? { invoicingAddress: cartData.invoicingAddress } : {}),
      })

      const response = await this.client.createPayment(createPaymentRequest)

      if (response.status !== 200) {
        this.logger.error("Paytrail create payment failed", {
          status: response.status,
          message: response.message,
        })
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Paytrail create payment failed`
        )
      }

      const transactionId = response.data?.transactionId
      const href = response.data?.href

      return {
        id: transactionId!,
        status: "pending",
        data: {
          transactionId,
          href,
          stamp,
          providers: response.data?.providers,
          groups: response.data?.groups,
          reference: response.data?.reference,
          terms: response.data?.terms,
        },
      }
    } catch (error: any) {
      if (error instanceof MedusaError) {
        throw error
      }

      this.logger.error("Failed to initiate Paytrail payment", {
        error: error?.message,
      })

      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to initiate Paytrail payment`
      )
    }
  }

  // Triggered by: POST /store/carts/:id/complete
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return this.getPaymentStatus(input)
  }

  // Triggered by: POST /admin/payments/:id/capture
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    // Standard Paytrail payments are auto-captured at authorization.
    // No separate capture API call needed.
    return { data: input.data ?? {} }
  }

  // Triggered by: POST /admin/payments/:id/refund or /admin/orders/:id/cancel
  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const transactionId = input.data?.transactionId as string

    //TODO: real URLs, see: https://docs.paytrail.com/#/?id=refund-payment
    // How we inform admin if refund is delayed?
    const callbackUrls = this.getCallbackUrls() ?? {
      success: "https://localhost:8000/refund/success",
      cancel: "https://localhost:8000/refund/cancel",
    }

    const refundRequest = plainToInstance(PaytrailCreateRefundRequest, {
      amount: this.eurosToCents(input.amount),
      refundReference: input.context?.idempotency_key,
      refundStamp: randomUUID(),
      callbackUrls,
    })

    const response = await this.client.createRefund(
      { transactionId },
      refundRequest
    )

    if (response.status !== 200) {
      this.logger.error("Paytrail create refund failed", {
        status: response.status,
        message: response.message,
      })
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Paytrail create refund failed`
      )
    }

    return {
      data: {
        ...input.data,
        refundTransactionId: response.data?.transactionId,
        refundProvider: response.data?.provider,
        refundStatus: response.data?.status,
      },
    }
  }

  // Triggered by: POST /store/payment-collections/:id/payment-sessions (when session already exists)
  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  // Triggered by: internal — called by authorizePayment
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const transactionId = input.data?.transactionId as string | undefined

    if (!transactionId) {
      return {
        status: "error",
        data: input.data ?? {},
      }
    }

    const response = await this.client.getPaymentStatus({ transactionId })
    const paytrailStatus = (response.data?.status ?? "new") as PaytrailPaymentStatus

    return {
      status: this.mapPaytrailStatus(paytrailStatus),
      data: {
        ...input.data,
        paytrailStatus: response.data?.status,
        provider: response.data?.provider,
        paidAt: response.data?.paidAt,
      },
    }
  }

  // Triggered by: GET /hooks/paytrail (from Paytrail) or POST /hooks/payment/paytrail_paytrail (OOB)
  async getWebhookActionAndData(
    data: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const params = data.data as Record<string, string>

    // Extract checkout-* parameters for HMAC verification
    const hparams: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith("checkout-")) {
        hparams[key] = String(value)
      }
    }

    const signature = params.signature as string
    if (!signature) {
      return { action: "not_supported" }
    }

    // Verify HMAC signature
    const isValid = this.client.validateHmac(
      hparams,
      "",
      signature,
      this.config.secretKey
    )

    if (!isValid) {
      return { action: "not_supported" }
    }

    const status = params["checkout-status"]
    const sessionId = params["checkout-reference"]
    const amount = Number(params["checkout-amount"] ?? 0) / 100

    switch (status) {
      case "ok":
        return {
          action: "authorized",
          data: {
            session_id: sessionId,
            amount: new BigNumber(amount),
          },
        }
      default:
        return { action: "not_supported" }
    }
  }

  // methods below are not used in this provider, but need to be implemented to satisfy the interface
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Method not implemented.")
  }
  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Method not implemented.")
  }
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Method not implemented.")
  }
}

export default PaytrailProviderService
