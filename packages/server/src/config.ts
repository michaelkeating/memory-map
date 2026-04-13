import { config as loadDotenv } from "dotenv";
import path from "node:path";

// Load .env from project root (two levels up from packages/server)
loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};

export function getPagesDir(): string {
  return path.join(config.dataDir, "pages");
}

export function getDbPath(): string {
  return path.join(config.dataDir, "memory-map.db");
}
