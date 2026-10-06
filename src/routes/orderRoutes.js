import { Router } from "express";
import {
  assignOrder,
  createOrder,
  confirmPayment,
  rejectPayment,
  deleteOrder,
  getOrders,
  updateOrder,
} from "../controllers/orderController.js";

export default function orderRoutes(requireRole) {
  const router = Router();

  router.get("/", requireRole("admin", "customer", "delivery"), getOrders);
  router.post("/", requireRole("customer"), createOrder);
  router.put("/:id/payment-confirmation", requireRole("admin"), confirmPayment);
  router.put("/:id/payment-rejection", requireRole("admin"), rejectPayment);
  router.put("/:id", requireRole("admin", "customer", "delivery"), updateOrder);
  router.put("/:id/assign", requireRole("admin"), assignOrder);
  router.delete("/:id", requireRole("admin"), deleteOrder);

  return router;
}
