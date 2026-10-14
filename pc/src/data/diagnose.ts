/**
 * V2 AI 诊断式助教（T8）：操作事件流 → 规则引擎 → 诊断卡。
 * 从"被动答问"升级为"主动纠错"：命中规则即推送提示。
 */
import type { OpEvent, SceneDef } from '../experiments/types'

export interface Diagnosis {
  id: string
  level: 'error' | 'warn' | 'info'
  title: string
  tip: string
}

export interface DiagnoseContext {
  def: SceneDef
  events: OpEvent[]
  rows: number[][]
  paramValues: Record<string, number>
  /** 拟合 R²（最近一次拟合） */
  fitR2: number | null
}

interface Rule {
  id: string
  when(c: DiagnoseContext): boolean
  make(c: DiagnoseContext): Diagnosis
}

const RULES: Rule[] = [
  {
    id: 'pendulum-large-angle',
    when: (c) => {
      if (!c.def.id.includes('pendulum')) return false
      const ev = c.events.find((e) => e.type === 'param' && e.detail.includes('摆角'))
      return ev ? Number(ev.detail.match(/[\d.]+/)?.[0] ?? 0) > 15 : false
    },
    make: () => ({
      id: 'pendulum-large-angle',
      level: 'warn',
      title: '摆角过大，周期测量存在系统误差',
      tip: '单摆周期公式 T=2π√(L/g) 仅在小角度（<10°）时成立。请将摆角调至 5°–10° 重新测量。'
    })
  },
  {
    id: 'few-rows',
    when: (c) => c.rows.length > 0 && c.rows.length < 5 && c.events.some((e) => e.type === 'start'),
    make: () => ({
      id: 'few-rows',
      level: 'info',
      title: '数据组数偏少',
      tip: '数据少于 5 组时拟合结果不稳定（偶然误差影响大）。建议改变参数（如摆长/角度）多测几组。'
    })
  },
  {
    id: 'no-param-change',
    when: (c) => c.rows.length >= 3 && new Set(c.events.filter((e) => e.type === 'param').map((e) => e.detail)).size === 0,
    make: () => ({
      id: 'no-param-change',
      level: 'warn',
      title: '所有数据都在同一参数下测得',
      tip: '自变量没有变化，无法绘制有效曲线。请调整实验参数（滑杆）后重新测量，让自变量覆盖一段区间。'
    })
  },
  {
    id: 'low-r2',
    when: (c) => c.fitR2 !== null && c.fitR2 < 0.95,
    make: () => ({
      id: 'low-r2',
      level: 'info',
      title: '线性拟合优度偏低',
      tip: `R² = ${c.fitR2?.toFixed(3)}，数据点偏离直线较远。可能是误差累积或物理量并非线性关系，检查一下实验条件是否稳定。`
    })
  },
  {
    id: 'duplicate-rows',
    when: (c) => {
      if (c.rows.length < 2) return false
      const seen = new Set<string>()
      for (const r of c.rows) {
        const k = r.join(',')
        if (seen.has(k)) return true
        seen.add(k)
      }
      return false
    },
    make: () => ({
      id: 'duplicate-rows',
      level: 'error',
      title: '存在完全相同的重复数据行',
      tip: '两组完全相同的数据通常意味着未改变条件就重复记录，会人为"提高"拟合优度但无科学价值。请删除或重测。'
    })
  },
  {
    id: 'rapid-record',
    when: (c) => {
      const recs = c.events.filter((e) => e.type === 'record' || e.type === 'instrument')
      for (let i = 1; i < recs.length; i++) {
        if (recs[i].t - recs[i - 1].t < 0.4) return true
      }
      return false
    },
    make: () => ({
      id: 'rapid-record',
      level: 'warn',
      title: '数据记录间隔过短',
      tip: '连续快速记录的数据通常是同一状态的重复读数。等系统达到稳定（如摆完成完整周期）后再记录。'
    })
  },
  {
    id: 'over-range',
    when: (c) => c.events.some((e) => e.detail.includes('超量程') || e.detail.includes('打表')),
    make: () => ({
      id: 'over-range',
      level: 'error',
      title: '电表量程选择不当',
      tip: '读数超出量程会打表（可能损坏指针）。应先选用大量程试触，读数偏小时再换小量程，使指针落在刻度 1/3–2/3 区间。'
    })
  },
  {
    id: 'pause-then-record',
    when: (c) => {
      const evs = c.events
      for (let i = 1; i < evs.length; i++) {
        if ((evs[i].type === 'record' || evs[i].type === 'instrument') && evs[i - 1].type === 'pause' && evs[i].t - evs[i - 1].t > 3) {
          return true
        }
      }
      return false
    },
    make: () => ({
      id: 'pause-then-record',
      level: 'info',
      title: '长时间停顿后记录了数据',
      tip: '暂停很久后再记录，测的可能是"静止状态"而非运动过程数据。动态量应在系统运行中测量。'
    })
  }
]

/** 全量诊断（AI 面板"诊断"标签实时调用） */
export function diagnose(c: DiagnoseContext): Diagnosis[] {
  const out: Diagnosis[] = []
  for (const r of RULES) {
    try {
      if (r.when(c)) out.push(r.make(c))
    } catch {
      /* 单条规则异常不影响整体 */
    }
  }
  return out
}

/** 单次增量诊断（新事件到达时只报新命中的规则，避免重复打扰） */
export function diagnoseNew(c: DiagnoseContext, reported: Set<string>): Diagnosis[] {
  return diagnose(c).filter((d) => {
    if (reported.has(d.id)) return false
    reported.add(d.id)
    return true
  })
}
