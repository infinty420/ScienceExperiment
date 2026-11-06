# 实验包 DSL v2 字段规范

## 顶层结构

```jsonc
{
  "id": "physics.pendulum",          // 必填，与目录名一致
  "title": "单摆周期测量",             // 必填
  "subject": "physics",
  "grade": "高中",
  "description": "...",
  "params": [ /* 可调参数，数组（可空） */ ],
  "records": [ /* 数据记录定义，数组；定性观察类允许为空 */ ],
  "meta": { /* DSL v2 元数据，强烈建议必填 */ },
  "solver": { /* 可选：声明式求解器 */ },
  "analysis": { /* 可选：声明式分析 */ }
}
```

## `meta`（合规可追溯的核心）

| 字段 | 类型 | 说明 |
|---|---|---|
| `dslVersion` | string | 固定 `"2.0.0"`，用于迁移与兼容性判断 |
| `license` | string | SPDX 标识或 `"Proprietary"`；**来源不明不得入库** |
| `author` | string | 包作者 |
| `attribution` | array | 思想来源列表，逐条写明参考了哪个项目的什么思想，并注明未复用代码 |
| `pedagogy` | object | 教学目标、知识点、难度、先修 |
| `tags` | string[] | 检索标签 |

`attribution` 条目示例：

```json
{
  "project": "myphysicslab/myphysicslab",
  "license": "Apache-2.0",
  "idea": "自适应步长与能量守恒诊断的教学呈现方式",
  "codeReused": false
}
```

## `solver`

| 字段 | 适用 | 说明 |
|---|---|---|
| `kind` | 全部 | `ode` / `analytic` / `circuit` / `monte-carlo` |
| `solver` | ode | `euler` / `symplectic` / `verlet` / `rk4` / `rk45` |
| `dt`, `rtol`, `atol`, `tEnd` | ode | 步长与自适应容差、终止时间 |
| `equations` | ode | 状态变量导数表达式数组，**数量必须与 `stateNames` 一致** |
| `stateNames` | ode | 状态变量名，如 `["theta", "omega"]` |
| `paramNames` | ode | 允许在表达式中出现的参数名 |
| `initial` | ode | 初值数组，长度与 `stateNames` 一致 |
| `energy` | ode | 能量表达式，用于守恒诊断 |
| `events` | ode | `[{ "id": "lowest-point", "expression": "omega" }]`，零交叉检测 |

单摆示例：

```json
{
  "kind": "ode",
  "solver": "rk45",
  "dt": 0.01,
  "rtol": 1e-8,
  "atol": 1e-10,
  "tEnd": 10,
  "equations": ["omega", "-(gravity/length)*sin(theta)"],
  "stateNames": ["theta", "omega"],
  "paramNames": ["length", "gravity"],
  "initial": [0.2618, 0],
  "energy": "0.5*length^2*omega^2 + gravity*length*(1-cos(theta))",
  "events": [{ "id": "lowest-point", "expression": "omega" }]
}
```

### 表达式安全约束

包可能来自外部导入，表达式就是注入面：

- 允许：数字、变量名、`+ - * / ^`、括号、白名单函数（`sin/cos/tan/exp/log/sqrt/abs/min/max/...`）、物理常量默认值。
- 禁止：`eval`、`new Function`、`require(`、`import(`、`process.`、`globalThis`、`__proto__`、`constructor(`、`fetch(`、`document.`、`window.`、分号与花括号。
- 实现：自己写 Tokenizer + Pratt 解析器，编译成闭包；**不要用 `eval` / `new Function`**。
- 常量（如 `R`、`g`、`c`）必须**可被同名变量覆盖**，否则物理公式会被常量遮蔽算错。
- 未知标识符返回 `NaN`，让校验器能定位，而不是运行时抛异常。

`scripts/package_check.mjs` 会在 CI 前静态拦截上述禁用构造。

## `analysis`

```json
{
  "fit": { "model": "linear", "x": "length", "y": "period" },
  "uncertainty": { "method": "gum" },
  "spectrum": { "signal": "theta", "sampleRate": 100 },
  "outliers": { "method": "iqr" }
}
```

仅声明意图，具体计算由内核完成。

## `quiz.json`

```json
{
  "questions": [
    {
      "q": "单摆周期与摆长的关系是？",
      "options": ["T ∝ L", "T ∝ √L", "T ∝ L²"],
      "answer": 1,
      "explain": "由 T = 2π√(L/g) 可得。",
      "knowledge": "physics.pendulum.period",
      "difficulty": 2
    }
  ]
}
```

教学场景常用**分组题库**（预习题 / 复习题分开），同样合法：

```json
{
  "preview": [ { "q": "...", "options": ["A", "B"], "answer": 0, "explain": "..." } ],
  "review":  [ { "q": "...", "options": ["A", "B"], "answer": 1, "explain": "..." } ]
}
```

`scripts/package_check.mjs` 兼容三种组织方式：顶层数组、`{ questions: [...] }`、分组对象（任意键值为题目数组）。

- `answer` 必须是 **0 基下标**且不越界（体检脚本会拦截越界，路径会精确到 `quiz.review[2].answer`）。
- `knowledge` 用于喂 BKT 与错题本，建议必填。
- 题干字段兼容 `q` 与 `question`，但下游收集错题时要显式映射（如 `q` → `question`），别直接展开对象，否则 `hashString(undefined)` 会报错。

## 校验器设计（自研 JSON-Schema 子集）

实现 `validateValue(value, schema, path)` 支持：

- `type`: object / array / string / number / integer / boolean
- `required`、`properties`、`additionalProperties`
- `items`、`minItems`、`enum`、`pattern`、`minimum` / `maximum`
- 自定义 `semantic` 钩子：交叉引用、数量一致、表达式安全、答案下标越界

返回 `ValidationReport { errors, warnings, issues: [{ path, message, level }] }`，并配 `formatIssues()` 输出人类可读定位。

### 已踩过的坑

- 定性观察类实验的 `records` 是空数组，若把 `minItems` 设成 1 会误伤 7 个包 → 设为 **0**。
- 单位字符串里出现 `×`（如 `×10³`）解析失败 → 单位别名表补 `'×': '1'`。
- V1 迁移**不要自动填 `license`**：许可证不能臆造，保持待补状态并提示。
- 包注册中心在测试环境不会自动初始化，包统计类断言前需显式 `registerBuiltin(...)`。

完整模板见 `assets/scene-template.json`。
