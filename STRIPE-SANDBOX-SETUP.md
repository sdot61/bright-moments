# Bright Moments — Stripe sandbox checkout

The website now has a shopping cart, with prices shown on Bright Moments itself. The owner's Stripe account is needed only for secure hosted **test** checkout.

## Set up a sandbox connection

1. In the Bright Moments Stripe Dashboard, choose the **sandbox**. Copy the **secret API key** that begins with `sk_test_`.
2. In [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/wxgqesprekuzgqhhimlz/settings/functions), create `STRIPE_SANDBOX_SECRET_KEY` and paste that value **there only**. Never put the key in GitHub, browser code, or chat.
3. In [the Bright Moments editor](https://sdot61.github.io/bright-moments/admin.html), select **Store**, and enter a **Price (USD)** for an item. Check **Available to purchase**, then select **Save price**.
4. [Open the public Store](https://sdot61.github.io/bright-moments/?section=store), add the priced piece to the cart, and select **Test checkout with Stripe**.
5. Complete the Stripe-hosted checkout using the sandbox test card `4242 4242 4242 4242`, any future expiration date, and any three-digit CVC.
6. Confirm the transaction in Stripe **sandbox** payments. Returning to the website is not proof of successful payment.

## Safety boundaries

- Only sandbox keys (starting `sk_test_`) can be used. Live payments are disabled.
- Checkout always fetches prices and availability from Supabase; the browser cannot set the price paid.
- Items have quantity **one** each, suitable for unique mosaics. The cart stores item identifiers locally in the browser.
- This first sandbox implementation does **not** automatically mark sold items unavailable, reconcile orders, calculate tax, or charge shipping. Those require payment webhooks and a shipping/tax design before live launch.
- The owner's bank information is **not** needed for sandbox testing. It should remain exclusively in their Stripe account.
