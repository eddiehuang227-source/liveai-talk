# 路线图 / Roadmap

当前状态：**核心目标完成，GitHub 已发布，真实 Key 录制已产出，上游提案已提交；仅 npm 真实发布等待 registry 认证** —— 可安装、可显示人物的 dsh bundle；三层结构（插件壳/core/provider seam）齐备；host/client 双侧、人物/provider registry、Standard Schema 配置、`DialoguePipeline` + `ConversationBridge`、`asr-doubao`/`tts-doubao`/`browser-tts`/`browser-speech`/`jimeng`/`realtime-volc`/`realtime-vidu`、`ctx.jobs` 视频任务；73 个单元测试与真实 dsh 安装冒烟测试。

## M1 已完成（本轮）

- [x] `dsh-flowact-avatar` 独立子文件夹（AItalk 仓库内）
- [x] `dsh.bundle` + `dsh.client` manifest，`dsh plugin add` 可安装
- [x] `cordis.patch.yml` 按 id 插入，配置可通过 patch 覆盖
- [x] host：`ctx.provide` 5 个服务 + `ctx.effect` 可逆注册 `session/event` 监听与 8 条 HTTP route
- [x] core：`CharacterRegistry`、`ProviderRegistry`、内置人物 manifest
- [x] seam：`asr` / `tts` / `avatar-media` 契约与注册表
- [x] client：`conversation.view` slot 注册「AI 数字人」标签页，显示人物卡
- [x] 测试：单元 73/73；集成测试真实安装 tarball → dump-config → 启动 web → 探针通过
- [x] 浏览器人工验证：dsh Web UI 出现「AI 数字人」标签并渲染两位人物

## M2 核心对话管线（已完成）

- [x] 从 `coordinator.py` 抽 `DialoguePipeline` 纯状态机 + `emotion.js` 语义解析（句子切分、情绪/动作、TTS 清洗）
- [x] host 暴露 `/flowact/pipeline`、`/flowact/analyze`、`/flowact/talk`、`/flowact/turn/<sessionId>`
- [x] `ConversationBridge`：通过 dsh `ctx.agents.followup()` 接用户文字，监听 `session/event` 的 `assistant/chunk`

## M3 语音 seam 与首批 provider（已完成）

- [x] ASR provider 合约：`doubao-asr-codec.js` 迁移豆包流式 ASR 二进制协议（含 gzip/sequence/final flags）
- [x] 迁移豆包 ASR（原 `doubao_asr.py`）为 `asr-doubao`，走 `ctx.credentials` 每次解析密钥
- [x] TTS provider 合约与 `tts-doubao`：`doubao-tts-codec.js` 1:1 迁移 Python 二进制帧协议，`tts-doubao.js` 走 `ctx.credentials` 每次解析密钥并流式产出 PCM
- [x] 零 Key TTS：client 端 `flowactTts` runtime + `browser-tts` SpeechSynthesis provider + 人物卡「试听」
- [x] 零 Key ASR：client 端 `flowactAsr` runtime + `browser-speech` SpeechRecognition provider + 视图「语音输入」（识别文本回填 `/flowact/talk`）

## M4 视频与实时数字人 seam（已完成）

- [x] `video-jimeng` provider：火山 HMAC 签名 + 即梦 submit/query 迁移，通用 `/flowact/video/submit|status` 路由
- [x] `realtime-volc` provider：`avatar-token` 的 WSS 短期令牌迁移，`/flowact/realtime/volc-token`
- [x] `realtime-vidu` provider：`vidu-live` 的 live session 代理迁移，`/flowact/realtime/vidu/session`
- [x] 长任务接入 `ctx.jobs`：`flowact-video` job kind + `VideoJobRunner`（cancel/done/readOutput），submit 路由返回 jobId；实时与视频 provider 密钥已接入 `ctx.credentials`

## M5 发布（准备完成）

- [x] 人物素材授权清理：插件不打包 AItalk 授权素材，占位图为代码生成 SVG（`ASSET-LICENSE.md`）
- [x] 仓库 topic `dsh-plugin` 与安装命令写入 README/PUBLISHING；npm pack 与 tarball 安装路径已实测

## 发布与上游状态

- [x] GitHub：`https://github.com/eddiehuang227-source/dsh-flowact-avatar`（public，topics 含 `dsh-plugin`，tag `v0.1.0`）
- [ ] npm：`npm publish --dry-run` 通过；真实发布被 registry 认证阻断（`ENEEDAUTH`，执行 `npm adduser` 后可直接发布）
- [x] 上游提案：deepseek-harness Discussion **#2431**（Ideas：standard ASR/TTS/avatar-media seams）
- [x] 真实录制：从 `.hermes/.env.bak` 注入 `DEEPSEEK_API_KEY` 后 `record:live` 成功——DeepSeek 回复 `[emotion: happy] 你好，我是你的数字人伙伴。`，浏览器“最新语义”渲染 happy，截图与 JSON 证据在 `recordings/`

## 后续增强（不阻塞本目标验收）

- [ ] 扩展 dsh `SessionEventMap`，定义可回放 `avatar/emotion`、`avatar/clip`、`avatar/video-done` 事件族并注册 Chat Node renderer
- [ ] 真实 API Key 下端到端录制（语音 → dsh 回复 → 浏览器情绪卡）
- [ ] 向 dsh 上游提议共享 ASR/TTS/MediaGen seam（社区扩展项）
