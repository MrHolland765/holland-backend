# Holland Restaurant — Backend

Express and MySQL API for user authentication and menu management.

## Start it

1. Create the MySQL database named `holland_restaurant` (or choose another name in `.env`).
2. Copy `.env.example` to `.env`, set the database credentials, and set `AUTH_SECRET` to a long private value.
3. Run `npm start`.

On startup, the server safely adds the profile and menu columns it needs, and creates the three demo accounts if they do not already exist. Existing products and user passwords are not overwritten.

The API is available at `http://localhost:5000` by default. Login returns a signed session token; only an account whose database role is `admin` can create, change, or delete products.
