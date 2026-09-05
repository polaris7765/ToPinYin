# 中文拼音助手 · 微信小程序

> 一个**本地化、零数据上传**的中文 → 拼音转换小程序，输入中文即可获得带声调拼音的对照版
> 本，并支持一键导出 **Word / PDF / 文本**，可在微信内置文档查看器中打开、转发、用其他应用打开。

---

## 1. 项目简介

本项目是 Unity 版本「中文拼音助手」（`/Users/admin/Workspace/ToPinyin/ToPinYin`）的 **微信小程序移植版**，
完全复刻原 Unity 应用的核心功能，并在此基础上增加：

- ✨ **设置菜单**：界面语言、正文字号、主题（亮 / 暗 / 跟随系统）、默认声调、
  默认显示方式、ü→v 开关、导出后自动打开、保留历史记录
- 🌍 **多国语言**：内置 `简体中文 / 繁體中文 / English / 日本語` 四种界面
- 📐 **多分辨率适配**：使用 rpx 自适应，并通过 CSS 媒体查询对窄屏 / 宽屏分别优化
- 🌗 **主题**：浅色 / 深色 / 跟随系统，运行时通过 `wx.onThemeChange` 监听系统切换
- 📤 **导出 → 其他应用**：使用 `wx.openDocument` 打开导出文件，借助
  `showMenu: true` 在微信右上角菜单中触发"用其他应用打开 / 转发 / 保存到收藏"
- 📤 **直接分享**：通过 `wx.shareFileMessage` / `wx.addFileToFavorites` 把文件发到聊天
  或加入收藏夹
- 🔍 **关于页**：显示版本、词库大小、隐私说明、反馈入口

---

## 2. 目录结构

```
WorkBuddyMiniProgram/
├── README.md                  本文件
├── docs/DEVELOPMENT.md        完整开发技术文档
├── project.config.json        微信开发者工具工程配置
└── miniapp/                   小程序源码根（与 project.config.json miniprogramRoot 对应）
    ├── app.js                 全局入口：启动分包加载 Pinyin 引擎、注入设置
    ├── app.json               全局路由 / 分包 / 窗口
    ├── app.wxss               全局样式：CSS 变量 + 主题 + 自适应断点
    ├── sitemap.json           站点地图（开发可索引规则）
    ├── pages/
    │   ├── index/             主页：输入 → 转换 → 显示 → 导出
    │   ├── settings/          设置页：所有可调选项
    │   └── about/             关于页：版本 / 隐私 / 反馈
    ├── utils/
    │   ├── pinyin.js          中文 → 拼音引擎（最大匹配分词 + 多音字消歧）
    │   ├── tone.js            声调符号 ↔ 数字转换工具
    │   ├── docx.js            DOCX 二进制构造（UTF-8 + ZIP + XML）
    │   ├── pdf.js             PDF 二进制构造（UTF-8 + ZIP + TTF 子集嵌入）
    │   ├── ttf.js             TTF 字体子集化（提取 cmap 与字形轮廓）
    │   ├── zip.js             纯 JS 实现的 ZIP 编码器（store + deflate）
    │   ├── crc32.js           CRC32 计算（用于 ZIP）
    │   ├── base64.js          Base64 解码（用于加载字体分片）
    │   ├── utf8.js            UTF-8 编解码（用于文本字段）
    │   ├── exporter.js        文件保存 / 打开 / 分享的统一封装
    │   ├── i18n.js            国际化（语言切换 + 事件总线）
    │   ├── settings.js        设置存储（持久化 + 事件广播）
    │   └── theme.js           主题 / 字号解析 + CSS 变量注入
    ├── packageData/data/      分包 1：单字拼音库 + 词典（≈700 KB）
    ├── packagePhrase/data/    分包 2：常用词组拼音库（≈1.4 MB）
    ├── packageFontA/          分包 3：PDF 中文字体分片 A（≈1.7 MB）
    └── packageFontB/          分包 4：PDF 中文字体分片 B（≈1.2 MB）
```

