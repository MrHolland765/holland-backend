import express from "express";
import cors from "cors";
import db from "./db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import orderRoutes from "./routes/orderRoutes.js";
import { seedMenu } from "./data/seedMenu.js";

const app = express();
const tokenSecret = process.env.AUTH_SECRET;

if (!tokenSecret) {
  throw new Error("AUTH_SECRET must be set in the backend .env file");
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signToken = (payload) => {
  const body = encode({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 });
  const signature = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
};
const verifyToken = (token) => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp > Date.now() ? payload : null;
};
const requireRole = (...roles) => (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    const user = token ? verifyToken(token) : null;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: "Huruhusiwi kufanya kitendo hiki" });
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Kikao cha kuingia kimeisha au si sahihi" });
  }
};

const hasColumn = async (table, column) => {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const ensureSchema = async () => {
  if (!(await hasColumn("users", "phone"))) {
    await db.query("ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL AFTER email");
  }
  if (!(await hasColumn("users", "address"))) {
    await db.query("ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone");
  }
  if (!(await hasColumn("products", "prep_time"))) {
    await db.query("ALTER TABLE products ADD COLUMN prep_time VARCHAR(50) NULL AFTER category");
  }
  await seedMenu();
  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(32) NOT NULL UNIQUE,
      customer_id BIGINT UNSIGNED NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_username VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(50) NOT NULL DEFAULT '',
      customer_address VARCHAR(500) NOT NULL DEFAULT '',
      category VARCHAR(100) NOT NULL DEFAULT 'Foods',
      status VARCHAR(40) NOT NULL DEFAULT 'Pending',
      assigned_to BIGINT UNSIGNED NULL,
      payment_method VARCHAR(255) NOT NULL,
      payment_phone VARCHAR(50) NOT NULL DEFAULT '',
      payment_status VARCHAR(50) NOT NULL,
      payment_reference VARCHAR(100) NULL,
      payment_verified_by BIGINT UNSIGNED NULL,
      payment_verified_at DATETIME NULL,
      items JSON NOT NULL,
      subtotal DECIMAL(12, 2) NOT NULL,
      fee DECIMAL(12, 2) NOT NULL,
      total DECIMAL(12, 2) NOT NULL,
      special_notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_orders_customer_created (customer_id, created_at),
      INDEX idx_orders_delivery_created (assigned_to, created_at),
      UNIQUE KEY uq_orders_payment_reference (payment_reference)
    )
  `);
  if (!(await hasColumn("orders", "payment_reference"))) {
    await db.query("ALTER TABLE orders ADD COLUMN payment_reference VARCHAR(100) NULL");
  }
  if (!(await hasColumn("orders", "payment_verified_by"))) {
    await db.query("ALTER TABLE orders ADD COLUMN payment_verified_by BIGINT UNSIGNED NULL");
  }
  if (!(await hasColumn("orders", "payment_verified_at"))) {
    await db.query("ALTER TABLE orders ADD COLUMN payment_verified_at DATETIME NULL");
  }
  const [paymentReferenceIndex] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
       AND INDEX_NAME = 'uq_orders_payment_reference'`
  );
  if (paymentReferenceIndex.length === 0) {
    await db.query("ALTER TABLE orders ADD UNIQUE INDEX uq_orders_payment_reference (payment_reference)");
  }

  const demoUsers = [
  [
    "Abdullhamid Khamis Abdalla",
    "abdullhamidkhamis765@gmail.com",
    "+255657281070",
    "Holland Restaurant",
    "admin",
    "Holland@26"
  ],
];

  for (const [fullName, email, phone, address, role, password] of demoUsers) {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length === 0) {
      await db.query(
        `INSERT INTO users (full_name, email, phone, address, password, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [fullName, email, phone, address, await bcrypt.hash(password, 10), role]
      );
    } else {
      await db.query("UPDATE users SET phone = COALESCE(phone, ?), address = COALESCE(address, ?) WHERE email = ?", [phone, address, email]);
    }
  }
};

db.getConnection()
  .then((connection) => {
    console.log("✅ MySQL connected successfully!");
    connection.release();
  })
  .catch((error) => {
    console.error("❌ MySQL connection failed:", error.message);
  });

app.use(cors());
app.use(express.json());
app.use("/api/orders", orderRoutes(requireRole));

app.get("/", (req, res) => {
  res.json({
    message: "Holland Restaurant Backend is running successfully!"
  });
});

// GET all users (passwords are never exposed)
app.get("/api/users", requireRole("admin"), async (req, res) => {
  try {
    const [users] = await db.query(
      "SELECT id, full_name, email, phone, address, role, created_at FROM users"
    );

    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error.message);

    res.status(500).json({
      message: "Failed to fetch users"
    });
  }
});

// GET all delivery staff
app.get("/api/delivery", requireRole("admin"), async (req, res) => {
  try {
    const [deliveryStaff] = await db.query(
      `SELECT id, full_name, email, phone, address, role, created_at
       FROM users
       WHERE role = 'delivery'
       ORDER BY id DESC`
    );

    res.json(deliveryStaff);
  } catch (error) {
    console.error("Error fetching delivery staff:", error.message);

    res.status(500).json({
      message: "Failed to fetch delivery staff"
    });
  }
});

// CREATE new user
app.post("/api/users", async (req, res) => {
  try {
    const { full_name, email, password, phone = null, address = null } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        message: "Full name, email and password are required"
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: "Tafadhali weka email sahihi" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Nenosiri lazima liwe na angalau herufi 6" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

const [result] = await db.query(
  `INSERT INTO users (full_name, email, phone, address, password, role)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [
    full_name,
    email.toLowerCase(),
    phone,
    address,
    hashedPassword,
    "customer"
  ]
);

    res.status(201).json({
      message: "User created successfully",
      userId: result.insertId,
      token: signToken({ id: result.insertId, role: "customer", email: email.toLowerCase() })
    });

 } catch (error) {
  console.error("Error creating user:", error.message);
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Email hii tayari imesajiliwa" });
  }
  res.status(500).json({ message: "Imeshindikana kusajili akaunti" });
}
});

