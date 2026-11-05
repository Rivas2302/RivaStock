import WebSocket from 'ws';

const RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;
const HEARTBEAT_INTERVAL_MS = 25_000;

export function realtimeEventsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function parseWakeMessage(value: unknown): { type: string; source?: string } | null {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (text.length > 512) return null;
  try {
    const message: unknown = JSON.parse(text);
    if (!isRecord(message) || typeof message.type !== 'string') return null;
    if (message.type === 'wake') {
      return {
        type: 'wake',
        ...(typeof message.source === 'string' && message.source.length <= 80 ? { source: message.source } : {}),
      };
    }
    if (message.type === 'ready' || message.type === 'ping' || message.type === 'pong' || message.type === 'degraded') {
      return { type: message.type };
    }
    return null;
  } catch {
    return null;
  }
}

export class RealtimeWakeChannel {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectStep = 0;
  private stopped = false;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly workerId: string,
    private readonly onWake: (source?: string) => void,
  ) {}

  start(): void {
    if (this.stopped || this.socket || this.reconnectTimer) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.socket?.close(1000, 'Bridge stopping');
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(realtimeEventsUrl(this.endpoint), {
      handshakeTimeout: 10_000,
      maxPayload: 512,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'x-rivastock-worker-id': this.workerId,
      },
    });
    this.socket = socket;

    socket.on('open', () => {
      this.heartbeatTimer = setInterval(() => this.send('ping'), HEARTBEAT_INTERVAL_MS);
    });
    socket.on('message', (data) => {
      const message = parseWakeMessage(data);
      if (!message) {
        socket.close(1008, 'Invalid wake message');
        return;
      }
      if (message.type === 'wake') this.onWake(message.source);
      if (message.type === 'ready') this.reconnectStep = 0;
      if (message.type === 'ping') this.send('pong');
      if (message.type === 'degraded') socket.close(1013, 'Realtime unavailable');
    });
    socket.on('close', () => this.handleClose(socket));
    socket.on('error', () => socket.close());
  }

  private send(type: 'ping' | 'pong'): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type }));
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.stopped) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectStep, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectStep = Math.min(this.reconnectStep + 1, RECONNECT_DELAYS_MS.length - 1);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