---

## 3. 在微信开发者工具中运行

1. 打开 **微信开发者工具** → 导入项目
2. 选择本目录（`/Users/admin/Workspace/ToPinyin/WorkBuddyMiniProgram`）
3. AppID 已在 `project.config.json` 中预填（`wxfa28f4746f20a888`），
   你也可以换成自己的 AppID 或使用"测试号"
4. 编译并预览：
   - 主面板预览 → 输入中文 → 点「转换」→ 观察输出
   - 切换「显示」 → 逐字标注 / 行内对照 / 仅拼音 可见即时变化
   - 点「导出 Word」 / 「导出 PDF」 / 「导出文本」 → 自动调用微信
     `openDocument` 打开，可通过右上角菜单"用其他应用打开"

> **真机调试**：上拉"预览"扫码，或点"真机调试"使用 USB 数据线连接手机。

---

## 4. 核心流程

### 4.1 启动流程

```
app.onLaunch
  ├── settings.boot()                 加载本地持久化
  ├── i18n.load()                      推断系统语言
  ├── theme.refresh()                  计算主题 CSS 变量
  ├── theme.onSystemThemeChange(...)   注册系统主题变化
  └── loadAll() ──Promise.all──→ 4 个分包
        ├── packageData/data/pinyin.js  单字 ≈27000 条
        ├── packageData/data/zdic.js    汉典词组库
        ├── packagePhrase/data/phrase.js 常用词组库
        ├── packageFontA/font-part1.js  字体分片 1/3
        ├── packageFontA/font-part3.js  字体分片 3/3
        └── packageFontB/font-part2.js  字体分片 2/3
      → base64.decode(font parts) → fontBytes Uint8Array
      → new pinyin.PinyinEngine()
      → engine.loadCharObject(...) + loadWordObject(...)  ×2
      → globalData.engine = engine
```

### 4.2 转换流程

```
textarea 输入 → onInput → settings.set(lastInput)
            → 用户点「转换」
            → onConvert
                → engine.convert(text)
                → this._render()
                    → 三种显示模式分别走：
                      0:  逐字标注   → 构建 annLines[] 给 <view wx:for> 渲染
                      1:  行内对照   → renderParenthesis() 一行字符串
                      2:  仅拼音     → renderResult() 一行字符串
            → setData({ status })
```

### 4.3 导出流程

```
点击「导出 Word」
  → docx.build(result, opts)         生成 Uint8Array
  → exporter.saveBytes(name, bytes)  保存到 wx.env.USER_DATA_PATH/pinyin-export
  → exporter.openDoc(path, 'docx')   wx.openDocument + showMenu: true
                                       → 用户在右上角菜单可
                                          「用其他应用打开 / 转发 / 保存到收藏」

点击「导出 PDF」流程相同，pdf.build() 会嵌入 TTF 子集（按 result 中出现过的汉字裁剪
字体，最大限度缩小文件）。
```

### 4.4 设置广播流程

```
任何页面 onLoad 都会执行:
  settings.boot()
  settings.onChange(callback)
  i18n.onChange(callback)

用户在设置页 onSegmentPick / onSwitchChange / onPickerChange
  → settings.set(key, value)
    → _persist() 写 wx.storage
    → _emit({ key, prev, value }) 通知所有监听者
    → 如果是 lang 字段，联动 i18n.setLang(value) → 也写 wx.storage + emit i18n 事件
```

主页 / 设置页 / 关于页都订阅了这两个事件；任何语言变更会同时刷新它们的
`i18n` / `rows` / `themeStyle`，无需手动重新加载页面。

---

## 5. 设置项说明

