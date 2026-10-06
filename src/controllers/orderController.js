import crypto from "crypto";
import db from "../db.js";

const normalizeOrder = (row) => {
  const createdAt = new Date(row.created_at);
  return ({
  id: row.order_code,
  orderNumber: row.id,
  customerName: row.customer_name,
  customerUsername: row.customer_username,
  customerPhone: row.customer_phone,
  customerAddress: row.customer_address,
  date: createdAt.toLocaleDateString("en-GB"),
  time: createdAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
  category: row.category,
  status: row.status,
  assignedTo: row.assigned_name || "Unassigned",
  assignedToId: row.assigned_to,
  deliveryPhone: row.assigned_phone || "",
  paymentMethod: row.payment_method,
  paymentPhone: row.payment_phone,
  paymentStatus: row.payment_status,
  paymentReference: row.payment_reference || "",
  items: typeof row.items === "string" ? JSON.parse(row.items) : row.items,
  subtotal: Number(row.subtotal),
  fee: Number(row.fee),
  total: Number(row.total),
  specialNotes: row.special_notes || "",
  });
};

const orderSelect = `
  SELECT o.*, u.full_name AS assigned_name, u.phone AS assigned_phone
  FROM orders o
  LEFT JOIN users u ON u.id = o.assigned_to
`;

export const getOrders = async (req, res) => {
  try {
    let query = `${orderSelect} ORDER BY o.created_at DESC`;
    let params = [];

    if (req.user.role === "customer") {
      query = `${orderSelect} WHERE o.customer_id = ? ORDER BY o.created_at DESC`;
      params = [req.user.id];
    } else if (req.user.role === "delivery") {
      query = `${orderSelect} WHERE o.assigned_to = ? ORDER BY o.created_at DESC`;
      params = [req.user.id];
    }

    const [rows] = await db.query(query, params);
    res.json(rows.map(normalizeOrder));
  } catch (error) {
    console.error("Error fetching orders:", error.message);
    res.status(500).json({ message: "Imeshindikana kupata oda" });
  }
};

export const createOrder = async (req, res) => {
  try {
    const {
      paymentMethod,
      paymentPhone = "",
      paymentReference = "",
      specialNotes = "",
      items,
      subtotal,
      fee,
      total,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Oda lazima iwe na bidhaa" });
    }

    if (items.length > 100) {
      return res.status(400).json({ message: "Oda ina bidhaa nyingi kupita kiasi" });
    }
    const invalidItem = items.some((item) => {
      if (!item || typeof item !== "object") return true;
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      return !item.name || String(item.name).length > 255 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 99 ||
        !Number.isFinite(price) || price < 0;
    });
    if (invalidItem) {
      return res.status(400).json({ message: "Oda ina bidhaa au idadi isiyo sahihi" });
    }
    const cleanItems = items.map((item) => ({
        id: item.id,
        name: String(item.name),
        category: String(item.category || ""),
        price: Number(item.price),
        quantity: Number(item.quantity),
        image: String(item.image || ""),
      }));

    const numericSubtotal = Number(subtotal);
    const numericFee = Number(fee);
    const numericTotal = Number(total);
    if (
      !Number.isFinite(numericSubtotal) ||
      !Number.isFinite(numericFee) ||
      !Number.isFinite(numericTotal) ||
      numericSubtotal < 0 ||
      numericFee < 0 ||
      numericTotal !== numericSubtotal + numericFee ||
      cleanItems.reduce((sum, item) => sum + item.price * item.quantity, 0) !== numericSubtotal
    ) {
      return res.status(400).json({ message: "Jumla ya malipo si sahihi" });
    }

    const [users] = await db.query(
      "SELECT id, full_name, email, phone, address FROM users WHERE id = ?",
      [req.user.id]
    );
    if (users.length === 0) {
      return res.status(401).json({ message: "Akaunti haijapatikana" });
    }

    const method = String(paymentMethod || "");
    const manualMobileMoneyMethods = [
      "Tigo Pesa (Manual)",
      "M-Pesa (Manual)",
      "Airtel Money (Manual)",
      "Halo Pesa (Manual)",
    ];
    const isManualMobileMoney = manualMobileMoneyMethods.includes(method);
    if (!isManualMobileMoney && method !== "Lipa Baadaye (Cash on Delivery)") {
      return res.status(400).json({ message: "Njia hii ya malipo haipatikani kwa sasa" });
    }
    const reference = String(paymentReference).trim();
    if (
      isManualMobileMoney &&
      !/^[A-Z0-9-]{6,40}$/i.test(reference)
    ) {
      return res.status(400).json({ message: "Weka transaction ID sahihi ya Tigo Pesa" });
    }

    const customer = users[0];
    const orderCode = `ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const paymentStatus = isManualMobileMoney
      ? "Pending Verification"
      : "Pending (Cash)";
    let result;
    try {
      [result] = await db.query(
        `INSERT INTO orders
       (order_code, customer_id, customer_name, customer_username, customer_phone,
        customer_address, category, status, payment_method, payment_phone,
        payment_status, payment_reference, items, subtotal, fee, total, special_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderCode,
          customer.id,
          customer.full_name,
          `@${customer.email.split("@")[0]}`,
          paymentPhone || customer.phone || "",
          customer.address || "",
          cleanItems[0].category || "Foods",
          method,
          paymentPhone,
          paymentStatus,
          isManualMobileMoney ? reference.toUpperCase() : null,
          JSON.stringify(cleanItems),
          numericSubtotal,
          numericFee,
          numericTotal,
          String(specialNotes).slice(0, 1000),
        ]
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY" && isManualMobileMoney) {
        return res.status(409).json({ message: "Transaction ID hii imetumika tayari" });
      }
      throw error;
    }

    const [rows] = await db.query(`${orderSelect} WHERE o.id = ?`, [result.insertId]);
    res.status(201).json(normalizeOrder(rows[0]));
  } catch (error) {
    console.error("Error creating order:", error.message);
    res.status(500).json({ message: "Imeshindikana kuunda oda" });
  }
};

