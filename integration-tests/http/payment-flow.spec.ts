import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAuthenticatedCustomer } from "./helpers/create-authenticated-customer"
import { createAdminUser, generatePublishableKey, generateStoreHeaders } from "./helpers/create-admin-user"
import { medusaTshirtProduct } from "./__fixtures__/product"
import { Modules } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/types"

jest.setTimeout(60 * 1000)

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

medusaIntegrationTestRunner({
  env,
  testSuite: ({ getContainer, api }) => {
    let appContainer: MedusaContainer

    beforeAll(async () => {
      appContainer = getContainer()
    })

    describe("Paytrail checkout integration", () => {
      let storeHeaders
      let storeHeadersWithCustomer: { headers: { authorization: string; "x-publishable-api-key": string } }
      let noAutomaticRegion: { id: any },
        product: { variants: any[] },
        salesChannel: { id: any },
        shippingProfile: { id: any }

      beforeAll(async () => {
        await createAdminUser(adminHeaders, appContainer)
        const publishableKey = await generatePublishableKey(appContainer)
        storeHeaders = generateStoreHeaders({ publishableKey })

        const result = await createAuthenticatedCustomer(api, storeHeaders, {
          first_name: "tony",
          last_name: "stark",
          email: "tony@stark-industries.com",
        })

        storeHeadersWithCustomer = {
          headers: {
            ...storeHeaders.headers,
            authorization: `Bearer ${result.jwt}`,
          },
        }

        shippingProfile = (
          await api.post(
            `/admin/shipping-profiles`,
            { name: "default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile

        noAutomaticRegion = (
          await api.post(
            "/admin/regions",
            { name: "EUR", currency_code: "eur", automatic_taxes: false },
            adminHeaders
          )
        ).data.region

        salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "Webshop", description: "channel" },
            adminHeaders
          )
        ).data.sales_channel

        // ── Link publishable API key to sales channel ──
        await api.post(
          `/admin/api-keys/${publishableKey.id}/sales-channels`,
          { add: [salesChannel.id] },
          adminHeaders
        )

        product = (
          await api.post(
            "/admin/products",
            {
              ...medusaTshirtProduct,
              shipping_profile_id: shippingProfile.id,
              sales_channels: [{ id: salesChannel.id }],
            },
            adminHeaders
          )
        ).data.product

        // ── Create stock location ──
        const stockLocation = (
          await api.post(
            "/admin/stock-locations",
            { name: "Test Warehouse" },
            adminHeaders
          )
        ).data.stock_location

        // Link sales channel to stock location
        await api.post(
          `/admin/stock-locations/${stockLocation.id}/sales-channels`,
          { add: [salesChannel.id] },
          adminHeaders
        )

        await api.post(
          `/admin/stock-locations/${stockLocation.id}/fulfillment-sets`,
          {
            name: "Test Set",
            type: "shipping",
          },
          adminHeaders
        )

        // Link fulfillment provider to stock location
        await api.post(
          `/admin/stock-locations/${stockLocation.id}/fulfillment-providers`,
          { add: ["manual_manual"] },
          adminHeaders
        )

        const updatedStockLocation = (
          await api.get(
            `/admin/stock-locations/${stockLocation.id}?fields=*fulfillment_sets`,
            adminHeaders
          )
        ).data.stock_location

        const fulfillmentSet = updatedStockLocation.fulfillment_sets[0]
        expect(fulfillmentSet?.id).toBeDefined()

        const serviceZoneRes = await api.post(
          `/admin/fulfillment-sets/${fulfillmentSet.id}/service-zones`,
          {
            name: "Finland Zone",
            geo_zones: [
              {
                type: "country",
                country_code: "fi",
              },
            ],
          },
          adminHeaders
        )

        const serviceZoneId =
          serviceZoneRes.data.fulfillment_set?.service_zones?.[0]?.id ||
          serviceZoneRes.data.service_zone?.id
        expect(serviceZoneId).toBeDefined()

        await api.post(
          "/admin/shipping-options",
          {
            name: "Standard Shipping",
            service_zone_id: serviceZoneId,
            shipping_profile_id: shippingProfile.id,
            provider_id: "manual_manual",
            price_type: "flat",
            type: {
              label: "Standard",
              code: "standard",
            },
            prices: [
              {
                currency_code: "eur",
                amount: 10,
              },
            ],
          },
          adminHeaders
        )

        // ── Link payment provider to region ──
        const link = appContainer.resolve("remoteLink")
        await link.create({
          [Modules.REGION]: { region_id: noAutomaticRegion.id },
          [Modules.PAYMENT]: { payment_provider_id: "pp_paytrail_paytrail" },
        })

        // ── Add stock levels for product variant inventory items ──
        // Admin product creation auto-creates inventory items, just need to add location levels
        const { data: inventoryItems } = await api.get(
          `/admin/inventory-items?sku[]=${product.variants.map((v: any) => v.sku).join("&sku[]=")}`,
          adminHeaders
        )
        for (const item of inventoryItems.inventory_items) {
          await api.post(
            `/admin/inventory-items/${item.id}/location-levels`,
            { location_id: stockLocation.id, stocked_quantity: 100 },
            adminHeaders
          )         
        }
      })

      describe("Paytrail payment flow", () => {
        it("creates a Paytrail payment session and fails cart completion before authorization", async () => {
          const cartRes = await api.post(
            "/store/carts",
            {
              region_id: noAutomaticRegion.id,
              sales_channel_id: salesChannel.id,
              currency_code: "eur",
              email: "test@example.com",
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
              shipping_address: {
                first_name: "Test",
                last_name: "User",
                address_1: "Mannerheimintie 1",
                city: "Helsinki",
                country_code: "fi",
                postal_code: "00100",
              },
              billing_address: {
                first_name: "Test",
                last_name: "User",
                address_1: "Mannerheimintie 1",
                city: "Helsinki",
                country_code: "fi",
                postal_code: "00100",
              },
            },
            storeHeadersWithCustomer
          )

          expect(cartRes.status).toBe(200)
          const cart = cartRes.data.cart
          expect(cart.items).toHaveLength(1)

          const shippingOptionsRes = await api.get(
            "/store/shipping-options",
            {
              ...storeHeadersWithCustomer,
              params: { cart_id: cart.id },
            }
          )
          expect(shippingOptionsRes.status).toBe(200)
          expect(shippingOptionsRes.data.shipping_options.length).toBeGreaterThan(0)

          const shippingOption = shippingOptionsRes.data.shipping_options[0]
          const addShippingMethodRes = await api.post(
            `/store/carts/${cart.id}/shipping-methods`,
            {
              option_id: shippingOption.id,
            },
            storeHeadersWithCustomer
          )
          expect(addShippingMethodRes.status).toBe(200)

          const paymentCollectionRes = await api.post(
            "/store/payment-collections",
            {
              cart_id: cart.id,
            },
            storeHeadersWithCustomer
          )
          expect(paymentCollectionRes.status).toBe(200)
          const paymentCollection =
            paymentCollectionRes.data.payment_collection

          const paymentSessionRes = await api.post(
            `/store/payment-collections/${paymentCollection.id}/payment-sessions`,
            {
              provider_id: "pp_paytrail_paytrail",
            },
            storeHeadersWithCustomer
          )
          expect(paymentSessionRes.status).toBe(200)

          const paymentSession =
            paymentSessionRes.data.payment_collection.payment_sessions[0]

          // Paytrail should return a transaction ID and redirect URL
          expect(paymentSession.data.transactionId).toBeDefined()
          expect(paymentSession.data.href).toBeDefined()
          expect(paymentSession.data.href).toContain("paytrail")
          expect(paymentSession.status).toBe("pending")

          // Completing should fail until customer authorizes payment at Paytrail.
          await expect(
            api.post(
              `/store/carts/${cart.id}/complete`,
              {},
              storeHeadersWithCustomer
            )
          ).rejects.toMatchObject({
            response: {
              status: 400,
              data: expect.objectContaining({
                message: expect.stringContaining("not authorized"),
              }),
            },
          })
        })
      })
    })
  },
})