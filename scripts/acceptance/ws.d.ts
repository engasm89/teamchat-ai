declare module "ws" {
  import {EventEmitter} from "node:events";
  export default class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(url: string, options?: {origin?: string; headers?: Record<string, string>});
    send(data: string): void;
    close(code?: number, reason?: string): void;
  }
}