export const confirmPayment = async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT id, payment_status, payment_reference, payment_method FROM orders WHERE order_code = ?",
      [req.params.id]
    );
    const order = orders[0];
    if (!order) return res.status(404).json({ message: "Oda haijapatikana" });
    const isMobilePayment =
      order.payment_status === "Pending Verification" &&
      Boolean(order.payment_reference);
    const isCashOnDelivery =
      order.payment_status === "Pending (Cash)" &&
      order.payment_method === "Lipa Baadaye (Cash on Delivery)";
    if (!isMobilePayment && !isCashOnDelivery) {
      return res.status(409).json({ message: "Oda hii haina malipo yanayosubiri uthibitisho" });
    }

    const [result] = await db.query(
      `UPDATE orders
       SET payment_status = 'Paid', payment_verified_by = ?, payment_verified_at = CURRENT_TIMESTAMP
       WHERE id = ? AND payment_status = ?`,
      [req.user.id, order.id, order.payment_status]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ message: "Malipo ya oda hii tayari yamethibitishwa" });
    }
    const [updated] = await db.query(`${orderSelect} WHERE o.id = ?`, [order.id]);
    res.json(normalizeOrder(updated[0]));
  } catch (error) {
    console.error("Error confirming payment:", error.message);
    res.status(500).json({ message: "Imeshindikana kuthibitisha malipo" });
  }
};

export const rejectPayment = async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT id, payment_status, payment_reference, payment_method FROM orders WHERE order_code = ?",
      [req.params.id]
    );
    const order = orders[0];
    if (!order) return res.status(404).json({ message: "Oda haijapatikana" });
    const isMobilePayment =
      order.payment_status === "Pending Verification" &&
      Boolean(order.payment_reference);
    const isCashOnDelivery =
      order.payment_status === "Pending (Cash)" &&
      order.payment_method === "Lipa Baadaye (Cash on Delivery)";
    if (!isMobilePayment && !isCashOnDelivery) {
      return res.status(409).json({ message: "Oda hii haina malipo yanayosubiri uamuzi" });
    }

    const [result] = await db.query(
      `UPDATE orders
       SET payment_status = 'Rejected', payment_rejected_by = ?, payment_rejected_at = CURRENT_TIMESTAMP
       WHERE id = ? AND payment_status = ?`,
      [req.user.id, order.id, order.payment_status]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ message: "Malipo ya oda hii tayari yamefanyiwa uamuzi" });
    }
    const [updated] = await db.query(`${orderSelect} WHERE o.id = ?`, [order.id]);
    res.json(normalizeOrder(updated[0]));
  } catch (error) {
    console.error("Error rejecting payment:", error.message);
    res.status(500).json({ message: "Imeshindikana kukataa malipo" });
  }
};

