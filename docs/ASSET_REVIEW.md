# 公开素材检查记录

检查日期：2026-10-15。

## 公开范围

仓库名为 `utools-mahjong-paili-plugin`，保留现有提交历史、识牌功能和素材。维护者已选择按此范围公开；该选择不构成第三方权利人的再分发授权。

| 内容 | 位置 | 检查结论 |
|---|---|---|
| 原创 TypeScript、Rust 包装层、脚本及插件图标 | `src/`、`engine/src/`、`scripts/`、`public/logo.*` | 按维护者选择采用根目录 MIT 许可 |
| 向听计算库及运行时依赖 | `src/paili_engine.wasm`、`engine/Cargo.lock` | shanten-dp 使用 MIT；bitflags、thiserror 保留随包附带的 MIT 声明 |
| 显示用 37 张 SVG 牌面 | `public/tiles/mahjong-graphic/` | 上游声明使用 M+ 字型许可，保留上游来源、提交号和许可全文 |
| 雀魂原始图集与天凤牌面 GIF | `assets/majsoul-*/`、`assets/tenhou-standard/tiles/` | 有来源及哈希记录；未核实到明确再分发授权，保留在公开源码和旧提交中 |
| 148 张裁剪模板 | `assets/recognition-templates/` | 源自上述游戏图像；不纳入 MIT，授权状态同上 |
| 内嵌图案与颜色特征 | `src/generated/tile-templates.json` | 由游戏模板生成；不纳入 MIT，未确认其再分发授权；进入插件安装包 |
| 下载截图及回归产物 | `samples/private/` | 被 Git 忽略，不进入源码分发和插件安装包；来源清单与测试说明保留在仓库 |
| 开发工具 | `package-lock.json` | sharp、jsdom、TypeScript、Vite 等用于开发或构建，不把 `node_modules/` 随插件发布 |

## 上游许可依据

- [shanten-dp-rust](https://github.com/tomohxx/shanten-dp-rust)：使用版本固定为 `0.3.2`，运行依赖锁定在 `engine/Cargo.lock`；许可副本位于 `public/licenses/`。
- [mahjong_graphic 固定版本](https://github.com/lietxia/mahjong_graphic/tree/3e275804ff58325306710bef3a7406860444bc6a)：上游 README 声明 M+ 字型许可，允许使用、修改和再分发，包括商业用途。上游另注明部分字形来自 I.Mahjong 和 GL-MahjongTile，已保留来源说明。
- 雀魂和天凤图像：`assets/*/source.json` 及模板清单记录了可取得的来源、尺寸、裁切位置和 SHA-256；这些记录只能证明来源和对应关系。本次未核实到适用于本项目公开再分发的明确授权，因此保留为未解决事项。

## 已执行的处理

- 为原创代码补充 MIT 许可，第三方内容按实际许可或未授权状态分别声明。
- 在 README 和第三方声明中明确区分 GitHub 源码分发与 uTools 插件分发。
- 保留现有素材和 Git 历史，不通过删除当前文件来声称已清除历史素材。
- 构建自动携带原创代码许可及第三方声明，保留所有已有第三方许可副本。

## 尚未解决

游戏原图、裁剪和衍生特征的再分发授权尚未确认。本次整理没有取得或补发授权，也没有将它们更换为其他素材。后续若取得许可，应保存授权范围和证据；若移除素材，还需同时处理公开历史、已有 Release 与安装包中的相应内容。
