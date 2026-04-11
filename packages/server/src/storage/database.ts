import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbPath, config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(): Database.Database {
  // Ensure data directory exists
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "pages"), { recursive: true });

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run schema
  const schema = fs.readFileSync(
    path.join(__dirname, "schema.sql"),
    "utf-8"
  );
  db.exec(schema);

  // Migrations for existing databases (CREATE TABLE IF NOT EXISTS doesn't
  // add new columns to existing tables)
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database) {
  // memory_sources.blocked
  if (!hasColumn(db, "memory_sources", "blocked")) {
    db.exec(
      "ALTER TABLE memory_sources ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0"
    );
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((r) => r.name === column);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
