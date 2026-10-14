import router from '@ohos.router';
import { ExperimentRepository, SubjectInfo, ExperimentInfo } from '../model/ExperimentData';

/**
 * 实验室列表：按学科展示实验，点击进入 3D 实验台。
 */
@Entry
@Component
struct LabListPage {
  @State subject: string = 'physics';
  @State subjectLabel: string = '物理';
  private experiments: ExperimentInfo[] = [];

  aboutToAppear(): void {
    const params: object = router.getParams() as object;
    if (params !== undefined && params !== null) {
      const rec: Record<string, Object> = params as Record<string, Object>;
      if (rec['subject'] !== undefined) {
        this.subject = rec['subject'] as string;
      }
    }
    const subjects: SubjectInfo[] = ExperimentRepository.getSubjects();
    for (const s of subjects) {
      if (s.key === this.subject) {
        this.subjectLabel = s.label;
      }
    }
    this.experiments = ExperimentRepository.getExperiments(this.subject);
  }

  private difficultyLabel(d: number): string {
    if (d <= 1) {
      return '基础';
    }
    if (d === 2) {
      return '进阶';
    }
    return '挑战';
  }

  build() {
    Column() {
      // 标题栏
      Row() {
        Text('‹')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor('#333333')
          .width(32)
          .onClick(() => {
            router.back();
          })
        Text(`${this.subjectLabel}实验室`)
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .margin({ left: 4 })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#f5f6f8')

      List({ space: 8 }) {
        ForEach(this.experiments, (exp: ExperimentInfo) => {
          ListItem() {
            Row() {
              Column({ space: 4 }) {
                Text(exp.title)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(exp.available ? '#222222' : '#999999')
                Text(`难度 ${this.difficultyLabel(exp.difficulty)} · ${exp.wave} 上线`)
                  .fontSize(12)
                  .fontColor('#aaaaaa')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              if (exp.available) {
                Text('开始')
                  .fontSize(13)
                  .fontColor('#ffffff')
                  .backgroundColor('#3f8f79')
                  .borderRadius(14)
                  .padding({ left: 14, right: 14, top: 6, bottom: 6 })
              } else {
                Text('敬请期待')
                  .fontSize(12)
                  .fontColor('#bbbbbb')
                  .borderRadius(14)
                  .border({ width: 1, color: '#dddddd' })
                  .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              }
            }
            .width('100%')
            .padding(12)
            .backgroundColor('#ffffff')
            .borderRadius(12)
            .onClick(() => {
              if (exp.available) {
                const p: Record<string, Object> = {
                  'experimentId': exp.id,
                  'title': exp.title
                };
                router.pushUrl({
                  url: 'pages/ExperimentPage',
                  params: p
                });
              }
            })
          }
        }, (exp: ExperimentInfo) => exp.id)
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ top: 8, bottom: 8, left: 12, right: 12 })
      .backgroundColor('#f2f3f5')
    }
    .width('100%')
    .height('100%')
  }
}
