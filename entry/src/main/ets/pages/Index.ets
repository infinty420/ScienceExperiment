import router from '@ohos.router';
import { ExperimentRepository, SubjectInfo } from '../model/ExperimentData';

/**
 * 首页：三 Tab（首页 / 分类 / 我的）。
 */
@Entry
@Component
struct Index {
  @State currentIndex: number = 0;
  private subjects: SubjectInfo[] = ExperimentRepository.getSubjects();

  private openLab(subject: string): void {
    const p: Record<string, Object> = { 'subject': subject };
    router.pushUrl({
      url: 'pages/LabListPage',
      params: p
    });
  }

  private openDemo(): void {
    const p: Record<string, Object> = { 'experimentId': 'w1.demo', 'title': 'W1 桥接验证 · 3D 实验台' };
    router.pushUrl({
      url: 'pages/ExperimentPage',
      params: p
    });
  }

  @Builder
  homePage() {
    Scroll() {
      Column({ space: 16 }) {
        // 头部
        Column({ space: 4 }) {
          Text('智实验 SciLab')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#222222')
          Text('理科 3D 虚拟实验室 · 物理 / 化学 / 生物 / 大学')
            .fontSize(13)
            .fontColor('#888888')
        }
        .width('100%')
        .margin({ top: 24 })

        // W1 渲染验证入口
        Row({ space: 10 }) {
          Text('▶')
            .fontSize(18)
            .fontColor('#3f8f79')
          Column({ space: 2 }) {
            Text('W1 渲染管线验证')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor('#222222')
            Text('3D 实验台 · 桥接联调演示')
              .fontSize(12)
              .fontColor('#999999')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('进入')
            .fontSize(13)
            .fontColor('#3f8f79')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#eaf5f0')
        .borderRadius(12)
        .onClick(() => {
          this.openDemo();
        })

        // 学科入口
        Text('学科实验室')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#333333')
          .width('100%')
        Grid() {
          ForEach(this.subjects, (s: SubjectInfo) => {
            GridItem() {
              Column({ space: 8 }) {
                Text(s.emoji)
                  .fontSize(34)
                Text(s.label)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#333333')
                Text(`${s.count} 个实验`)
                  .fontSize(12)
                  .fontColor('#999999')
              }
              .width('100%')
              .padding({ top: 18, bottom: 18 })
              .backgroundColor('#ffffff')
              .borderRadius(14)
              .onClick(() => {
                this.openLab(s.key);
              })
            }
          }, (s: SubjectInfo) => s.key)
        }
        .columnsTemplate('1fr 1fr')
        .columnsGap(10)
        .rowsGap(10)
        .width('100%')
        .height(340)

        // 版本信息
        Text('V2 · 26 个实验 · 九大教学模块 · 全程离线')
          .fontSize(11)
          .fontColor('#bbbbbb')
          .margin({ bottom: 20 })
      }
      .padding({ left: 16, right: 16 })
      .alignItems(HorizontalAlign.Start)
    }
    .scrollBar(BarState.Off)
    .width('100%')
    .height('100%')
    .backgroundColor('#f2f3f5')
    .align(Alignment.Top)
  }

  @Builder
  categoryPage() {
    Column({ space: 0 }) {
      Text('分类')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .margin({ top: 20, bottom: 12 })
        .padding({ left: 16 })
      List({ space: 10 }) {
        ForEach(this.subjects, (s: SubjectInfo) => {
          ListItem() {
            Row({ space: 12 }) {
              Text(s.emoji)
                .fontSize(26)
              Column({ space: 2 }) {
                Text(s.label)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#333333')
                Text(`${s.count} 个实验 · 3D 交互`)
                  .fontSize(12)
                  .fontColor('#999999')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text('›')
                .fontSize(20)
                .fontColor('#cccccc')
            }
            .width('100%')
            .padding(14)
            .backgroundColor('#ffffff')
            .borderRadius(12)
            .onClick(() => {
              this.openLab(s.key);
            })
          }
        }, (s: SubjectInfo) => s.key)
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ left: 16, right: 16 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f2f3f5')
  }

  @Builder
  minePage() {
    Column({ space: 0 }) {
      Text('我的')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .margin({ top: 20, bottom: 12 })
        .padding({ left: 16 })
      Column({ space: 10 }) {
        Row() {
          Text('我的成绩')
            .fontSize(15)
            .fontColor('#333333')
            .layoutWeight(1)
          Text('成绩在实验内考核模式中记录')
            .fontSize(12)
            .fontColor('#bbbbbb')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)

        Row() {
          Text('实验报告')
            .fontSize(15)
            .fontColor('#333333')
            .layoutWeight(1)
          Text('实验台内导出 HTML 报告')
            .fontSize(12)
            .fontColor('#bbbbbb')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)

        Row() {
          Text('AI 助教')
            .fontSize(15)
            .fontColor('#333333')
            .layoutWeight(1)
          Text('实验台内 · 答疑/步骤/诊断')
            .fontSize(12)
            .fontColor('#bbbbbb')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)

        Row() {
          Text('设置')
            .fontSize(15)
            .fontColor('#333333')
            .layoutWeight(1)
          Text('›')
            .fontSize(20)
            .fontColor('#cccccc')
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)
        .onClick(() => {
          router.pushUrl({ url: 'pages/SettingsPage' });
        })
      }
      .padding({ left: 16, right: 16 })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f2f3f5')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Tabs({
      barPosition: BarPosition.End,
      index: this.currentIndex
    }) {
      TabContent() {
        this.homePage()
      }
      .tabBar('首页')

      TabContent() {
        this.categoryPage()
      }
      .tabBar('分类')

      TabContent() {
        this.minePage()
      }
      .tabBar('我的')
    }
    .scrollable(true)
    .barHeight(56)
    .onChange((index: number) => {
      this.currentIndex = index;
    })
    .width('100%')
    .height('100%')
  }
}
