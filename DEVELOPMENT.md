# Development Guide

This document covers repository-specific development workflows for `@solteq-excom/medusa-payment-paytrail`.

## Repository Layout

- Provider entry: `src/providers/paytrail/index.ts`
- Provider service: `src/providers/paytrail/service.ts`
- Provider options type: `src/providers/paytrail/types.ts`
- Paytrail callback route: `src/api/hooks/paytrail/route.ts`
- Callback validators: `src/api/hooks/paytrail/validators.ts`
- API middlewares registration: `src/api/middlewares.ts`

## Local Plugin Development

Install dependencies:

```bash
yarn install
```

Publish the plugin locally for use in a Medusa app:

```bash
yarn publish:local
```

In the Medusa application:

```bash
cd <your-medusa-app>
yarn medusa plugin:add @solteq-excom/medusa-payment-paytrail
yarn install
```

If the Medusa app runs in Docker during development, ensure the Dockerfile copies local yalc content:

```dockerfile
COPY .yalc ./.yalc
```

## Local Verification

Start the backend:

```bash
yarn medusa develop
```

Verify:

- The payment provider id available for region linking is `pp_paytrail_paytrail`
- The callback route responds at `GET /hooks/paytrail`
- A created payment session returns a Paytrail redirect URL in `href`

## Testing

Run plugin unit tests from this repository:

```bash
yarn test:unit
```

This repository also includes integration test examples intended to be copied into a Medusa app:

- `integration-tests/http/payment-flow.spec.ts`
- `integration-tests/http/helpers/*`
- `integration-tests/http/__fixtures__/*`

Suggested flow:

1. Install and add this plugin to your Medusa app.
2. Copy the `integration-tests/http` folder contents into the app's integration test structure.
3. Configure the required `PAYTRAIL_*` environment variables in the app test environment.
4. Run the Medusa app's HTTP integration tests.

## Known Gaps

- Refund callback URLs are placeholder defaults if callback base URL is missing.
- `createPayment` currently uses only mandatory Paytrail parameters; item-level payload data and shop-in-shop scenarios need additional implementation.
- Refund handling is incomplete for flows where Paytrail does not process the refund immediately.
- `initiatePayment` error handling could include richer error context.
- Security testing is still needed before production use.