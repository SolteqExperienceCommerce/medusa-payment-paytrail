/// <reference types="jest" />
import { MedusaError } from "@medusajs/framework/utils"
import PaytrailProviderService from "../service"
import type { PaytrailOptions } from "../types"


const mockCreatePayment = jest.fn()
const mockGetPaymentStatus = jest.fn()
const mockCreateRefund = jest.fn()

jest.mock("crypto", () => ({
    ...jest.requireActual("crypto"),
    randomUUID: jest.fn(() => "uuid-1"),
}))

jest.mock("@paytrail/paytrail-js-sdk", () => {
    return {
        PaytrailClient: jest.fn().mockImplementation(() => ({
            createPayment: mockCreatePayment,
            getPaymentStatus: mockGetPaymentStatus,
            createRefund: mockCreateRefund,
        })),
        CreatePaymentRequest: class CreatePaymentRequest { },
        CreateRefundRequest: class CreateRefundRequest { },
    }
})

describe("PaytrailProviderService", () => {
    const logger = { error: jest.fn() }

    const baseConfig: PaytrailOptions = {
        merchantId: 375917,
        secretKey: "SAIPPUAKAUPPIAS",
        platformName: "medusa-tests",
        callbackBaseUrl: "https://store.example.com",
        callbackDelay: 5,
        redirectUrlHostWhitelist: ["storefront.example", "localhost:8888"],
        language: "FI",
    }

    const buildService = (config: PaytrailOptions = baseConfig) =>
        new PaytrailProviderService({ logger }, config)

    beforeEach(() => {
        jest.clearAllMocks()
    })

    it("validates required provider options", () => {
        expect(() =>
            PaytrailProviderService.validateOptions({
                secretKey: "abc",
            })
        ).toThrow("Paytrail merchantId is required")

        expect(() =>
            PaytrailProviderService.validateOptions({
                merchantId: 123,
            })
        ).toThrow("Paytrail secretKey is required")

        expect(() =>
            PaytrailProviderService.validateOptions({
                merchantId: 123,
                secretKey: "abc",
            })
        ).toThrow("Paytrail redirectUrlHostWhitelist is required")
    })

    it("returns error when authorizePayment has no transactionId", async () => {
        const service = buildService()

        const result = await service.authorizePayment({
            data: {},
        } as any)

        expect(result).toEqual({
            status: "error",
            data: {},
        })
        expect(mockGetPaymentStatus).not.toHaveBeenCalled()
    })

    it("returns error from getPaymentStatus when transactionId is missing", async () => {
        const service = buildService()

        const result = await service.getPaymentStatus({
            data: {},
        } as any)

        expect(result).toEqual({
            status: "error",
            data: {},
        })
        expect(mockGetPaymentStatus).not.toHaveBeenCalled()
    })

    it("creates refund with callback urls from config", async () => {
        const service = buildService()
        mockCreateRefund.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "refund-123",
                provider: "nordea",
                status: "pending",
            },
        })

        const result = await service.refundPayment({
            amount: 12.5,
            context: { idempotency_key: "refund-idem-1" },
            data: { transactionId: "trx-123" },
        } as any)

        expect(mockCreateRefund).toHaveBeenCalledWith(
            { transactionId: "trx-123" },
            expect.objectContaining({
                amount: 1250,
                refundReference: "refund-idem-1",
                refundStamp: "uuid-1",
                callbackUrls: {
                    success: "https://store.example.com/hooks/paytrail",
                    cancel: "https://store.example.com/hooks/paytrail",
                },
            })
        )

        expect(result).toEqual({
            data: {
                transactionId: "trx-123",
                refundTransactionId: "refund-123",
                refundProvider: "nordea",
                refundStatus: "pending",
            },
        })
    })

    it("throws when initiatePayment is called with non-EUR currency", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "usd",
                context: { idempotency_key: "idem-non-eur-" },
                data: { session_id: "session-non-eur" },
            } as any)
        ).rejects.toThrow(MedusaError)

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "usd",
                context: { idempotency_key: "idem-non-eur-" },
                data: { session_id: "session-non-eur" },
            } as any)
        ).rejects.toThrow("Paytrail only supports EUR currency")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("wraps initiatePayment errors with unexpected-state MedusaError", async () => {
        const service = buildService()
        mockCreatePayment.mockRejectedValue(new Error("network failure"))

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-2-", customer: { email: "test@example.com" } },
                data: {
                    session_id: "session-2",
                    redirect_success: "https://storefront.example/success",
                    redirect_cancel: "https://storefront.example/cancel",
                },
            } as any)
        ).rejects.toThrow(MedusaError)

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-2-", customer: { email: "test@example.com" } },
                data: {
                    session_id: "session-2",
                    redirect_success: "https://storefront.example/success",
                    redirect_cancel: "https://storefront.example/cancel",
                },
            } as any)
        ).rejects.toThrow("Failed to initiate Paytrail payment")
    })

    it("throws explicit validation error when email is missing", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-no-email-" },
                data: { session_id: "session-no-email" },
            } as any)
        ).rejects.toThrow(MedusaError)

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-no-email-" },
                data: { session_id: "session-no-email" },
            } as any)
        ).rejects.toThrow("Paytrail: a customer email is required to initiate payment")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("throws when redirect URL host is not whitelisted", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-invalid-host-", customer: { email: "customer@example.com" } },
                data: {
                    session_id: "session-invalid-host",
                    redirect_success: "https://evil.example/success",
                    redirect_cancel: "https://storefront.example/cancel",
                },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirect_success host 'evil.example' is not whitelisted")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("throws when cancel redirect URL host is not whitelisted", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-invalid-cancel-host-", customer: { email: "customer@example.com" } },
                data: {
                    session_id: "session-invalid-cancel-host",
                    redirect_success: "https://storefront.example/success",
                    redirect_cancel: "https://evil.example/cancel",
                },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirect_cancel host 'evil.example' is not whitelisted")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("accepts wildcard subdomain pattern in redirectUrlHostWhitelist", async () => {
        const service = buildService({
            ...baseConfig,
            redirectUrlHostWhitelist: ["*.foo.bar.baz"],
        })

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-wildcard-subdomain",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-wildcard-subdomain-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-wildcard-subdomain",
                redirect_success: "https://pr-12423.foo.bar.baz/success",
                redirect_cancel: "https://pr-56789.foo.bar.baz/cancel",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalled()
    })

    it("accepts prefix wildcard pattern in redirectUrlHostWhitelist", async () => {
        const service = buildService({
            ...baseConfig,
            redirectUrlHostWhitelist: ["pr-*.foo.bar.baz"],
        })

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-wildcard-prefix",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-wildcard-prefix-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-wildcard-prefix",
                redirect_success: "https://pr-12423.foo.bar.baz/success",
                redirect_cancel: "https://pr-12423.foo.bar.baz/cancel",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalled()
    })

    it("rejects hosts that do not match wildcard whitelist pattern", async () => {
        const service = buildService({
            ...baseConfig,
            redirectUrlHostWhitelist: ["pr-*.foo.bar.baz"],
        })

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-wildcard-reject-", customer: { email: "customer@example.com" } },
                data: {
                    session_id: "session-wildcard-reject",
                    redirect_success: "https://preview-12423.foo.bar.baz/success",
                    redirect_cancel: "https://pr-12423.foo.bar.baz/cancel",
                },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirect_success host 'preview-12423.foo.bar.baz' is not whitelisted")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("accepts redirect URLs with query parameters and fragments", async () => {
        const service = buildService()

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-url-components",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-url-components-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-url-components",
                redirect_success: "http://localhost:8888/api/capture-payment/cart_01KZEA5C9HSKGMS739ZB9V878C?x=1#complete",
                redirect_cancel: "http://localhost:8888/api/cancel-payment/cart_01KZEA5C9HSKGMS739ZB9V878C?reason=user#cancelled",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                redirectUrls: {
                    success: "http://localhost:8888/api/capture-payment/cart_01KZEA5C9HSKGMS739ZB9V878C?x=1#complete",
                    cancel: "http://localhost:8888/api/cancel-payment/cart_01KZEA5C9HSKGMS739ZB9V878C?reason=user#cancelled",
                },
            })
        )
    })

    it("uses redirect_success and redirect_cancel from input.data when provided", async () => {
        const configWithoutBaseUrl: PaytrailOptions = {
            ...baseConfig,
            callbackBaseUrl: undefined,
        }
        const service = buildService(configWithoutBaseUrl)

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-redirect-input",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-input-redirect-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-input-redirect",
                redirect_success: "https://storefront.example/success",
                redirect_cancel: "https://storefront.example/cancel",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                redirectUrls: {
                    success: "https://storefront.example/success",
                    cancel: "https://storefront.example/cancel",
                },
            })
        )
    })

    it("includes callbackUrls and callbackDelay from config", async () => {
        const service = buildService()

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-callback-input",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-input-callback-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-input-callback",
                redirect_success: "https://storefront.example/success",
                redirect_cancel: "https://storefront.example/cancel",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                callbackUrls: {
                    success: "https://store.example.com/hooks/paytrail",
                    cancel: "https://store.example.com/hooks/paytrail",
                },
                callbackDelay: 5,
            })
        )
    })

    it("omits callbackUrls and callbackDelay when not configured", async () => {
        const service = buildService({
            ...baseConfig,
            callbackBaseUrl: undefined,
            callbackDelay: undefined,
        })

        mockCreatePayment.mockResolvedValue({
            status: 200,
            data: {
                transactionId: "trx-no-callback-config",
                href: "https://paytrail.example/redirect",
            },
        })

        await service.initiatePayment({
            amount: 10,
            currency_code: "eur",
            context: { idempotency_key: "idem-no-callback-config-", customer: { email: "customer@example.com" } },
            data: {
                session_id: "session-no-callback-config",
                redirect_success: "https://storefront.example/success",
                redirect_cancel: "https://storefront.example/cancel",
            },
        } as any)

        expect(mockCreatePayment).toHaveBeenCalledWith(
            expect.not.objectContaining({
                callbackUrls: expect.anything(),
            })
        )
        expect(mockCreatePayment).toHaveBeenCalledWith(
            expect.not.objectContaining({
                callbackDelay: expect.anything(),
            })
        )
    })

    it("throws when callbackDelay config is invalid", async () => {
        const service = buildService({
            ...baseConfig,
            callbackDelay: -1,
        })

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-invalid-callback-delay-", customer: { email: "customer@example.com" } },
                data: {
                    session_id: "session-invalid-callback-delay",
                    redirect_success: "https://storefront.example/success",
                    redirect_cancel: "https://storefront.example/cancel",
                },
            } as any)
        ).rejects.toThrow("Paytrail callbackDelay must be a number between 0 and 900 seconds")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("throws when redirect URLs are missing from input", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-no-redirect-", customer: { email: "customer@example.com" } },
                data: { session_id: "session-no-redirect" },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirect_success and input.data.redirect_cancel are required")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })
})
