import web_webview from '@ohos.web.webview';
import router from '@ohos.router';
import { NativeBridgeProxy, BridgeMessage, BridgeSender } from '../bridge/ExperimentBridge';

/**
 * 3D 实验台（V2 版）：原生标题栏 + WebView 宿主。
 * WebView 内为完整 Vue 实验台（时间控制/虚拟仪器/考核/题库/AI 助教等 V2 全量能力），
 * 原生通过 window.__hosBoot(experimentId, title) 注入当前实验。
 */
@Entry
@Component
struct ExperimentPage {
  @State engineReady: boolean = false;
  @State engineStatus: string = '引擎加载中…';
  private experimentId: string = 'w1.demo';
  private experimentTitle: string = '实验台';
  private webController: web_webview.WebviewController = new web_webview.WebviewController();
  private nativeBridge: NativeBridgeProxy = new NativeBridgeProxy();
  private sender: BridgeSender = new BridgeSender();
  private pageLoaded: boolean = false;

  aboutToAppear(): void {
    const params: object = router.getParams() as object;
    if (params !== undefined && params !== null) {
      const rec: Record<string, Object> = params as Record<string, Object>;
      if (rec['experimentId'] !== undefined) {
        this.experimentId = rec['experimentId'] as string;
      }
      if (rec['title'] !== undefined) {
        this.experimentTitle = rec['title'] as string;
      }
    }

    // JS -> 原生 消息分发
    this.nativeBridge.setListener((msg: string) => {
      const m: BridgeMessage | undefined = BridgeMessage.parse(msg);
      if (m === undefined) {
        return;
      }
      this.handleJsMessage(m);
    });
  }

  private handleJsMessage(m: BridgeMessage): void {
    if (m.type === 'engine.ready') {
      this.engineReady = true;
      this.engineStatus = 'V2 引擎就绪 · 全功能实验台';
    } else if (m.type === 'nav.back') {
      router.back();
    } else if (m.type === 'error') {
      this.engineStatus = `引擎消息错误: ${JSON.stringify(m.payload)}`;
    }
  }

  /** 原生 -> JS */
  private send(type: string, payload: Record<string, Object>): void {
    if (!this.pageLoaded) {
      return;
    }
    const script: string = this.sender.toScript(type, payload);
    try {
      this.webController.runJavaScript(script);
    } catch (e) {
      console.error(`[bridge] runJavaScript error: ${JSON.stringify(e)}`);
    }
  }

  /** 注入当前实验（V2 Web Bundle 的启动接口） */
  private bootExperiment(): void {
    const id: string = this.experimentId;
    const title: string = this.experimentTitle;
    const script: string =
      `window.__hosBoot && window.__hosBoot('${id}', '${title}')`;
    try {
      this.webController.runJavaScript(script);
    } catch (e) {
      console.error(`[bridge] boot error: ${JSON.stringify(e)}`);
    }
  }

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Text('‹')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor('#333333')
          .width(32)
          .onClick(() => {
            router.back();
          })
        Text(this.experimentTitle)
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ left: 4 })
        Text(this.engineReady ? 'V2' : '…')
          .fontSize(12)
          .fontColor('#3f8f79')
          .margin({ right: 8 })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#f5f6f8')

      // V2 全功能实验台（WebView 全屏承载）
      Column() {
        // r5：同步渲染模式——Web 内容与 ArkUI 同帧绘制。
        // 默认 ASYNC_RENDER 异步模式下 WebGL 高负载时送显 buffer 与宿主合成失配 → 黑屏/闪烁（官方已知问题）。
        Web({ src: $rawfile('web/hos.html'), controller: this.webController, renderMode: RenderMode.SYNC_RENDER })
          .onPageEnd(() => {
            this.pageLoaded = true;
            this.bootExperiment();
          })
          .javaScriptProxy({
            object: this.nativeBridge,
            name: 'nativeBridge',
            methodList: ['onMessage'],
            controller: this.webController
          })
          .domStorageAccess(true)
          .zoomAccess(false)
          .fileAccess(true)
          .backgroundColor('#1a2430')
      }
      .layoutWeight(1)
      .width('100%')

      // 底部状态条
      Text(this.engineStatus)
        .fontSize(10)
        .fontColor('#999999')
        .width('100%')
        .textAlign(TextAlign.Center)
        .padding({ top: 4, bottom: 6 })
        .backgroundColor('#f5f6f8')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#ffffff')
  }
}
