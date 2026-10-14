/**
 * ArkTS <-> JS 双向桥。
 * 协议：JSON 消息 { msgId, type, payload }，双向均带 msgId 用于应答关联。
 *
 * 原生 -> JS : webController.runJavaScript("window.__engine.onMessage('<json>')")
 * JS -> 原生 : javaScriptProxy 注入的 nativeBridge.onMessage('<json>')
 */

export class NativeBridgeProxy {
  private listener: (msg: string) => void = (_msg: string) => {
  };

  constructor() {
  }

  /** JS 侧调用入口（methodList 注册名） */
  onMessage(msg: string): void {
    this.listener(msg);
  }

  setListener(l: (msg: string) => void): void {
    this.listener = l;
  }
}

export class BridgeMessage {
  msgId: string = '';
  type: string = '';
  payload: Record<string, Object> = {};

  static parse(json: string): BridgeMessage | undefined {
    try {
      const obj: Record<string, Object> = JSON.parse(json) as Record<string, Object>;
      const m: BridgeMessage = new BridgeMessage();
      if (obj['msgId'] !== undefined) {
        m.msgId = obj['msgId'] as string;
      }
      if (obj['type'] !== undefined) {
        m.type = obj['type'] as string;
      }
      if (obj['payload'] !== undefined) {
        m.payload = obj['payload'] as Record<string, Object>;
      }
      return m;
    } catch (e) {
      console.error(`[bridge] parse error: ${JSON.stringify(e)}`);
      return undefined;
    }
  }
}

export class BridgeSender {
  private seq: number = 0;

  makeMessage(type: string, payload: Record<string, Object>): string {
    this.seq += 1;
    return JSON.stringify({
      msgId: `native-${this.seq}`,
      type: type,
      payload: payload
    });
  }

  /** 包裹为可执行的 JS 片段（消息体为 JSON，不含单引号，可安全嵌入单引号字符串） */
  toScript(type: string, payload: Record<string, Object>): string {
    const msg: string = this.makeMessage(type, payload);
    return `window.__engine && window.__engine.onMessage('${msg}')`;
  }
}
