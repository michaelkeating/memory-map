import { useEffect, useRef } from "react";
import { useGraphStore } from "./useGraph.js";
import type { WSEvent } from "@memory-map/shared";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useGraphStore();

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg: WSEvent = JSON.parse(event.data);
        switch (msg.type) {
          case "graph:full":
            store.setGraph(msg.graph);
            break;
          case "page:created":
            store.addNode(msg.page);
            break;
          case "page:updated":
            store.updateNode(msg.page);
            break;
          case "association:created":
            store.addEdge(msg.association);
            break;
          case "association:updated":
            store.updateEdge(msg.association);
            break;
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
