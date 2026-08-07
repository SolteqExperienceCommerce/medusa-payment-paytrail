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
                    redirectUrls: {
                        success: "https://storefront.example/success",
                        cancel: "https://storefront.example/cancel",
                    },
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
                    redirectUrls: {
                        success: "https://storefront.example/success",
                        cancel: "https://storefront.example/cancel",
                    },
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
                    redirectUrls: {
                        success: "https://evil.example/success",
                        cancel: "https://storefront.example/cancel",
                    },
                },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirectUrls.success host 'evil.example' is not whitelisted")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("throws when redirect URL includes query parameters", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-query-url-", customer: { email: "customer@example.com" } },
                data: {
                    session_id: "session-query-url",
                    redirectUrls: {
                        success: "http://localhost:8888/api/capture-payment/cart_01KZEA5C9HSKGMS739ZB9V878C?x=1",
                        cancel: "http://localhost:8888/api/cancel-payment/cart_01KZEA5C9HSKGMS739ZB9V878C",
                    },
                },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirectUrls.success must only include host and path")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it("uses redirectUrls from input.data when provided", async () => {
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
                redirectUrls: {
                    success: "https://storefront.example/success",
                    cancel: "https://storefront.example/cancel",
                },
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

    it("throws when redirect URLs are missing from input", async () => {
        const service = buildService()

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-no-redirect-", customer: { email: "customer@example.com" } },
                data: { session_id: "session-no-redirect" },
            } as any)
        ).rejects.toThrow("Paytrail: input.data.redirectUrls.success and input.data.redirectUrls.cancel are required")

        expect(mockCreatePayment).not.toHaveBeenCalled()
    })
})
