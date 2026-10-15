# 日麻牌理速查 / utools-mahjong-paili-plugin

uTools 8 牌理工具：导入截图或输入天凤牌串，查看向听数、有效进张和切牌候选。识牌与计算均在本地完成，不上传截图。

## 安装

从 [GitHub Releases](https://github.com/hrbattery/utools-mahjong-paili-plugin/releases/latest) 下载 `.upxs` 安装包，复制文件后在 uTools 搜索框中粘贴，选择安装插件应用。安装后搜索「牌理」即可打开。

## 运行

开发环境使用 Node.js 24 或更新版本。

```sh
npm ci
npm run dev     # 浏览器预览
npm run build   # 构建 uTools 插件
```

在 uTools「开发者工具」中新建本地插件，选择 `dist/plugin.json`，搜索「牌理」打开。浏览器也能识牌和计算，系统截图需要 uTools。

## 使用

1. 粘贴手牌图片会自动识别；也可选图、拖入或截图后点击「本地识牌」。整桌截图需先框选横向手牌，包含摸牌、排除副露，再点击「应用裁剪」。
2. 核对牌数与牌面，通过点选或牌串校正。`?` 表示未识别，全部校正后才会计算。
3. 查看切牌候选，点击切牌和有效进张可继续推演，支持撤销。默认自动理牌，可关闭以保留牌序。

支持雀魂标准、猫咪雀圣、飞鸟与鱼、天凤标准四套牌面，含赤五。遮挡、强特效、旋转或过小牌面可能漏牌、错识，使用前需人工核对。

### 牌串格式

- `m` 万、`p` 筒、`s` 索、`z` 字；`1z–7z` 为东南西北白发中，`0m/0p/0s` 为赤五。例如：`123m456p789s11223z`。
- 待切牌支持 `2/5/8/11/14` 张，待摸牌支持 `1/4/7/10/13` 张。短手牌视为其余面子已固定。
- 已知吃碰杠可另填，如 `123m 555p 7777z`；杠算一组面子，扣除四张牌。

## 计算边界

- 计算普通形、七对子、国士无双的向听数和降低向听数的有效进张；不计算役、得分、收益、振听、防守或同向听改良。
- 候选先按切后向听数升序，再按进张枚数降序。赤五与普通五可分别切出，数学结果相同。
- 可用牌只扣除手牌、已填副露和推演弃牌，**不是实际牌山剩余量**。每种最多四张，赤五与普通五合并计数；未填副露时无法扣除对应牌。
- 引擎不会把已耗尽的牌视为未来进张，向听数可能与平台的形式听牌规则不同。跳转天凤牌理只传手牌，结果也可能不同。
- 手动编辑、修改副露或重新应用识别结果会重置推演。

## 开发

已附带编译好的 WebAssembly 引擎，前端开发无需 Rust。

```sh
npm test                    # 计算、解析、模板识牌
npm run test:ui             # 构建与 DOM 交互测试
npm run templates:prepare   # 重新生成识牌模板
```

重编译引擎需安装 Rust：

```sh
rustup target add wasm32-unknown-unknown
npm run build:engine
```

截图样本、识别回归结果与复现命令见 [samples/README.md](samples/README.md)。现有样本已用于开发，不能代表独立验证准确率；uTools 导入与系统截图权限尚待实测。

## 第三方项目与素材

- **shanten-dp 0.3.2**（MIT）：用于本地向听数与进张计算，编译进 WebAssembly 引擎。
- **mahjong_graphic**（M+ 字型许可）：提供手牌、点选牌表和进张结果使用的 SVG 牌面，不参与识别匹配。
- **雀魂与天凤游戏素材**：用于生成本地识别模板和测试样本。原始图集、牌面 GIF、裁剪模板和衍生识牌特征保留在源码仓库及现有提交历史中。插件安装包仅包含衍生识牌特征，不包含这些原图和裁剪图片。**这些游戏素材及衍生数据的再分发授权尚未确认，不适用本项目的 MIT 许可**；来源记录不代表再分发授权。
- **sharp**（Apache-2.0）：仅用于开发阶段的素材准备和图片测试，不进入插件运行时。

来源、版本与许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，本次公开范围与未解决事项见 [素材检查记录](docs/ASSET_REVIEW.md)。

## 许可证

本项目原创代码采用 [MIT License](LICENSE)，版权归 hrbattery 及贡献者所有。第三方依赖与牌面素材保留各自许可，不因本项目使用 MIT 而变更授权范围。

## 仓库维护与发布

- 一个插件一个仓库；在主分支维护稳定版本，较大的修改使用功能分支和 Pull Request。
- GitHub Topics 建议设置为 `utools`、`utools-plugin`、`mahjong`、`riichi`。
- 提交前运行 `npm test` 和 `npm run test:ui`；GitHub Actions 使用同样的检查。
- 版本采用 `1.0.0` 格式，Git 标签使用 `v1.0.0`；发布时同步 `package.json`、`package-lock.json`、`engine/Cargo.toml`、`engine/Cargo.lock` 及 uTools 开发者工具中的版本信息。
- 发布前更新 [CHANGELOG.md](CHANGELOG.md)，运行构建，并在实际 uTools 中检查导入、截图权限和本地识牌。
- uTools 开发者工具仅打包 `dist/`；GitHub Releases 附上插件安装包和更新说明。依赖目录、编译缓存、私人样本和安装包不提交 Git。
- 构建会将项目 `LICENSE`、`THIRD_PARTY_NOTICES.md` 和 `public/licenses/` 一并放入 `dist/`，发布时保留这些文件。
