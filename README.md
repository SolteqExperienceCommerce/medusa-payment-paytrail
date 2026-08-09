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
            merchantId: Number(process.env.PAYTRAIL_MERCHANT_ID),
            secretKey: process.env.PAYTRAIL_SECRET_KEY,
            platformName: process.env.PAYTRAIL_PLATFORM_NAME ?? "MedusaJS",
            callbackBaseUrl: process.env.PAYTRAIL_CALLBACK_BASE_URL,
            callbackDelay: process.env.PAYTRAIL_CALLBACK_DELAY
              ? Number(process.env.PAYTRAIL_CALLBACK_DELAY)
              : undefined,
            redirectUrlHostWhitelist: (process.env.PAYTRAIL_REDIRECT_URL_HOST_WHITELIST ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
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
- `PAYTRAIL_CALLBACK_DELAY` (optional, seconds, 0-900, default `0`)
- `PAYTRAIL_REDIRECT_URL_HOST_WHITELIST` (required, comma-separated `host[:port]` values)
- `PAYTRAIL_LANGUAGE` (`FI`, `SV`, or `EN`)

Example:

```env
PAYTRAIL_MERCHANT_ID=375917
PAYTRAIL_SECRET_KEY=SAIPPUAKAUPPIAS
PAYTRAIL_PLATFORM_NAME=MedusaJS
PAYTRAIL_CALLBACK_BASE_URL=https://your-backend.example.com
PAYTRAIL_CALLBACK_DELAY=0
PAYTRAIL_REDIRECT_URL_HOST_WHITELIST=localhost:8888,store.example.com
PAYTRAIL_LANGUAGE=EN
```

If `PAYTRAIL_CALLBACK_BASE_URL` is set, the provider sends Paytrail `callbackUrls` automatically as:

- success: `{PAYTRAIL_CALLBACK_BASE_URL}/hooks/paytrail`
- cancel: `{PAYTRAIL_CALLBACK_BASE_URL}/hooks/paytrail`

`PAYTRAIL_CALLBACK_DELAY` maps to Paytrail `callbackDelay` (seconds). According to Paytrail, when callback URLs are provided, callback delay can be `0` to `900` seconds and defaults to `0`.

Paytrail requires HTTPS callback URLs for both success and cancel callbacks.
Example uses [Paytrail test credentials](https://docs.paytrail.com/#/?id=test-credentials)

When creating payment sessions, `input.data.redirectUrls.success` and `input.data.redirectUrls.cancel`
must use `http` or `https`, include only host/path (no query/hash/auth), and the host must match
`PAYTRAIL_REDIRECT_URL_HOST_WHITELIST`.

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

## Contributing

Bug reports and feature requests are welcome.

When submitting an issue, include:

- A clear description of the problem or requested change
- Steps to reproduce, if applicable
- Relevant configuration details, logs, or screenshots

When submitting a pull request:

- Open an issue first for larger changes so the approach can be discussed
- Keep the PR focused on a single fix or feature
- Include tests or updates to existing tests when behavior changes
- Update the README or other documentation if the public behavior changes


## Disclaimer

This package is provided as-is, without warranty of any kind. You are responsible for validating the integration, security, and compliance requirements before using it in production.

## References

- [Official Paytrail API documentation](https://docs.paytrail.com/#/)
