import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv();

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  apiKey: process.env.API_KEY ?? "dev",
  passphrase: process.env.PASSPHRASE ?? "dev",
  sessionSecret: process.env.SESSION_SECRET ?? "memory-map-dev-secret",
};

export function getPagesDir(): string {
  return path.join(config.dataDir, "pages");
}

export function getDbPath(): string {
  return path.join(config.dataDir, "memory-map.db");
}
