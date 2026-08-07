export interface PaytrailOptions {
  merchantId: number
  secretKey: string
  platformName?: string
  callbackBaseUrl?: string
  redirectUrlHostWhitelist: string[]
  language: "FI" | "SV" | "EN"
}
