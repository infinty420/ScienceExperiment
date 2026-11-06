# GitHub 调研与许可证取证作业手册

## 目标

产出**可复核的证据链**，而不是一份「我查过了」的结论。每一步都要能回答：查了什么、从哪个端点拿到、原文在哪、失败项如何处置。

## 端点清单（GitHub REST API v3）

| 用途 | 端点 | 备注 |
|---|---|---|
| 广域检索 | `GET /search/repositories?q=<urlencoded>&per_page=30&sort=stars` | 未认证 10 次/分钟，易 403；带 token 可到 30 次/分钟 |
| 仓库元数据 | `GET /repos/{owner}/{repo}` | 取 `license.spdx_id`、`default_branch`、`topics`、`archived` |
| 许可证元数据 | `GET /repos/{owner}/{repo}/license` | 返回 `content`（base64）与 `download_url` |
| README | `GET /repos/{owner}/{repo}/readme` | 同样 base64，用于读架构描述（**不读源码**） |
| 目录树 | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | 仅看文件命名以理解模块划分 |
| 速率 | `GET /rate_limit` | 起手先查，决定并发与查询数量 |

请求头建议：

```
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: <your-audit-tool>/1.0
Authorization: Bearer <GITHUB_TOKEN>   # 可选
```

## 标准流程

### 1. 广域检索

- 10–15 组关键词，覆盖「领域 + 技术栈 + 教学场景 + 分析方法 + 学习科学」多个维度，避免只搜一个方向。
- 关键词要保留原义，不要为了凑结果替换核心实体名。
- 结果去重后形成候选池，记录 `full_name / stars / license.spdx_id / description`。

### 2. 精确核查

- 从候选池挑 20–30 个高相关仓库（不只看 stars，也看是否直接对应目标能力）。
- 逐个取元数据 + LICENSE 全文，把 base64 解码后写入 `audit/licenses/<owner>_<repo>.txt`。
- 把 `spdx` 分布打印出来，快速看出这一领域是宽松许可为主还是 Copyleft 为主。

### 3. 证据文件结构

```
audit/
├── audit.json            # 检索词、候选池、精确记录、失败清单、SPDX 分布
├── licenses/             # LICENSE 原文（23 份量级）
│   └── owner_repo.txt
└── readmes/              # 架构描述文本，仅作思路参考
    └── owner_repo.md
```

`audit.json` 必须包含 `errors[]`，把 403 / 404 / NOASSERTION 全部如实记录。

## 限流与失败处置（重要）

| 情况 | 正确做法 | 禁止做法 |
|---|---|---|
| `HTTP 403` 限流 | 记录到 `errors`，用已有样本 + 官方页面交叉验证，结论中注明样本受限 | 换 IP、伪造 UA、反复重试、编造结果 |
| `404` 无 LICENSE 文件 | 查项目 README / 官网 / Wiki 的授权说明；仍无则标记「授权不明，不得复用」 | 默认当成「可自由使用」 |
| `NOASSERTION` | GitHub 无法自动识别，**必须**查官方站 / Wiki / FAQ 补足，例如 CeCILL、双许可、自定义许可 | 当成 MIT 或公有领域 |
| 官方页面 404 | 换官方 Wiki、项目历史页、包管理器元数据、发行说明交叉验证 | 直接放弃并写「未知」了事 |
| 多许可 / 双许可 | 记录全部选项与适用条件，取最严格的一档作为复用边界 | 只挑最宽松的那一个 |

## 交叉验证可信来源优先级

1. 仓库内 LICENSE / COPYING / NOTICE 原文。
2. 项目官方网站的 License / Legal 页。
3. 官方 Wiki、FAQ、History / Release notes。
4. 发行渠道元数据（npm / PyPI / Maven / 应用商店）中的 license 字段。
5. 权威第三方索引（SPDX License List、OSI、FSF）用于确认许可证条款本身，不用于确认某仓库选了哪个许可。

## 中国大陆网络环境提示

本地 HTTPS 代理常拦截 `git` 智能 HTTP，但 `api.github.com` 的 REST 请求通常可直连。执行脚本前可清空代理变量：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
  node scripts/gh_license_audit.mjs --repos repos.txt --out ./audit
```

`GIT_TERMINAL_PROMPT=0` 可避免推送时卡在交互凭据提示。

## 名称 / 商标核查（容易漏）

许可证合规 ≠ 命名合规。检索完必须额外做一次：

- 项目内部代号、英文简称是否与已存在的知名开源产品近似（大小写、复数、连字符差异也算）。
- 若近似：在 README 写「无关联声明」，在合规报告记录风险，**公开发布前改名**。
- 不要使用他人 Logo、图标、产品截图、品牌配色组合。
