export interface PaytrailOptions {
  merchantId: number
  secretKey: string
  platformName?: string
  callbackBaseUrl?: string
  language: "FI" | "SV" | "EN"
}
