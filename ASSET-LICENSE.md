# 素材授权说明 / Asset License

## 角色身份

Live Talk 内置四位原创 AI 角色：

| id | 名称 | 人设方向 |
|---|---|---|
| `chie` | 星之宫知惠 | 温柔自然的治愈系 |
| `wanqing` | 林晚晴 | 温柔体贴的邻家 |
| `qingxian` | 顾清弦 | 安静优雅、克制有礼 |
| `weixi` | 秦未晞 | 自信利落、偶尔毒舌 |

角色名称与人物形象均为本项目原创（AI 生成），不包含第三方动漫/影视 IP。

## 随包内容

| 素材 | 位置 | 是否进入 npm/tarball | 授权 |
|---|---|---|---|
| 人物预览图 `assets/*.jpg` | 仓库 | 是 | 原创 AI 生成 |
| 开场视频 `assets/*.mp4` | 仓库 | 是 | 原创 AI 生成 |
| 代码内嵌占位 SVG | `src/index.js` | 是 | MIT（代码生成） |
| `offline-clips/*` 引用 | `src/core/characters.js` | 否（仅 URL 引用） | 外部 character pack |
| `docs/screenshot*.png` | 仓库 | 否 | 仅文档用途 |

## `offline-clips` 外部包说明

`characters.js` 里的 `clips` 指向 `/live/assets/offline-clips/...`，这些情绪片段
不在本仓库。如需随插件提供，请把素材放进 `assets/offline-clips/video/`，或通过
`LIVE_ASSETS_ROOT` 指向已有素材目录。

历史 AItalk 工程里的片段文件以 `mah_` / `miy_` / `rin_` 为前缀，复制时需要同步
重命名为 `wanqing_` / `qingxian_` / `weixi_`，与当前角色 id 保持一致。

## 授权范围

仓库的 `LICENSE`（MIT）覆盖代码与配置。人物形象素材为本项目原创，随仓库以同一
LICENSE 分发；如未来引入第三方素材，必须在本文件补充来源与授权，并从核心包移除。
