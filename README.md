# Paytrail Payment Provider Plugin

This package integrates Paytrail as a Medusa payment provider plugin.

It is consumed by the Medusa app in [medusa-config.ts](../../medusa-config.ts):

- provider resolve: `@solteq/medusa-payment-paytrail/providers/paytrail`
- provider id: `paytrail`
- plugin resolve: `@solteq/medusa-payment-paytrail`

## References

- Official Paytrail API documentation: https://docs.paytrail.com/#/

## Location

- Provider entry: [src/providers/paytrail/index.ts](src/providers/paytrail/index.ts)
- Provider service: [src/providers/paytrail/service.ts](src/providers/paytrail/service.ts)
- Provider options type: [src/providers/paytrail/types.ts](src/providers/paytrail/types.ts)
- Paytrail callback route: [src/api/hooks/paytrail/route.ts](src/api/hooks/paytrail/route.ts)
- Callback validators: [src/api/hooks/paytrail/validators.ts](src/api/hooks/paytrail/validators.ts)
- API middlewares registration: [src/api/middlewares.ts](src/api/middlewares.ts)

## Features Implemented

- Payment session initiation via Paytrail API (`createPayment`)
- Payment status check for authorization flow (`getPaymentStatus`)
- Refund support (`createRefund`)
- Callback action parsing and HMAC signature verification
- Custom GET callback route for Paytrail redirect/callback query params

## Current Behavior

- Currency support is limited to `EUR` by Paytrail.
- Payment session is created with status `pending` until Paytrail authorizes it.
- Cart completion fails before third-party authorization (expected behavior).
- Standard Paytrail flow is treated as auto-captured after authorization.

## Plugin Install Guide

Install this plugin into your Medusa backend using local publish and plugin add.

### 1. In the plugin project

Run:

```bash
yarn install
yarn medusa plugin:publish
```

### 2. In the Medusa application

Change to your Medusa app directory, then run:

```bash
cd <your-medusa-app>
yarn medusa plugin:add @solteq/medusa-payment-paytrail
yarn install
```

### 3. `medusa-config.ts`

Ensure this plugin entry exists in your `plugins` array:

```ts
  plugins: [
    {
      resolve: "@solteq/medusa-payment-paytrail",
      options: {},
    },
  ],  
   modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@solteq/medusa-payment-paytrail/providers/paytrail",
            id: "paytrail",
            options: {
              merchantId: Number(process.env.PAYTRAIL_MERCHANT_ID ?? "375917"),
              secretKey: process.env.PAYTRAIL_SECRET_KEY ?? "SAIPPUAKAUPPIAS",
              platformName: process.env.PAYTRAIL_PLATFORM_NAME ?? "MedusaJS",
              callbackBaseUrl: process.env.PAYTRAIL_CALLBACK_BASE_URL,
              language: process.env.PAYTRAIL_LANGUAGE ?? "EN",
            },
          },
```

### 4. Configure environment variables

Set the required variables in your environment:

```env
PAYTRAIL_MERCHANT_ID=375917
PAYTRAIL_SECRET_KEY=SAIPPUAKAUPPIAS
PAYTRAIL_PLATFORM_NAME=MedusaJS
PAYTRAIL_CALLBACK_BASE_URL=https://your-backend.example.com
PAYTRAIL_LANGUAGE=EN
```

Important: Paytrail requires HTTPS callback URLs.

### 5. Start Medusa and verify

Start your backend:

```bash
yarn medusa develop
```

Then verify:

- The payment provider id available for region linking is `pp_paytrail_paytrail`
- The callback route responds at `GET /hooks/paytrail`
- A created payment session returns a Paytrail redirect URL (`href`)

## Configuration

The Medusa app config uses this plugin package from [medusa-config.ts](../../medusa-config.ts).

### Environment Variables

- `PAYTRAIL_MERCHANT_ID`
- `PAYTRAIL_SECRET_KEY`
- `PAYTRAIL_PLATFORM_NAME` (optional)
- `PAYTRAIL_CALLBACK_BASE_URL` (recommended, must use HTTPS)
- `PAYTRAIL_LANGUAGE` (`FI`, `SV`, or `EN`)

Paytrail requirement: callback URLs must use HTTPS (both success and cancel URLs).

Example values in config defaults:

- `merchantId`: `375917`
- `secretKey`: `SAIPPUAKAUPPIAS`
- `platformName`: `MedusaJS`
- `language`: `EN`

## Provider Identifier and IDs

- Provider class identifier: `paytrail`
- Region payment provider link id used in tests: `pp_paytrail_paytrail`

## Callback Route

The Paytrail callback route is implemented as:

- `GET /hooks/paytrail`

It forwards callback payload into Medusa's payment webhook pipeline by emitting `PaymentWebhookEvents.WebhookReceived`.

Notes:

- The implementation follows the same event-forwarding pattern as Medusa's built-in payment webhook endpoint.
- The built-in endpoint is designed for `POST` webhook calls, so it could not be used directly for Paytrail callbacks.
- Paytrail sends callback data in query parameters.
- Signature is validated before authorization action is returned.

## Payment Flow Summary

1. Store creates payment session with provider `pp_paytrail_paytrail`.
2. Paytrail returns redirect URL (`href`) and `transactionId`.
3. Customer authorizes payment in Paytrail checkout.
4. Callback updates payment status to authorized/captured.
5. Cart completion succeeds only after authorization.

## Testing

This plugin currently has unit-level test coverage.

### Unit tests (in plugin)

Unit tests cover Paytrail provider service behavior (for example status mapping and provider-specific logic) without running the full checkout flow.

Run all plugin unit tests:

```bash
yarn --cwd packages/medusa-payment-paytrail test:unit
```

Or run from plugin directory:

```bash
yarn test:unit
```

### Integration tests (copy to Medusa app)

This repository includes ready-to-adapt integration test examples under:

- `integration-tests/http/payment-flow.spec.ts`
- `integration-tests/http/helpers/*`
- `integration-tests/http/__fixtures__/*`

You can copy these files into your Medusa application's integration test folder structure and run them there.

Suggested flow:

1. Install and add this plugin to your Medusa app.
2. Copy the `integration-tests/http` folder contents into your app's integration tests.
3. Configure required `PAYTRAIL_*` environment variables in the app test environment.
4. Run integration tests in your Medusa app, for example: `yarn test:integration:http`.

## Known Gaps / TODO

- Refund callback URLs are currently placeholder defaults if callback base URL is missing.
- `createPayment` currently uses only mandatory Paytrail parameters; item-level payload data and shop-in-shop scenarios require additional implementation.
- Handling of refunds in cases where Paytrail does not process the refund immediately.
- Error handling in `initiatePayment` could include richer error context.
- Security testing before production use.

## Troubleshooting

### No payment providers available in store

- Ensure Paytrail provider is linked to the region.
- In tests, this is done through remote link creation for `pp_paytrail_paytrail`.

### Cart completion returns 400 not authorized

- This is expected before Paytrail authorization callback is processed.
- Complete payment in Paytrail (or simulate authorization in test strategy) before completing cart.

### Callback is not triggered

- Verify `PAYTRAIL_CALLBACK_BASE_URL` is configured with an HTTPS URL.
- Paytrail requires HTTPS callback URLs for both success and cancel callbacks.