| Key                | 类型    | 默认        | 说明                                  |
| ------------------ | ------- | ----------- | ------------------------------------- |
| `lang`             | string  | `zh-CN`     | 界面语言；支持 `zh-CN/zh-TW/en/ja`     |
| `theme`            | string  | `system`    | 主题；支持 `light/dark/system`        |
| `fontSize`         | string  | `medium`    | 正文字号；`small/medium/large`        |
| `defaultTone`      | number  | `0`         | 默认声调：0 符号 / 1 数字 / 2 无     |
| `defaultMode`      | number  | `0`         | 默认显示：0 逐字 / 1 行内 / 2 仅拼音 |
| `uAsV`             | boolean | `true`      | ü 用 v 表示                           |
| `openAfterExport`  | boolean | `true`      | 导出后自动打开文档查看器              |
| `keepHistory`      | boolean | `true`      | 记住上次输入文本                      |
| `lastInput`        | string  | `''`        | 上次的输入文本                        |

所有设置都保存到 `wx.storage` 的 `wb.settings.v1`，即使小程序销毁再启动也会保留。

---

## 6. 多语言与主题

- 语言字符串集中在 `utils/i18n.js` 的 `STRINGS` 对象里，新增一种语言只需新增一个 key。
- 主题通过 CSS 变量驱动：`app.wxss` 中 `--bg / --card / --text / --primary` 等变量；
  浅色与深色两套值在 `utils/theme.js` 的 `LIGHT_VARS / DARK_VARS` 中。
- `theme.refresh()` 返回一段 CSS 文本，挂到 `<view style="{{themeStyle}}">` 上即可。

---

## 7. 多端 / 多分辨率适配

- 设计基准 750 rpx = 屏幕宽度，所有距离使用 rpx。
- 在 `app.wxss` 底部通过两条 `@media` 断点对窄屏 / 宽屏分别优化：
  - `max-width: 360px`：iPhone SE 等极窄设备 → 紧凑头部、小字号。
  - `min-width: 600rpx`：**开发板 / PC** 体验版 → 大字号、内边距、按钮尺寸放大。
- 真机测试：
  - iPhone SE (320 × 568 pt)：竖屏卡片式设计，无溢出
  - iPhone 14 Pro (393 × 852 pt)：默认布局
  - iPad mini (744 × 1133 pt)：触发宽屏断点
  - iPad Pro 12.9" / PC 体验版 (1024+ pt)：大字号更舒适

---

## 8. 安全性 / 隐私

- **不联网**：除了首次冷启动分包加载本地代码，本工具完全离线运行。
- **不上传任何输入文本**：所有转换在本地完成，剪贴板 / 缓存文件均保存在用户
  沙箱内（`wx.env.USER_DATA_PATH`）。
- **导出文件只存在本地**：`pinyin-assistant/pinyin-export/` 目录；用户主动选择
  分享才会上传到微信聊天。

---

## 9. 已知限制

- 个别极冷僻字（Unicode 扩展 C-F，> 0x2A700）在基础拼音库中没有读音，
  引擎会保留原字符但不留拼音；可以扩展 `packageData/data/pinyin.js` 补充。
- 字体子集仅在 PDF 导出时按本文出现过的汉字裁剪；如导出后追加文本需重新生成。
- iOS 模拟器和 PC 体验版因系统限制，部分 `wx.shareFileMessage` 不可用；建议真机调试
  验证"转发到其他应用"。

---

## 10. 开发命令参考

| 操作 | 命令 |
| ---- | ---- |
| 在微信开发者工具中打开项目 | 选择 `WorkBuddyMiniProgram/` 目录 |
| 构建产物 | 工具左上角"代码依赖分析" → 真机 / 体验码 |
| 真机调试 | 工具 → 真机调试 / 预览 → 扫码 |
| 上传审核 | 工具 → 上传 → 填写版本号 |

---

## 11. 反馈

打开小程序右上角 ⓘ 进入"关于"页 → "反馈" → 一键复制版本号 + 词库大小，
粘贴到对应反馈渠道即可。

— Made with ❤ for Chinese learners everywhere.
