import web_webview from '@ohos.web.webview';
import router from '@ohos.router';
import { NativeBridgeProxy, BridgeMessage, BridgeSender } from '../bridge/ExperimentBridge';
import { ExperimentRepository } from '../model/ExperimentData';

/**
 * 3D 实验台：原生工具栏 + WebView 宿主（W1 渲染管线验证版）。
 * W2 起接入实验包加载器，按 experimentId 加载 scene.json。
 */
@Entry
@Component
struct ExperimentPage {
  @State engineReady: boolean = false;
  @State engineStatus: string = '引擎加载中…';
  @State fpsValue: number = 0;
  @State spinning: boolean = true;
  @State wireframe: boolean = false;
  @State spinSpeed: number = 1.0;
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
    if (this.experimentId === 'w1.demo') {
      this.experimentTitle = 'W1 桥接验证 · 3D 实验台';
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
      const three: Object | undefined = m.payload['three'];
      this.engineStatus = `引擎就绪 (three r${three !== undefined ? three.toString() : '?'})`;
      // 页面就绪后同步一次当前控制状态
      this.send('scene.spin', { 'on': this.spinning });
      this.send('scene.speed', { 'value': this.spinSpeed });
    } else if (m.type === 'fps') {
      const f: Object | undefined = m.payload['fps'];
      if (f !== undefined) {
        this.fpsValue = Number(f.toString());
      }
    } else if (m.type === 'scene.state') {
      const speed: Object | undefined = m.payload['speed'];
      if (speed !== undefined) {
        this.spinSpeed = Number(speed.toString());
      }
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

  private toggleSpin(): void {
    this.spinning = !this.spinning;
    this.send('scene.spin', { 'on': this.spinning });
  }

  private toggleWireframe(): void {
    this.wireframe = !this.wireframe;
    this.send('scene.wireframe', { 'on': this.wireframe });
  }

  private resetScene(): void {
    this.spinning = true;
    this.wireframe = false;
    this.spinSpeed = 1.0;
    this.send('scene.reset', {});
  }

  private speedChange(value: number): void {
    this.spinSpeed = value;
    this.send('scene.speed', { 'value': value });
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
        Text(this.engineReady ? `${this.fpsValue} FPS` : '…')
          .fontSize(12)
          .fontColor('#3f8f79')
          .margin({ right: 8 })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#f5f6f8')

      // 3D 场景（WebView）
      Column() {
        Web({ src: $rawfile('web/index.html'), controller: this.webController })
          .onPageEnd(() => {
            this.pageLoaded = true;
            this.send('engine.init', { 'experimentId': this.experimentId });
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

      // 原生工具栏
      Column({ space: 8 }) {
        Text(this.engineStatus)
          .fontSize(11)
          .fontColor('#999999')
        Row({ space: 10 }) {
          Button(this.spinning ? '暂停' : '继续')
            .fontSize(14)
            .height(36)
            .backgroundColor('#3f8f79')
            .onClick(() => {
              this.toggleSpin();
            })
          Button('重置')
            .fontSize(14)
            .height(36)
            .backgroundColor('#4a6a8a')
            .onClick(() => {
              this.resetScene();
            })
          Button(this.wireframe ? '实体' : '线框')
            .fontSize(14)
            .height(36)
            .backgroundColor('#8a6a4a')
            .onClick(() => {
              this.toggleWireframe();
            })
        }

        Row({ space: 8 }) {
          Text('转速')
            .fontSize(13)
            .fontColor('#666666')
          Slider({
            value: this.spinSpeed,
            min: 0,
            max: 3,
            step: 0.1
          })
            .layoutWeight(1)
            .onChange((value: number, mode: SliderChangeMode) => {
              if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
                this.speedChange(value);
              }
            })
          Text(this.spinSpeed.toFixed(1))
            .fontSize(13)
            .fontColor('#3f8f79')
            .width(30)
        }
        .width('100%')
        .padding({ left: 12, right: 12 })
      }
      .width('100%')
      .padding({ top: 8, bottom: 12, left: 12, right: 12 })
      .backgroundColor('#f5f6f8')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#ffffff')
  }
}
