# 发布清单 / Publishing checklist

目标：让任何 dsh 用户都能用一条命令安装这个插件，并保持可发现、可审计、可安全升级。

## 1. 仓库元数据

- [x] GitHub topic：`dsh-plugin`（另加 `deepseek-harness`、`ai-avatar`、`tts`、`asr`）
- [x] `package.json` 声明 `dsh.bundle` 与 `dsh.client`
- [x] `prepare` 构建脚本自包含（git 安装可用）
- [x] `files` 只发布 `lib`、patch、README、LICENSE、发布与授权说明

## 2. 安装路径

```sh
# npm 预编译包
dsh plugin --profile demo add dsh-live-talk

# GitHub 直装（pin 提交；用户需允许 prepare）
dsh plugin --profile demo add github:eddiehuang227-source/live-talk#v0.3.0

# tarball
npm pack
dsh plugin --profile demo add ./dsh-live-talk-0.3.0.tgz
```

## 3. 发布前验证

```sh
npm test                 # 单元测试（当前 72/72）
npm run test:integration # 真实 dsh：add → dump-config → web → HTTP/JS 探针
npm pack --dry-run       # 检查 tarball 内容，确认不含 Key 与未授权素材
```

集成测试已覆盖：`/live/health`、`/live/characters`、`/live/pipeline`、
`/live/analyze`、`/live/talk`、`/live/turn`、`/live/video/submit`（jobs）、
`/live/realtime/volc-token`、`/live/realtime/vidu/session`、client bundle 与
boot manifest。

## 4. CI 一键 npm 发布

仓库已带 `.github/workflows/publish.yml`：

1. 在 repo 的 **Settings → Secrets and variables → Actions** 添加 `NPM_TOKEN`（npm access token，类型 Automation）；
2. 在 GitHub 上发布一个新 Release（`published` 事件），或手动运行 workflow；
3. CI 会先跑 `npm install` → `build` → 全量单测 → `npm pack --dry-run`，全部通过后才执行 `npm publish --access public`。

本地等价命令：

```sh
npm adduser
npm publish --access public
```

## 5. 安全边界

- 所有云端 Secret 只通过 dsh `ctx.credentials` 引用；`cordis.patch.yml` 与配置中不含密钥。
- Vidu API Key 留在用户本机 18088 代理中，插件只访问代理。
- 视频任务以 dsh `ctx.jobs` 的 `live-video` kind 运行，随 owner/session 生命周期取消。
- 不在 GitHub Actions 或 tarball 中写入 `.env`、凭证或 AItalk 授权素材。

## 5. 版本策略

- dsh 当前是 developer preview：在 README 标注验证版本（0.1.0-rc.5）。
- 每次 dsh 升级跑一遍集成测试，再发 tag。
- 人物素材变更走独立 character asset pack，不 bump 核心插件。
