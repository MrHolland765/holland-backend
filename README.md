# Holland Restaurant — Backend

Express and MySQL API for user authentication, menu management, and orders.

## Start it

1. Create the MySQL database named `holland_restaurant` (or choose another name in `.env`).
2. Copy `.env.example` to `.env`, set the database credentials, and set `AUTH_SECRET` to a long private value. To enable password reset emails, also set `FRONTEND_URL` to the deployed frontend URL and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`.
3. Run `npm start`.

On startup, the server safely adds the profile and menu columns it needs, creates the orders table if needed, seeds or updates the requested Zanzibar menu items from `data/menuAdditions.json` once (tracked in `menu_seed_log`), restores original menu image URLs for products still using the Forodhani image paths (tracked in `menu_migration_log`), and creates the three demo accounts if they do not already exist. The restore migration only changes products still using those exact Forodhani paths, so administrator-selected images are preserved.

Menu prices in `data/menuAdditions.json` are initial estimates, not verified current prices from Zanzibar restaurant menus. Review them against local supplier costs, serving sizes, and nearby restaurants before publishing. The exact local meaning of "vileja" was not independently verified; confirm its ingredients and description with the restaurant before serving it.

The API is available at `http://localhost:5000` by default. Login returns a signed session token. Customers can create and view only their own orders; administrators can view, update, assign, and delete orders; delivery staff can view only assigned orders and update delivery status.

Orders and profile photos are saved in MySQL and are not limited to one browser or device. The API exposes `PUT /api/profile/avatar` for the authenticated user's own profile photo; the `users.avatar` column is added automatically on startup. Customers can confirm receipt only after delivery staff mark an order as delivered; administrators can delete only customer-confirmed received orders. Admins can list customers with `GET /api/customers` and remove an account using `DELETE /api/customers/:id` only after the customer has a received order and no active orders; completed order history is retained. Admins must confirm mobile or cash payments before an order can be assigned to delivery and can reject pending payments with `PUT /api/orders/:id/payment-rejection`; payment decision audit columns are added automatically on startup. Orders use `GET/POST /api/orders`, `PUT/DELETE /api/orders/:id`, `PUT /api/orders/:id/assign`, and the admin-only manual payment confirmation endpoint `PUT /api/orders/:id/payment-confirmation`.

Password recovery is available through `POST /api/password/forgot` and `POST /api/password/reset`. Reset links are emailed with single-use tokens that expire after one hour; the token table is created automatically. SMTP settings must be configured for email requests to work.

Tigo Pesa, M-Pesa, Airtel Money, and Halo Pesa manual payments store the customer's transaction reference as `Pending Verification`; an administrator must compare the reference and amount with the actual wallet transaction before confirming. This manual flow does not initiate a mobile-money transfer or independently verify payments. The receiving number is the configured Tigo Pesa number; customers can use another wallet only if their provider supports sending to that number. Configure merchant API integrations to automate payment collection and verification.

Holland Restaurant - Vercel deployment update