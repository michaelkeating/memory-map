import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { ChatMessage } from "@memory-map/shared";

export class ChatStore {
  constructor(private db: Database.Database) {}

  save(msg: Omit<ChatMessage, "id">): ChatMessage {
    const id = ulid();
    const full: ChatMessage = { id, ...msg };
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, role, content, graph_delta, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, msg.role, msg.content, JSON.stringify(msg.graphDelta ?? null), msg.timestamp);
    return full;
  }

  getRecent(limit = 20): ChatMessage[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit) as any[];

    return rows.reverse().map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: r.created_at,
      graphDelta: r.graph_delta ? JSON.parse(r.graph_delta) : undefined,
    }));
  }
}
