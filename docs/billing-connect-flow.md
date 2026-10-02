# Connect-billing flow (slice 1, verified 2026-10-01)

The one-time step a school owner completes to switch on their Fees101 account:
pay a setup fee and authorize the direct-debit mandate that collects the monthly
platform fee from then on. Verified end to end against Paystack test mode on
2026-10-01 with the "Paystack Test School" (setup fee overridden to NGN 100 via
`PLATFORM_SETUP_FEE_NAIRA`).

## The steps, as they actually ran

1. **Gate bounce.** Owner signs in. The new school has no `billing_connected_at`,
   so the `(app)` layout gate redirects to `/connect-billing`. (A grandfathered
   school, or one already connected, passes straight through.)

2. **Connect billing screen** (`/connect-billing`). Shows the terms plainly:
   setup fee today (NGN 100 in test), 65 free days, NGN 500 per student / month
   after that, collected by automatic bank debit. Owner ticks the clickwrap box
   ("I am authorized to set up billing ... and I accept the billing terms") and
   clicks "Pay NGN 100 and connect billing".
   - Server action `startBillingConnection` records the terms acceptance
     (`terms_accepted_at/_by/_version`), creates the Paystack transaction via
     `/transaction/initialize` (`channels:['bank']`,
     `custom_filters.recurring:true`), writes a pending `platform_billing` row,
     and returns the hosted-checkout URL.

3. **Paystack hosted checkout** (Paystack's domain, TEST badge visible).
   The direct-debit authorization flow:
   - Pick test bank (Zenith) + test account number `0000000000`, Verify Account.
   - "Enter any date of birth" -> Authorize.
   - "Use the code 123456 to complete account registration" -> Authorize.
   - "Payment Successful - You paid NGN 100 to Fees101."

4. **Callback** (`/connect-billing/callback`). Paystack redirects back with the
   reference. The route verifies the transaction server-to-server
   (`/transaction/verify/:reference`), then writes:
   - `setup_fee_status = paid`, `setup_fee_paid_at`
   - `mandate_authorization_code` (AUTH_...), `mandate_email`,
     `mandate_status = pending` (Paystack activates it in ~3h; confirmed lazily
     before the first recurring debit, not here)
   - `onboarding_at` (free-period day 0), `billing_connected_at` (the gate flag)
   - a `platform_billing_charges` row (NGN 100, success, direct_debit, setup_fee)
   Then redirects to `/today`.

5. **In the app.** With `billing_connected_at` set, the gate opens and the owner
   lands on Today.

## Verified database state after the run

```
platform_billing:
  setup_fee_amount        100
  setup_fee_status        paid
  setup_fee_paid_at       2026-10-01T16:51:57Z
  mandate_authorization_code  AUTH_... (captured)
  mandate_email           paystack@school.com
  mandate_status          pending
  mandate_authorized_at   2026-10-01T16:51:57Z
  billing_connected_at    2026-10-01T16:51:57Z
  onboarding_at           2026-10-01T16:51:57Z
  terms_accepted_at       2026-10-01T16:50:43Z
  terms_version           2026-10-01

platform_billing_charges:
  amount 100, status success, method direct_debit, charged_by setup_fee
```

## Notes for production

- Swap `PLATFORM_PAYSTACK_SECRET_KEY` to the platform `sk_live_` key and remove
  `PLATFORM_SETUP_FEE_NAIRA` (reverts the fee to NGN 10,000).
- Direct Debit must be enabled on the live platform Paystack account.
- The ~3h mandate activation only matters before the first recurring debit
  (slice 2), so slice 1 needs no webhook infrastructure.
