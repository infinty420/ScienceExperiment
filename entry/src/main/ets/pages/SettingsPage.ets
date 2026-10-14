import router from '@ohos.router';

/**
 * 设置页（W1 占位，W6/W10 扩展画质选项与实验包管理）。
 */
@Entry
@Component
struct SettingsPage {
  @State highQuality: boolean = true;
  @State offlineMode: boolean = true;

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor('#333333')
          .width(32)
          .onClick(() => {
            router.back();
          })
        Text('设置')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .margin({ left: 4 })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#f5f6f8')

      Column({ space: 10 }) {
        Row() {
          Column({ space: 2 }) {
            Text('高画质模式')
              .fontSize(15)
              .fontColor('#333333')
            Text('阴影与后处理效果（低端设备建议关闭）')
              .fontSize(12)
              .fontColor('#999999')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.highQuality })
            .onChange((isOn: boolean) => {
              this.highQuality = isOn;
            })
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)

        Row() {
          Column({ space: 2 }) {
            Text('纯离线模式')
              .fontSize(15)
              .fontColor('#333333')
            Text('W1–W8 版本默认开启，不发起任何网络请求')
              .fontSize(12)
              .fontColor('#999999')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.offlineMode })
            .onChange((isOn: boolean) => {
              this.offlineMode = isOn;
            })
        }
        .width('100%')
        .padding(14)
        .backgroundColor('#ffffff')
        .borderRadius(12)

        Text('版本 0.1.0 (W1)')
          .fontSize(12)
          .fontColor('#bbbbbb')
          .margin({ top: 20 })
      }
      .width('100%')
      .padding(16)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f2f3f5')
  }
}
