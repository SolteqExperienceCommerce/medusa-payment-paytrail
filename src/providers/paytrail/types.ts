export interface PaytrailOptions {
  merchantId: number
  secretKey: string
  platformName?: string
  callbackBaseUrl?: string
  callbackDelay?: number
  redirectUrlHostWhitelist: string[]
  language: "FI" | "SV" | "EN"
}
