/// <reference types="jest" />
import { MedusaError } from "@medusajs/framework/utils"
import PaytrailProviderService from "../service"
import type { PaytrailOptions } from "../types"


const createPaymentMock = jest.fn()
const getPaymentStatusMock = jest.fn()
const createRefundMock = jest.fn()

jest.mock("crypto", () => ({
    ...jest.requireActual("crypto"),
    randomUUID: jest.fn(() => "uuid-1"),
}))

jest.mock("@paytrail/paytrail-js-sdk", () => {
    return {
        PaytrailClient: jest.fn().mockImplementation(() => ({
            createPayment: createPaymentMock,
            getPaymentStatus: getPaymentStatusMock,
            createRefund: createRefundMock,
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
        expect(getPaymentStatusMock).not.toHaveBeenCalled()
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
        expect(getPaymentStatusMock).not.toHaveBeenCalled()
    })

    it("creates refund with callback urls from config", async () => {
        const service = buildService()
        createRefundMock.mockResolvedValue({
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

        expect(createRefundMock).toHaveBeenCalledWith(
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
        ).rejects.toThrow("Failed to initiate Paytrail payment")

        expect(createPaymentMock).not.toHaveBeenCalled()
    })

    it("wraps initiatePayment errors with unexpected-state MedusaError", async () => {
        const service = buildService()
        createPaymentMock.mockRejectedValue(new Error("network failure"))

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-2-" },
                data: { session_id: "session-2" },
            } as any)
        ).rejects.toThrow(MedusaError)

        await expect(
            service.initiatePayment({
                amount: 10,
                currency_code: "eur",
                context: { idempotency_key: "idem-2-" },
                data: { session_id: "session-2" },
            } as any)
        ).rejects.toThrow("Failed to initiate Paytrail payment")
    })
})