export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, specialNotes } = req.body;
    const [matches] = await db.query("SELECT * FROM orders WHERE order_code = ?", [id]);
    const order = matches[0];
    if (!order) return res.status(404).json({ message: "Oda haijapatikana" });

    if (req.user.role === "customer") {
      if (Number(order.customer_id) !== Number(req.user.id)) {
        return res.status(403).json({ message: "Huruhusiwi kubadilisha oda hii" });
      }

      if (status === "Received") {
        if (order.status !== "Delivered") {
          return res.status(409).json({ message: "Unaweza kuthibitisha kupokea oda baada ya kukabidhiwa" });
        }
        const [result] = await db.query(
          "UPDATE orders SET status = 'Received' WHERE id = ? AND status = 'Delivered'",
          [order.id]
        );
        if (result.affectedRows === 0) {
          return res.status(409).json({ message: "Oda hii tayari imesasishwa" });
        }
      } else {
        if (order.status !== "Pending" || (status !== undefined && status !== "Pending")) {
          return res.status(403).json({ message: "Huruhusiwi kubadilisha oda hii" });
        }
        await db.query(
          "UPDATE orders SET special_notes = ? WHERE id = ? AND status = 'Pending'",
          [String(specialNotes ?? order.special_notes).slice(0, 1000), order.id]
        );
      }
    } else if (req.user.role === "delivery") {
      if (
        Number(order.assigned_to) !== Number(req.user.id) ||
        !["Out for Delivery", "Delivered"].includes(status)
      ) {
        return res.status(403).json({ message: "Huruhusiwi kubadilisha oda hii" });
      }
      await db.query("UPDATE orders SET status = ? WHERE id = ?", [status, order.id]);
    } else if (req.user.role === "admin") {
      const allowedStatuses = ["Pending", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
      if (status !== undefined && !allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Hali ya oda si sahihi" });
      }
      if (
        status &&
        !["Pending", "Cancelled"].includes(status) &&
        order.payment_status !== "Paid"
      ) {
        return res.status(409).json({ message: "Thibitisha malipo kabla ya kuanza kuandaa oda" });
      }
      await db.query(
        "UPDATE orders SET status = COALESCE(?, status), special_notes = COALESCE(?, special_notes) WHERE id = ?",
        [status ?? null, specialNotes === undefined ? null : String(specialNotes).slice(0, 1000), order.id]
      );
    } else {
      return res.status(403).json({ message: "Huruhusiwi kubadilisha oda" });
    }

    const [rows] = await db.query(`${orderSelect} WHERE o.id = ?`, [order.id]);
    res.json(normalizeOrder(rows[0]));
  } catch (error) {
    console.error("Error updating order:", error.message);
    res.status(500).json({ message: "Imeshindikana kusasisha oda" });
  }
};

export const assignOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = Number(req.body.staffId);
    if (!Number.isInteger(staffId) || staffId < 1) {
      return res.status(400).json({ message: "Chagua mfanyakazi sahihi" });
    }

    const [orders] = await db.query("SELECT id FROM orders WHERE order_code = ?", [id]);
    if (orders.length === 0) return res.status(404).json({ message: "Oda haijapatikana" });

    const [payment] = await db.query(
      "SELECT payment_status FROM orders WHERE id = ?",
      [orders[0].id]
    );
    if (payment[0].payment_status !== "Paid") {
      return res.status(409).json({ message: "Thibitisha malipo kabla ya kugawa oda" });
    }

    const [staff] = await db.query("SELECT id FROM users WHERE id = ? AND role = 'delivery'", [staffId]);
    if (staff.length === 0) return res.status(404).json({ message: "Delivery staff hajapatikana" });

    await db.query(
      "UPDATE orders SET assigned_to = ?, status = 'Out for Delivery' WHERE id = ?",
      [staffId, orders[0].id]
    );
    const [updated] = await db.query(`${orderSelect} WHERE o.id = ?`, [orders[0].id]);
    res.json(normalizeOrder(updated[0]));
  } catch (error) {
    console.error("Error assigning order:", error.message);
    res.status(500).json({ message: "Imeshindikana kumpa oda delivery staff" });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT id, status FROM orders WHERE order_code = ?",
      [req.params.id]
    );
    if (orders.length === 0) {
      return res.status(404).json({ message: "Oda haijapatikana" });
    }
    if (orders[0].status !== "Received") {
      return res.status(409).json({ message: "Oda inaweza kufutwa baada ya mteja kuthibitisha kuwa ameipokea" });
    }
    const [result] = await db.query(
      "DELETE FROM orders WHERE id = ? AND status = 'Received'",
      [orders[0].id]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ message: "Hali ya oda imebadilika; ionyeshe upya kisha ujaribu tena" });
    }
    res.status(204).end();
  } catch (error) {
    console.error("Error deleting order:", error.message);
    res.status(500).json({ message: "Imeshindikana kufuta oda" });
  }
};
