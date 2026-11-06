import router from '@ohos.router';
import displaySync from '@ohos.graphics.displaySync';
import {
  Scene,
  Camera,
  Light,
  Geometry,
  LightType,
  EnvironmentBackgroundType,
  RenderingPipelineType,
  CubeGeometry,
  SphereGeometry
} from '@kit.ArkGraphics3D';

/**
 * 原生 Scene3D 渲染 PoC（第二阶段技术验证）。
 *
 * 目的：验证 ArkGraphics 3D（SceneKit）在本 SDK(API 24) 上的原生 3D 渲染能力、
 * 帧率（displaySync 实测，随屏幕刷新率自适应，请求 120Hz）与稳定性（无闪屏/白屏）。
 * 与 WebView+Three.js 引擎并存，互不影响；验证达标后再评估整体切换。
 *
 * 关键决策（均依据 SDK .d.ts 签名）：
 * - Component3D + ModelType.SURFACE：硬件合成 surface，性能最优（默认）。
 * - 相机 msaa:false + FORWARD_LIGHTWEIGHT 轻量前向管线：规避 MSAA 合成闪烁，降低渲染负载。
 * - environment BACKGROUND_NONE + camera.clearColor：显式背景色，杜绝黑屏/白屏。
 * - displaySync 每帧驱动旋转 + renderFrame(alwaysRender)：与 vsync 对齐，fps 即真实渲染帧率。
 * - aboutToDisappear 释放 displaySync 与 scene.destroy()：防资源泄漏与双 context 竞争。
 */
@Entry
@Component
struct Scene3dPocPage {
  @State sceneReady: boolean = false;
  @State fps: number = 0;
  @State statusText: string = '原生 Scene3D 初始化中…';

  private sceneOpt: SceneOptions = { modelType: ModelType.SURFACE };
  private scene: Scene | null = null;
  private cubeNode: Geometry | null = null;
  private sphereNode: Geometry | null = null;
  private ds: displaySync.DisplaySync | null = null;
  private angle: number = 0;
  private frameCount: number = 0;
  private fpsStart: number = 0;

  aboutToAppear(): void {
    this.initScene();
  }

  private async initScene(): Promise<void> {
    try {
      // 空场景（不传 uri → empty scene，程序化搭建，零外部模型依赖）
      const scene: Scene = await Scene.load();
      this.scene = scene;

      // 背景：NONE + 相机 clearColor，显式深色背景防黑/白屏
      scene.environment.backgroundType = EnvironmentBackgroundType.BACKGROUND_NONE;

      const factory = scene.getResourceFactory();

      // 相机：msaa 关闭 + 轻量前向管线（防闪烁、降负载）
      const camera: Camera = await factory.createCamera(
        { name: 'pocCamera' },
        { msaa: false, renderingPipeline: RenderingPipelineType.FORWARD_LIGHTWEIGHT }
      );
      camera.enabled = true;
      camera.fov = 60 * Math.PI / 180;
      // 默认朝向 -Z，置于 +Z 处即可平视原点，无需四元数定向
      camera.position = { x: 0, y: 1.2, z: 7 };
      camera.clearColor = { r: 0.10, g: 0.14, b: 0.19, a: 1.0 };

      // 方向光：默认照 -Z，从相机侧照亮场景
      const light: Light = await factory.createLight({ name: 'pocDirLight' }, LightType.DIRECTIONAL);
      light.enabled = true;
      light.color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
      light.intensity = 2.0;

      // 旋转立方体（左）
      const cubeDef = new CubeGeometry();
      cubeDef.size = { x: 1.4, y: 1.4, z: 1.4 };
      const cubeMesh = await factory.createMesh({ name: 'pocCubeMesh' }, cubeDef);
      this.cubeNode = await factory.createGeometry({ name: 'pocCube' }, cubeMesh);
      this.cubeNode.position = { x: -1.3, y: 0, z: 0 };

      // 球体（右，静参考）
      const sphDef = new SphereGeometry();
      sphDef.radius = 0.85;
      sphDef.segmentCount = 32;
      const sphMesh = await factory.createMesh({ name: 'pocSphereMesh' }, sphDef);
      this.sphereNode = await factory.createGeometry({ name: 'pocSphere' }, sphMesh);
      this.sphereNode.position = { x: 1.6, y: 0, z: 0 };

      // 场景装配完成后再挂载 Component3D，避免空场景首帧闪屏
      this.sceneOpt.scene = scene;
      this.sceneReady = true;
      this.statusText = '原生 Scene3D · SURFACE · 自适应刷新率';
      this.startDisplaySync();
    } catch (err) {
      this.statusText = `Scene3D 初始化失败: ${JSON.stringify(err)}`;
      console.error('[Scene3dPoc] init error: ' + JSON.stringify(err));
    }
  }

  private startDisplaySync(): void {
    this.ds = displaySync.create();
    try {
      // 请求高帧率：设备支持则跑 120Hz，不支持按能力自适应（稳定优先）
      this.ds.setExpectedFrameRateRange({ min: 30, max: 120, expected: 120 });
    } catch (e) {
      console.warn('[Scene3dPoc] setExpectedFrameRateRange unsupported: ' + JSON.stringify(e));
    }
    this.ds.on('frame', () => {
      // 绕 Y 轴旋转（四元数：(0, sin(θ/2), 0, cos(θ/2))）
      this.angle += 0.02;
      if (this.cubeNode) {
        const half = this.angle / 2;
        this.cubeNode.rotation = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
      }
      // 与 vsync 对齐驱动渲染
      this.scene?.renderFrame({ alwaysRender: true });
      // 帧率统计：displaySync 回调次数 = vsync 次数 = 实际渲染帧率
      this.frameCount++;
      const now = Date.now();
      if (now - this.fpsStart >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.fpsStart = now;
      }
    });
    this.fpsStart = Date.now();
    this.ds.start();
  }

  aboutToDisappear(): void {
    if (this.ds) {
      this.ds.off('frame');
      this.ds.stop();
      this.ds = null;
    }
    // 释放 native 场景资源，防泄漏与双 context 竞争
    if (this.scene) {
      this.scene.destroy();
      this.scene = null;
    }
    this.cubeNode = null;
    this.sphereNode = null;
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
        Text('原生 Scene3D · 渲染验证')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ left: 4 })
        Text(this.fps > 0 ? `${this.fps} FPS` : '…')
          .fontSize(14)
          .fontColor(this.fps >= 90 ? '#3f8f79' : '#b07a2e')
          .margin({ right: 8 })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#f5f6f8')

      // 原生 3D 渲染区
      if (this.sceneReady) {
        Component3D(this.sceneOpt)
          .renderWidth('100%')
          .renderHeight('100%')
          .width('100%')
          .layoutWeight(1)
      } else {
        Column() {
          Text(this.statusText)
            .fontSize(13)
            .fontColor('#9fb3c8')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#1a2430')
      }

      // 底部状态条
      Text(this.statusText + ' · 旋转立方体 = 持续渲染帧率')
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
