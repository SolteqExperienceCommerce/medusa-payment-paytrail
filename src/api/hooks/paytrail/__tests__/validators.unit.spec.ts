/// <reference types="jest" />
import { PaytrailCallbackQuery } from "../validators"

/** Valid query params based on Paytrail docs example */
const validParams = {
  "checkout-account": "375917",
  "checkout-algorithm": "sha256",
  "checkout-amount": "2964",
  "checkout-stamp": "15336332710015",
  "checkout-reference": "192387192837195",
  "checkout-transaction-id": "4b300af6-9a22-11e8-9184-abb6de7fd2d0",
  "checkout-status": "ok",
  "checkout-provider": "nordea",
  signature:
    "b2d3ecdda2c04563a4638fcade3d4e77dfdc58829b429ad2c2cb422d0fc64080",
}

const parse = (overrides = {}) =>
  PaytrailCallbackQuery.safeParse({ ...validParams, ...overrides })

describe("PaytrailCallbackQuery", () => {
  it("accepts valid params", () => {
    const result = parse()
    expect(result.success).toBe(true)
  })

  it("coerces checkout-account from string to number", () => {
    const result = parse()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data["checkout-account"]).toBe(375917)
    }
  })

  it("coerces checkout-amount from string to number", () => {
    const result = parse()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data["checkout-amount"]).toBe(2964)
    }
  })

  it("allows checkout-settlement-reference as optional", () => {
    expect(parse().success).toBe(true)
    expect(
      parse({ "checkout-settlement-reference": "ref-123" }).success
    ).toBe(true)
  })

  it("allows checkout-transaction-id as optional", () => {
    const result = parse({ "checkout-transaction-id": undefined })
    expect(result.success).toBe(true)
  })

  it("rejects non-numeric checkout-account", () => {
    expect(parse({ "checkout-account": "abc" }).success).toBe(false)
  })

  it("rejects negative checkout-amount", () => {
    expect(parse({ "checkout-amount": "-1" }).success).toBe(false)
  })

  it("rejects checkout-amount over 99999999", () => {
    expect(parse({ "checkout-amount": "100000000" }).success).toBe(false)
  })

  it("rejects invalid checkout-status", () => {
    expect(parse({ "checkout-status": "unknown" }).success).toBe(false)
  })

  it("rejects missing signature", () => {
    const { signature, ...rest } = validParams
    expect(PaytrailCallbackQuery.safeParse(rest).success).toBe(false)
  })

  it("rejects empty checkout-provider", () => {
    expect(parse({ "checkout-provider": "" }).success).toBe(false)
  })

  it("rejects checkout-stamp exceeding 200 chars", () => {
    expect(parse({ "checkout-stamp": "x".repeat(201) }).success).toBe(false)
  })

  it("rejects checkout-reference exceeding 200 chars", () => {
    expect(
      parse({ "checkout-reference": "x".repeat(201) }).success
    ).toBe(false)
  })

  it.each(["ok", "fail", "pending", "delayed"])(
    "accepts checkout-status=%s",
    (status) => {
      expect(parse({ "checkout-status": status }).success).toBe(true)
    }
  )
})
