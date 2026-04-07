import type { WSEvent } from "@memory-map/shared";

interface WSClient {
  readyState: number;
  send(data: string): void;
  on(event: string, listener: () => void): void;
}

export class WebSocketHub {
  private clients = new Set<WSClient>();

  register(ws: WSClient): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  broadcast(event: WSEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
