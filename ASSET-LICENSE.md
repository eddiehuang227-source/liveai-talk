# 素材授权说明 / Asset License

本插件包**不包含**原 AItalk 仓库的人物图片、视频、音频或图标素材。那些素材在
AItalk 仓库中属于单独授权（见其 `ASSET-LICENSE.md`），不会随 `dsh-flowact-avatar`
发布。

当前随包内容：

| 素材 | 来源 | 授权 |
|---|---|---|
| `docs/screenshot*.png` | 本仓库运行截图 | 仅文档用途，随 MIT 代码仓库分发 |
| 人物卡占位图 | `src/index.js` 内嵌生成的 SVG | MIT（代码生成，无外部素材） |
| 人物名称与 persona 文本 | 项目自写描述 | MIT |

如果要发布带真实形象的人物包，请把角色图片/视频作为**单独的 character asset pack**
发布，并在该包内声明各自授权；`dsh-flowact-avatar` 只读取角色 manifest 与 URL。
