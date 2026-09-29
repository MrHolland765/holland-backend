import { readFile } from "node:fs/promises";
import db from "../db.js";

const menuFile = new URL("../../data/menuAdditions.json", import.meta.url);
const restoreImagesFile = new URL("../../data/menuImageRestore.json", import.meta.url);

export const seedMenu = async () => {
  const menu = JSON.parse(await readFile(menuFile, "utf8"));
  const imageRestores = JSON.parse(await readFile(restoreImagesFile, "utf8"));
  const connection = await db.getConnection();

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_seed_log (
        item_name VARCHAR(255) NOT NULL PRIMARY KEY,
        seeded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_migration_log (
        migration_key VARCHAR(100) NOT NULL PRIMARY KEY,
        migrated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.beginTransaction();

    for (const item of menu) {
      const [seeded] = await connection.query(
        "SELECT item_name FROM menu_seed_log WHERE item_name = ?",
        [item.name]
      );
      if (seeded.length > 0) continue;

      const productNames = [item.name, ...(item.aliases || [])];
      const placeholders = productNames.map(() => "LOWER(?)").join(", ");
      const [existing] = await connection.query(
        `SELECT id FROM products WHERE LOWER(name) IN (${placeholders}) LIMIT 1 FOR UPDATE`,
        productNames
      );

      if (existing.length > 0) {
        await connection.query(
          `UPDATE products
           SET name = ?, description = ?, price = ?, image = ?, category = ?, prep_time = ?
           WHERE id = ?`,
          [
            item.name,
            item.description,
            item.price,
            item.image,
            item.category,
            item.prep_time,
            existing[0].id,
          ]
        );
      } else {
        await connection.query(
          `INSERT INTO products
           (name, description, price, image, category, prep_time, available)
           VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
          [
            item.name,
            item.description,
            item.price,
            item.image,
            item.category,
            item.prep_time,
          ]
        );
      }

      await connection.query(
        "INSERT INTO menu_seed_log (item_name) VALUES (?)",
        [item.name]
      );
    }

    const migrationKey = "restore-original-menu-photos-2026-09";
    const [completedMigration] = await connection.query(
      "SELECT migration_key FROM menu_migration_log WHERE migration_key = ?",
      [migrationKey]
    );
    if (completedMigration.length === 0) {
      for (const item of imageRestores) {
        await connection.query(
          `UPDATE products SET image = ?
           WHERE LOWER(name) = LOWER(?) AND image IN (
             '/menu/forodhani-vendor.jpg',
             '/menu/forodhani-food-market.jpg',
             '/menu/zanzibar-mix-juice.jpg'
           )`,
          [item.image, item.name]
        );
      }
      await connection.query(
        "INSERT INTO menu_migration_log (migration_key) VALUES (?)",
        [migrationKey]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
