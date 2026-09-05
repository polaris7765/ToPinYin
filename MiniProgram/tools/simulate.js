#!/usr/bin/env node
/**
 * 小程序运行时模拟测试：在 Node 中模拟 wx / App / Page / getApp，
 * 端到端验证：启动加载分包 → 页面就绪 → 转换 → 三种显示 → 导出 Word/PDF/文本。
 * 说明：模拟环境走 app.js 的同步 require 兜底分支（require.async / loadSubpackage 不存在时）。
 */
'use strict';

var path = require('path');
var fs = require('fs');

var MINI = path.resolve(__dirname, '..');

// ---------- mock wx ----------
var written = {}; // 文件名 -> Buffer
var fsManager = {
  accessSync: function () { throw new Error('not exists'); },
  mkdirSync: function () {},
  writeFileSync: function (filePath, data) { written[filePath] = Buffer.from(data); }
};
global.wx = {
  env: { USER_DATA_PATH: '/mock/user' },
  getFileSystemManager: function () { return fsManager; },
  showLoading: function () {},
  hideLoading: function () {},
  openDocument: function (o) { o.success && o.success({ errMsg: 'ok' }); },
  setClipboardData: function (o) { o.success && o.success({}); },
  shareFileMessage: function (o) { o.success && o.success({}); },
  showModal: function (o) { o.success && o.success({ confirm: false }); }
};

// ---------- mock App/Page/getApp ----------
var appConfig = null, pageConfig = null, appInstance = null;
global.App = function (c) { appConfig = c; };
global.Page = function (c) { pageConfig = c; };
global.getApp = function () { return appInstance; };

// ---------- 加载 app.js ----------
require(path.join(MINI, 'app.js'));
// 与真实运行时一致：App 配置对象即实例，globalData 保持同一引用
// （app.js 模块作用域的 loadedModules 与 globalData.loadedModules 是同一对象）
appInstance = Object.assign({}, appConfig, {
  globalData: appConfig.globalData
});
appInstance.onLaunch();
// onReady 注册回调
appInstance._readyCallbacks = [];

// 等待异步加载（同步 require 兜底，微任务完成）
setTimeout(function () {
  // ---------- 加载页面 ----------
  require(path.join(MINI, 'pages/index/index.js'));
  var page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData: function (obj) { Object.assign(this.data, obj); }
  });

  page.onLoad();
  console.log('[页面] ready =', page.data.ready, '| status =', page.data.status);
  if (!page.data.ready) { console.error('✗ 页面未就绪'); process.exit(1); }

  // ---------- 转换 ----------
  page.setData({ input: '你好，世界！这是中文拼音转换应用。\n多音字消歧示例：银行 长大 音乐 重要 快乐 行走 干净 方便 重庆 校长 长度。' });
  page.onConvert();
  console.log('[转换] status =', page.data.status);
  console.log('[转换] 逐字标注单元数:', page.data.annLines.length, '行');
  console.log('[转换] 首行首单元:', JSON.stringify(page.data.annLines[0].units.slice(0, 3)));

  // 切换显示方式
  page.setData({ modeIndex: 1 });
  page.onModeChange({ currentTarget: { dataset: { index: 1 } } });
  var inline = page.data.inlineText;
  console.log('[行内] 前 60 字符:', inline.substring(0, 60));
  if (inline.indexOf('银(yín)行(háng)') < 0) { console.error('✗ 行内对照多音字错误'); process.exit(1); }

  page.setData({ modeIndex: 2 });
  page.onModeChange({ currentTarget: { dataset: { index: 2 } } });
  console.log('[仅拼音] 前 60 字符:', page.data.pinyinOnlyText.substring(0, 60));

  // 数字声调 + ü→v（当前显示模式为「仅拼音」，检查 pinyinOnlyText）
  page.setData({ toneIndex: 1 });
  page.onToneChange({ currentTarget: { dataset: { index: 1 } } });
  page.setData({ uAsV: true });
  page.onUVChange({ detail: { value: true } });
  var onlyNum = page.data.pinyinOnlyText;
  console.log('[数字声调] 仅拼音前 40:', onlyNum.substring(0, 40));
  if (onlyNum.indexOf('ni3 hao3') < 0) { console.error('✗ 数字声调输出错误'); process.exit(1); }

  // ---------- 导出 Word ----------
  written = {};
  page.onExportWord();
  setTimeout(function () {
    var docxFiles = Object.keys(written).filter(function (k) { return /\.docx$/.test(k); });
    console.log('[导出Word] 文件:', docxFiles[0] || '无', '| 大小:', docxFiles[0] ? written[docxFiles[0]].length : 0);
    if (docxFiles[0] && written[docxFiles[0]].length > 10000) console.log('  Word 生成 ✓');
    else { console.error('✗ Word 导出失败'); process.exit(1); }

    // ---------- 导出 PDF ----------
    written = {};
    page.onExportPdf();
    setTimeout(function () {
      var pdfFiles = Object.keys(written).filter(function (k) { return /\.pdf$/.test(k); });
      console.log('[导出PDF] 文件:', pdfFiles[0] || '无', '| 大小:', pdfFiles[0] ? written[pdfFiles[0]].length : 0);
      if (pdfFiles[0] && written[pdfFiles[0]].length > 1000) console.log('  PDF 生成 ✓');
      else { console.error('✗ PDF 导出失败'); process.exit(1); }

      // ---------- 导出文本 ----------
      written = {};
      page.onExportTxt();
      var txtFiles = Object.keys(written).filter(function (k) { return /\.txt$/.test(k); });
      console.log('[导出文本] 文件:', txtFiles[0] || '无', '| 大小:', txtFiles[0] ? written[txtFiles[0]].length : 0);
      if (txtFiles[0] && written[txtFiles[0]].length > 0) {
        var txt = written[txtFiles[0]].toString('utf8');
        console.log('  文本内容前 50:', txt.substring(0, 50));
        if (txt.indexOf('银(yin2)行(hang2)') >= 0) console.log('  文本生成 ✓');
        else { console.error('✗ 文本内容错误'); process.exit(1); }
      } else { console.error('✗ 文本导出失败'); process.exit(1); }

      console.log('ALL SIMULATION DONE');
      process.exit(0);
    }, 120);
  }, 120);
}, 120);