app.delete("/api/delivery/:id", requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM users WHERE id = ? AND role = 'delivery'",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Delivery account not found",
      });
    }

    res.json({
      message: "Delivery account deleted successfully",
    });
  } catch (error) {
    console.error("Delete delivery error:", error);

    res.status(500).json({
      message: "Failed to delete delivery account",
    });
  }
});

// ADMIN: ADD DELIVERY STAFF
app.post("/api/delivery", requireRole("admin"), async (req, res) => {
  try {
    const { full_name, email, password, phone = null, address = null } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        message: "Jina, email na password vinahitajika"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password lazima iwe na angalau herufi 6"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users
       (full_name, email, phone, address, password, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        full_name,
        email.toLowerCase(),
        phone,
        address,
        hashedPassword,
        "delivery"
      ]
    );

    res.status(201).json({
      message: "Delivery account created successfully",
      userId: result.insertId
    });

  } catch (error) {
    console.error("Error creating delivery:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Email hii tayari imesajiliwa"
      });
    }

    res.status(500).json({
      message: "Imeshindikana kutengeneza Delivery account"
    });
  }
});

// LOGIN USER
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const [users] = await db.query(
      "SELECT * FROM users WHERE email = ? OR phone = ? LIMIT 1",
      [email.toLowerCase(), email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const user = users[0];

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    res.json({
      message: "Login successful",
      token: signToken({ id: user.id, role: user.role, email: user.email }),
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role
      }
    });

  } catch (error) {
    console.error("Login error:", error.message);

    res.status(500).json({
      message: "Login failed"
    });
  }
});

// GET all products
app.get("/api/products", async (req, res) => {
  try {
    const [products] = await db.query(
      "SELECT * FROM products ORDER BY id DESC"
    );

    res.json(products);

  } catch (error) {
    console.error("Error fetching products:", error.message);

    res.status(500).json({
      message: "Failed to fetch products"
    });
  }
});

app.post("/api/products", requireRole("admin"), async (req, res) => {
  try {
    const { name, description = "", price, image = "", category = "Foods", prepTime = "15-20 min", available = true } = req.body;
    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ message: "Jina na bei sahihi vinahitajika" });
    }
    const [result] = await db.query(
      `INSERT INTO products (name, description, price, image, category, prep_time, available)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), description.trim(), Number(price), image.trim(), category.trim(), prepTime.trim(), Boolean(available)]
    );
    const [products] = await db.query("SELECT * FROM products WHERE id = ?", [result.insertId]);
    res.status(201).json(products[0]);
  } catch (error) {
    console.error("Error creating product:", error.message);
    res.status(500).json({ message: "Imeshindikana kuongeza bidhaa" });
  }
});

app.put("/api/products/:id", requireRole("admin"), async (req, res) => {
  try {
    const { name, description = "", price, image = "", category = "Foods", prepTime = "15-20 min", available = true } = req.body;
    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ message: "Jina na bei sahihi vinahitajika" });
    }
    const [result] = await db.query(
      `UPDATE products SET name = ?, description = ?, price = ?, image = ?, category = ?, prep_time = ?, available = ? WHERE id = ?`,
      [name.trim(), description.trim(), Number(price), image.trim(), category.trim(), prepTime.trim(), Boolean(available), req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Bidhaa haijapatikana" });
    const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
    res.json(products[0]);
  } catch (error) {
    console.error("Error updating product:", error.message);
    res.status(500).json({ message: "Imeshindikana kusasisha bidhaa" });
  }
});

app.delete("/api/products/:id", requireRole("admin"), async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM products WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Bidhaa haijapatikana" });
    res.status(204).end();
  } catch (error) {
    console.error("Error deleting product:", error.message);
    res.status(500).json({ message: "Imeshindikana kufuta bidhaa" });
  }
});

const PORT = Number(process.env.PORT || 5000);

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error("Unable to prepare the database:", error.message);
    process.exit(1);
  });
