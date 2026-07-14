# Paytrail Payment Provider Plugin

Paytrail payment provider plugin for Medusa.

This package is published to NPM as `@solteq-excom/medusa-payment-paytrail`.

## Install

Add the package to your Medusa backend:

```bash
yarn add @solteq-excom/medusa-payment-paytrail
```

Register the plugin and payment provider in your `medusa-config.ts`:

```ts
plugins: [
  {
    resolve: "@solteq-excom/medusa-payment-paytrail",
    options: {},
  },
],
modules: [
  {
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [
        {
          resolve: "@solteq-excom/medusa-payment-paytrail/providers/paytrail",
          id: "paytrail",
          options: {
            merchantId: Number(process.env.PAYTRAIL_MERCHANT_ID ?? "375917"),
            secretKey: process.env.PAYTRAIL_SECRET_KEY ?? "SAIPPUAKAUPPIAS",
            platformName: process.env.PAYTRAIL_PLATFORM_NAME ?? "MedusaJS",
            callbackBaseUrl: process.env.PAYTRAIL_CALLBACK_BASE_URL,
            language: process.env.PAYTRAIL_LANGUAGE ?? "EN",
          },
        },
      ],
    },
  },
]
```

## Configuration

Required and supported environment variables:

- `PAYTRAIL_MERCHANT_ID`
- `PAYTRAIL_SECRET_KEY`
- `PAYTRAIL_PLATFORM_NAME` (optional)
- `PAYTRAIL_CALLBACK_BASE_URL` (recommended, must use HTTPS)
- `PAYTRAIL_LANGUAGE` (`FI`, `SV`, or `EN`)

Example:

```env
PAYTRAIL_MERCHANT_ID=375917
PAYTRAIL_SECRET_KEY=SAIPPUAKAUPPIAS
PAYTRAIL_PLATFORM_NAME=MedusaJS
PAYTRAIL_CALLBACK_BASE_URL=https://your-backend.example.com
PAYTRAIL_LANGUAGE=EN
```

Paytrail requires HTTPS callback URLs for both success and cancel callbacks.

## Features

- Payment session initiation via Paytrail API
- Payment status check for authorization flow
- Refund support
- Callback action parsing and HMAC signature verification
- Custom GET callback route for Paytrail redirect and callback query params

## Callback Route

The plugin exposes `GET /hooks/paytrail` for Paytrail redirect and callback handling.

The route forwards callback payloads into Medusa's payment webhook pipeline by emitting `PaymentWebhookEvents.WebhookReceived` after validating the signature.

## Behavior

- Currency support is limited to `EUR` by Paytrail.
- Payment sessions are created in `pending` status until Paytrail authorizes them.
- Cart completion fails before third-party authorization.
- Standard Paytrail flow is treated as auto-captured after authorization.

## Payment Flow

1. Store creates a payment session with provider `pp_paytrail_paytrail`.
2. Paytrail returns a redirect URL and `transactionId`.
3. Customer authorizes the payment in Paytrail checkout.
4. Callback updates the payment status to authorized or captured.
5. Cart completion succeeds after authorization.

## Troubleshooting

### No payment providers available in store

- Ensure the Paytrail provider is linked to the region.

### Cart completion returns 400 not authorized

- This is expected before the Paytrail authorization callback is processed.
- Complete the payment in Paytrail before completing the cart.

### Callback is not triggered

- Verify `PAYTRAIL_CALLBACK_BASE_URL` is configured with an HTTPS URL.
- Paytrail requires HTTPS callback URLs for both success and cancel callbacks.

## Disclaimer

This package is provided as-is, without warranty of any kind. You are responsible for validating the integration, security, and compliance requirements before using it in production.

## References

- Official Paytrail API documentation: https://docs.paytrail.com/#/
