# 中文拼音助手 · 微信小程序 — 开发技术文档

> 本文档面向二次开发者，描述架构、关键模块、扩展示例与维护要点。
> 配合 `README.md` 一起阅读。

---

## 目录

1. [架构总览](#1-架构总览)
2. [分包加载策略](#2-分包加载策略)
3. [拼音引擎详解](#3-拼音引擎详解)
4. [DOCX 文档生成原理](#4-docx-文档生成原理)
5. [PDF 文档生成原理](#5-pdf-文档生成原理)
6. [国际化（i18n）机制](#6-国际化i18n机制)
7. [设置存储机制](#7-设置存储机制)
8. [主题（Theme）/ 字号（Font Size）切换](#8-主题theme-字号-font-size-切换)
9. [导出后的"用其他应用打开 / 转发"链路](#9-导出后的用其他应用打开--转发链路)
10. [多分辨率适配策略](#10-多分辨率适配策略)
11. [扩展指南](#11-扩展指南)
12. [性能指标 / 待优化点](#12-性能指标--待优化点)
13. [常见问题](#13-常见问题)

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│   WeChat Client (微信客户端)                                       │
│   ┌──────────────────────┐                                        │
│   │  Mini Program Runtime  │  ← 提供 wx.* API                     │
│   └──────────┬───────────┘                                        │
│              │  require('./utils/*')                              │
│              ▼                                                     │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │                  miniapp/  (本小程序源码)                │    │
│   │                                                          │    │
│   │   app.js  ──▶ settings.boot() ──▶ i18n.load()           │    │
│   │              └── theme.refresh()                        │    │
│   │              └── loadAll()  ──▶ 4 个分包                  │    │
│   │                  │            │                          │    │
│   │                  │            ├── packageData  (单字/词) │    │
│   │                  │            ├── packagePhrase (常用词) │    │
│   │                  │            ├── packageFontA  (字体 A) │    │
│   │                  │            └── packageFontB  (字体 B) │    │
│   │                  ▼                                       │    │
│   │           new PinyinEngine() → engine                    │    │
│   │                                                          │    │
│   │   pages/                                                  │    │
│   │     ├─ index      ← 用户操作主页面                       │    │
│   │     ├─ settings   ← 全部设置                             │    │
│   │     └─ about      ← 关于 / 反馈                          │    │
│   │                                                          │    │
│   │   utils/                                                  │    │
│   │     ├─ pinyin     中 → 拼音 引擎                         │    │
│   │     ├─ tone       声调转换                                │    │
│   │     ├─ docx       DOCX 生成                              │    │
│   │     ├─ pdf        PDF  生成                              │    │
│   │     ├─ ttf        TTF 字体子集化                          │    │
│   │     ├─ zip        ZIP 编码                                │    │
│   │     ├─ crc32      CRC32                                  │    │
│   │     ├─ base64     Base64 解码                            │    │
│   │     ├─ utf8       UTF-8                                  │    │
│   │     ├─ exporter   文件保存/打开                          │    │
│   │     ├─ i18n       国际化                                  │    │
│   │     ├─ settings   设置存储                                │    │
│   │     └─ theme      主题                                    │    │
│   └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

依赖关系：

```
        ┌──────────┐         ┌──────────┐         ┌──────────┐
        │   page   │─────────│ settings │─────────│  i18n    │
        │ (3 pages)│         └────┬─────┘         └────┬─────┘
        └────┬─────┘              │                    │
             │                    │                    │
             │             ┌──────▼──────┐     ┌──────▼──────┐
             │             │   theme.js  │     │  wx.onTheme │
             │             └──────┬──────┘     │   Change    │
             │                    │            └─────────────┘
             ▼                    ▼
        ┌──────────┐         ┌──────────┐
        │ pinyin   │         │ CSS Vars │
        │ exporter │         └──────────┘
        └────┬─────┘
             ▼
        ┌──────────┐         ┌──────────┐
        │  docx /  │─────────│   zip    │
        │  pdf /   │         │   crc32  │
        └────┬─────┘         └────┬─────┘
             │                    │
             ▼                    ▼
        ┌──────────┐         ┌──────────┐
        │   ttf    │─────────│  base64  │
        │  (PDF用) │         │  utf8    │
        └──────────┘         └──────────┘
```

---

## 2. 分包加载策略

小程序对主包大小有限制（普通小程序 **2MB**，扩展到 **20MB** 需要配置
`"requiredBackgroundModes"` 等）。本应用核心依赖：

| 数据              | 大小         | 重要性           |
| ----------------- | ------------ | ---------------- |
| 单字拼音库        | ≈ 700 KB     | 必备             |
| 词组拼音库        | ≈ 1.4 MB     | 必备（多音字消歧）|
| 汉典 zdic 词组    | ≈ 170 KB     | 必备             |
| PDF 中文字体 A    | ≈ 1.7 MB     | 拖慢首屏         |
| PDF 中文字体 B    | ≈ 1.2 MB     | 拖慢首屏         |

为了**秒开**，将"运行时才需要的字体分片"单独分包，避开主包 2MB 上限：
- `packageData` 与 `packagePhrase` 几乎是首屏必需，列入前两个分包。
- `packageFontA` / `packageFontB` 只有在用户点"导出 PDF"时才需要。

### 加载逻辑

```js
// app.js loadAll()
Promise.all([
  _loadOne('packageData',  'data/pinyin.js'),
  _loadOne('packageData',  'data/zdic.js'),
  _loadOne('packagePhrase','data/phrase.js'),
  _loadOne('packageFontA', 'font-part1.js'),
  _loadOne('packageFontA', 'font-part3.js'),
  _loadOne('packageFontB', 'font-part2.js'),
]);
```

`_loadOne()` 函数依次尝试三种加载方式（兼容基础库 2.x ↔ 3.x ↔ 4.x）：

```js
function _loadOne(pkgRoot, rel) {
  const reqPath = './' + pkgRoot + '/' + rel;
  if (typeof require.async === 'function') {
    return require.async(reqPath).then(m => m, err => Promise.reject(err));
  }
  if (wx.loadSubpackage) {
    return new Promise((res, rej) => {
      wx.loadSubpackage({
        name: pkgRoot,
        success: () => res(require(reqPath)),
        fail: rej
      });
    });
  }
  return Promise.resolve(require(reqPath));
}
```

### 字体分片为什么分 A/B 两包？

微信小程序单分包上限 **2MB**；嵌入中文 TTF 整个文件接近 3MB，因此我们使用一个
**预处理脚本**（参见 `tools/build-font.js`）把一个完整 TTF 拆成 3 个分片（每片
约 1.7 MB / 1.2 MB / 0.5 MB），运行时重新拼回 Uint8Array。

> 本项目没有自带字体源文件（出于体积与版权），构建脚本读取源码后输出三个 `.js`
> 文件，导出 Base64 字符串，main 端 `base64.decode(b64)` 得到原 TTF 字节。

---

## 3. 拼音引擎详解

文件：`utils/pinyin.js`（JS 移植版）、`utils/tone.js`

引擎结构：

```
PinyinEngine
├── _charReadings : { [UnicodeCodePoint: string]: string[] }   单字 → 读音列表
├── _wordDict     : { [词: string]: string[] }                  词条 → 每字读音数组
├── _maxWordLen   : number                                      最长词长度
├── loadCharObject(obj)                                         载入单字数据
├── loadWordObject(obj)                                         载入词条数据
├── convert(text)                                               转整段文本
└── render / renderResult / renderParenthesis                  把结果转字符串
```

### 3.1 算法

`convert(text)`：

1. 行分割：`\n`。
2. 每行先按 CJK 区段 / 非 CJK 区段切分。
3. 对连续 CJK 段调 `_segmentCjk()` 做**最大匹配分词**：
   - 从当前位置尝试最长词（`_maxWordLen`）开始找；
   - 命中 → 按词条拼音给每个字注音；
   - 未命中 → 退回单字默认读音；
   - 移动游标，循环。

### 3.2 多音字消歧

由于 `_wordDict` 比单字读音优先，并且覆盖了大量常用词组（如 `长大 cháng dà`、
`银行 yín háng`），所以多音字大部分情况下都能正确读音。

未命中的字（如 `重庆 重` 应读 chóng、`重要 重` 应读 zhòng）会按单字默认读音，
**优先级链**：词级 > 单字第一读音 > 空字符串。

### 3.3 声调风格

`ToneUtil.ConvertStyle(pinyin, style, uAsV)` 实现：

| style     | 输出                          |
| --------- | ----------------------------- |
| Symbol    | `nǐ`                          |
| Number    | `ni3`                         |
| None      | `ni`                          |

`uAsV=true` 时，`Number/None` 模式下 `ü → v`。

---

## 4. DOCX 文档生成原理

文件：`utils/docx.js`

DOCX 的本质是**一个 ZIP 包**，里面放若干 XML：

```
[Content_Types].xml                       媒体类型清单
_rels/.rels                              根关系
word/document.xml                         文档主体
word/styles.xml                           样式表（可选）
word/_rels/document.xml.rels              document.xml 的关系
word/fontTable.xml + word/webSettings.xml + …
```

构造流程：

```
1) buildXML(opts)                  拼装字符串化的 document.xml
2) zip.pack(files)                 用 zip.js 把多个文件打包成 ZIP
3) return zipBuf                   Uint8Array 返回给页面
```

### 排版样式（参考原 Unity 截图）

| 元素            | 字号 | 颜色        |
| --------------- | ---- | ----------- |
| 标题「中文拼音对照表」 | 36 pt | `#2F5496` 蓝 |
| 副标题「汉字 X 个 · 共 Y 字 · 转换时间」 | 20 pt | `#5A647A` 灰 |
| 拼音行          | 16 pt | `#1F4E79` 蓝 |
| 汉字行          | 24 pt | `#22304A` 深灰 |
| 页脚页码        | 12 pt | `#5A647A` |

样式通过 `<w:rPr><w:color w:val="..."/><w:sz w:val="..."/></w:rPr>` 控制。

### 段落策略

输入文本按 `\n` 分行；每行输出两个段落：拼音行 + 汉字行。

- 拼音行：以 `<w:r>` 描述每个音节（独立 run，便于控制颜色 / 字号）。
- 汉字行：以 `<w:r>` 描述每个汉字。
- 词条之间插入空格 (`<w:t> </w:t>`) 与 Unity 截图一致。

页面设置：A4 纵向 / 上下页边距 2.54 cm 等，使用 `<w:sectPr>`。

---

## 5. PDF 文档生成原理

文件：`utils/pdf.js` + `utils/ttf.js` + `utils/zip.js`

PDF 1.7 文档结构：

```
%PDF-1.4
1 0 obj  <<…>>  endobj          文档目录
2 0 obj  <<…>>  endobj          页面树
3 0 obj  <<…>>  endobj          单页对象
4 0 obj  <<…>>  endobj          内容流（text positioning）
5 0 obj  <<…>>  endobj          字体（Type0 / CIDFontType2）
6 0 obj  <<…>>  endobj          TTF 流（嵌入字体）
…
xref
0 7
0000000000 65535 f 
0000000010 00000 n 
…
trailer
<< /Size 7 /Root 1 0 R >>
startxref
12345
%%EOF
```

### 5.1 嵌入字体子集

如果直接把全 TTF 嵌入，几百 KB 到几 MB 不等；本项目对**实际使用的汉字**做了
**子集化（subset）**，所以最终文件往往只 50~200 KB。

`utils/ttf.js` 暴露：

- `parseTTF(buf)` → 返回 `{ glyphs, cmap, hmtx, name, post }`。
- `subsetTTF(usedCodes)` → 重新构建一个仅包含 `usedCodes` 的 TTF：
  1. cmap 只保留目标 Unicode（并重映射为 0x20 起的连续码位）。
  2. glyphs、hmtx 同步裁剪与重排。
  3. 写回 Simple 版的 `head/hmtx/cmap/post/name/maxp/OS2/loca/glyf` 表。

### 5.2 PDF 排版

引擎按 A4 (595 × 842 pt) 自动分页：

- 顶部留 80 pt 给标题 / 副标题；
- 主体区域每行 36 pt；超出页脚 60 pt 触发分页；
- 段落策略：拼音行 → 汉字行 → `leading` 间距 6 pt → 下一段；
- 页码：`/ 1 / 2 / …` 居中。

---

## 6. 国际化（i18n）机制

文件：`utils/i18n.js`

核心 API：

```js
const i18n = require('./utils/i18n');

i18n.t('input.title');                     // → 当前语言下的字符串
i18n.t('output.statusDone', { n: 12 });    // 占位符 {n}
i18n.setLang('en');                        // 切换 + 持久化 + 广播
i18n.onChange(cb);                         // 订阅语言变更
i18n.supported();                          // → ['zh-CN','zh-TW','en','ja','fr','es','pt','ko','hi']
```

### 6.1 字符串表

`STRINGS = { zh-CN: {...}, zh-TW: {...}, en: {...}, ja: {...} }`。

缺失 key 时回退顺序：`当前语言 → zh-CN → key 本身`，避免 UI 出现 `undefined`。

### 6.2 占位符语法

`t(key, vars)` 会用 `String.replace(/\{(\w+)\}/g, ...)` 把 `{varName}` 换成传入值；
vars 不存在则保留原 `{}` 占位以便排查。

### 6.3 主题无关

`i18n` 只管字符串，主题 / 字号由 `theme.js` 接管，互不耦合。

---

## 7. 设置存储机制

文件：`utils/settings.js`

- 全部设置写 `wx.setStorageSync(STORAGE_KEY, snapshot)`，STORAGE_KEY=`wb.settings.v1`。
- 缺字段时合并默认值（`ALL_DEFAULTS`）。
- 通过 `settings.onChange(callback)` 订阅变更。
- 与 i18n 同步：检测到 `lang` 字段变化时联动 `i18n.setLang(value)`。

### 7.1 何时把 `input` 写入 `lastInput`

只有当 `keepHistory` 为 `true` 时才保存上次输入，避免隐私敏感场景泄露。

### 7.2 重置

```js
settings.reset();   // 全部回到 ALL_DEFAULTS
```

设置页"恢复默认"按钮触发 `_renderRows()` 刷新所有 row。

---

## 8. 主题（Theme）/ 字号（Font Size）切换

文件：`utils/theme.js`

- `theme.refresh()` 计算最终主题（`settings.theme === 'dark'/'light'/system`）
  + 字号档位（`small/medium/large`），并把对应 CSS 变量字符串返回。
- 设置到 `<view style="{{themeStyle}}">` 上即可，CSS 变量级联到所有子节点。
- 监听 `wx.onThemeChange`：用户在系统设置里切到深色模式时自动刷新。

字号通过 `--font-scale` 与派生变量 `--base-font / --base-pinyin / --base-char / --base-title`
应用到各元素，避免逐个 `setData`。

---

## 9. 导出后的"用其他应用打开 / 转发"链路

```
导出 Word / PDF
  → saveBytes()                   写本地 wx.env.USER_DATA_PATH/pinyin-export/...
  → wx.openDocument({...})        调起微信内置文档查看器
    showMenu: true                → 用户右上角菜单可：
       1. 用其他应用打开       → 调起第三方 App (Pages / Keynote / WPS…)
       2. 转发给朋友           → 调起聊天选择器，以 .docx / .pdf 文件发送
       3. 保存到收藏           → addFileToFavorites
       4. 另存为…              → saveFile 到聊天 / 文件传输助手
```

文本格式特殊处理：

```
导出文本（.txt）
  → saveBytes()                     写到本地
  → exporter.copyText(body)         同步复制到剪贴板
  → wx.openDocument / shareFile     给用户更灵活的二次操作
```

`exporter.actionSheet()` 在文件保存后立即弹一个 `ActionSheet`，让用户在主流客户端
一键选择：

- 打开文档
- 复制文件名
- 分享到聊天（`wx.shareFileMessage`）
- 保存到收藏（`wx.addFileToFavorites`）

iOS 旧版或 PC 体验版 `wx.shareFileMessage` 不可用，函数自动跳过对应菜单项。

---

## 10. 多分辨率适配策略

### 10.1 基准 + 断点

基准 750 rpx。`app.wxss` 末尾用两条媒体查询：

```css
/* 极窄屏（iPhone SE 等） */
@media screen and (max-width: 360px) {
  .header { height: 100rpx; }
  …
}

/* 宽屏（iPad / 开发板 PC 体验版） */
@media screen and (min-width: 600rpx) {
  .container { padding: 0 56rpx; }
  .header    { border-radius: 32rpx; padding: 0 36rpx; }
  …
}
```

> WeChat WXSS 与 web 标准 CSS 的 `@media` 一致；`screen` width 在小程序里就
> 是可视区宽度（单位 px）；rpx 与 px 的换算依赖小程序（一般 750 rpx = 屏幕宽 px）。

### 10.2 安全区适配

状态栏 / 底部 Home Indicator 处理：通过 `wx.getSystemInfoSync().safeArea` 拿到
安全区坐标；当前版本中主体已经预留安全 padding。如果需要更深，可使用 WXML：
`style="padding-top: {{safeAreaTop}}px"`。在 `theme.deviceProfile()` 中已经
解析这些字段。

### 10.3 平板与 PC 体验版

`min-width: 600rpx` 触发的样式会让字号、内边距、卡片圆角增大，更接近大屏阅读体验。

---

## 11. 扩展指南

### 11.1 增加一种界面语言

```js
// utils/i18n.js
STRINGS['ko'] = {
  'common.appName': '중국어 병음 도우미',
  // … 把所有 key 都翻译一遍
};
SUPPORTED.push('ko');
```

> ⚠️ 必须保证所有 key 都被翻译，否则该语言下显示中文兜底。

### 11.2 增加一种声调风格

- `utils/pinyin.js` 中扩展 `ToneStyle` 取值；
- `utils/tone.js` 中扩展 `ConvertStyle` 转换逻辑；
- i18n 新增 `input.tone.<key>`。

### 11.3 增加一种导出格式（如 Markdown）

```js
// utils/markdown.js
function build(result, opts) { … }
// pages/index/index.js
onExportMd: function () {
  var bytes = md.build(this._result, this._exportOpts());
  var path = exporter.saveBytes(name, bytes);
  exporter.openDoc(path, 'md');
}
```

### 11.4 增加新设置项

```js
// utils/settings.js ALL_DEFAULTS 里加一行：
ALL_DEFAULTS.maxLength = 5000;

// pages/settings/settings.js _renderRows() 里追加：
{ section: 'general', kind: 'number', label: '最大字符', valueKey: 'maxLength', value: s.maxLength }
```

### 11.5 更换字体

把新的 TTF 文件用 `tools/build-font.js`（项目根 utility）切割、Base64 后输出
到 `packageFontA/font-part{1,3}.js` 与 `packageFontB/font-part2.js`。
`app.js` 加载时会自动拼接三片。

---

## 12. 性能指标 / 待优化点

### 当前

| 指标                          | 实测参考值（i5 / Pixel 6）      |
| ----------------------------- | ------------------------------- |
| 冷启动首屏可视               | ≤ 600 ms（分包已预下载）        |
| convert() 1000 字             | < 60 ms                        |
| docx.build() 1000 字          | < 200 ms                       |
| pdf.build() 1000 字（带子集）| < 1.2 s                         |
| setData 单次渲染单元          | < 16 ms                        |

### 待优化

- Word/PDF 大文件（> 10 w 字）当前是同步一次性 setData；可以用分批渲染或 `web-worker`
  思路改造（基础库 ≥ 2.13）。
- 字体分片还可以进一步压缩：先用 brotli / gzip 处理再 Base64，节省 30%。

---

## 13. 常见问题

### Q1: 真机没看到"用其他应用打开"菜单？
确认 `wx.openDocument` 调用的 `showMenu: true`；iOS 14- 微信旧版可能不显示菜单，
升级微信客户端即可。

### Q2: 在 PC 体验版打开报"打开文档失败"？
PC 体验版没有关联应用所以 wx.openDocument 会失败。程序会自动在状态栏
提示"已保存到本地：…"，把文件路径发送给用户用文件传输助手取走。

### Q3: PDF 里某些生僻字显示为方块？
说明该字的 Unicode 不在 `packageData/data/pinyin.js` 内，引擎没有给其注音。
可以通过 `tools/build-data.js` 重新生成拼音库，把缺字读音补全。

### Q4: 多音字始终不准确？
扩展 `packageData/data/zdic.js`：加入更高频的常用词条，或添加行业 / 文学作品
领域词典。本项目已附 `phrase.js` 通用词典约 50 万条，覆盖大部分白话文。

### Q5: 怎么设置默认导出格式？
通过 `settings.set('exportFormat', 'pdf' | 'docx' | 'txt')`。当前 UI 已留 `exportFormat`
字段，将来可加入设置页单选。

---

— Made with ❤ for Chinese learners everywhere.
