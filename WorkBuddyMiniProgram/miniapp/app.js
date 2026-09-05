/**
 * 中文拼音助手 · 微信小程序入口
 * ─────────────────────────────────────────────────────────────
 * 启动流程：
 *  1. 加载设置（语言 / 字号 / 主题 / 默认参数）
 *  2. 并行加载 4 个分包：
 *      packageData   → data/pinyin.js    (单字拼音库 27000+ 字)
 *                     → data/zdic.js     (汉典词组库)
 *      packagePhrase → data/phrase.js    (常用词组库)
 *      packageFontA  → font-part1.js / font-part3.js
 *      packageFontB  → font-part2.js
 *  3. 加载方式：wx.loadSubpackage（按分包去重，每包仅一次）→ 同步 require → require.async 兜底（多端兼容）
 *  4. 所有分包就绪后，全局 engine = new pinyin.PinyinEngine() 并加载字典
 *  5. 已注册的 onReady 回调一次性获得 globalData（含 engine / wordCount / loadError）
 *
 *  注意：分包模块必须用「字面量路径」require，否则微信打包器（lazyCodeLoading 下）
 *  无法静态解析动态拼接路径，会抛 "module not found"，导致拼音库永远加载失败。
 */
'use strict';

var settings = require('./utils/settings');
var i18n = require('./utils/i18n');

// 分包清单（与 app.json 的 subpackages 的 root/name 保持一致）
var PACKAGE_MODULES = [
  { root: 'packageData',   name: 'data',   files: ['data/pinyin.js', 'data/zdic.js'] },
  { root: 'packagePhrase', name: 'phrase', files: ['data/phrase.js'] },
  { root: 'packageFontA',  name: 'fontA',  files: ['font-part1.js', 'font-part3.js'] },
  { root: 'packageFontB',  name: 'fontB',  files: ['font-part2.js'] }
];

var loadedModules = {};        // 完整路径 -> exports
var readyCallbacks = [];        // 启动期注册、等待 _fireReady 通知的回调
var loadedReady = false;        // 是否所有分包都加载成功
var fontBytes = null;           // Uint8Array（用于 PDF 嵌入）

/* 分包级去重：同一分包（pkg.name）在会话内只调用一次 wx.loadSubpackage。
   原因：对同一 pkg.name 并发调用两次 wx.loadSubpackage，第二次往往既不
   success 也不 fail（永不 settle），会触发超时并导致整个加载失败。
   因此这里用 subpackagePromises 缓存"每个分包只跑一次"的 Promise。 */
var subpackagePromises = {};        // pkgName -> Promise（同一分包只初始化一次）

function _ensureSubpackage(pkgName) {
  if (subpackagePromises[pkgName]) return subpackagePromises[pkgName];

  subpackagePromises[pkgName] = new Promise(function (resolve, reject) {
    var settled = false;
    var settleOnce = function (fn) { if (!settled) { settled = true; fn(); } };

    /* 真机分包：wx.loadSubpackage 一次性拉起整个分包，10s 超时防挂死 */
    if (typeof wx.loadSubpackage === 'function') {
      var to = setTimeout(function () {
        settleOnce(function () { reject(new Error('loadSubpackage timeout: ' + pkgName)); });
      }, 10000);
      wx.loadSubpackage({
        name: pkgName,
        success: function () { clearTimeout(to); settleOnce(resolve); },
        fail: function (e) { clearTimeout(to); settleOnce(function () { reject(e); }); }
      });
      return;
    }

    /* 无 loadSubpackage（dev 工具 / 主包 / 老基础库）：直接进入文件加载阶段 */
    settleOnce(resolve);
  });

  return subpackagePromises[pkgName];
}

/* 用「字面量路径」加载分包模块。
   必须为静态字符串，否则微信打包器（开启 lazyCodeLoading 时）无法把模块
   正确打进分包并生成模块记录，运行时 require 会抛 "module not found"。 */
function _requireLiteral(key) {
  switch (key) {
    case 'packageData/data/pinyin.js':   return require('./packageData/data/pinyin.js');
    case 'packageData/data/zdic.js':     return require('./packageData/data/zdic.js');
    case 'packagePhrase/data/phrase.js': return require('./packagePhrase/data/phrase.js');
    case 'packageFontA/font-part1.js':   return require('./packageFontA/font-part1.js');
    case 'packageFontA/font-part3.js':   return require('./packageFontA/font-part3.js');
    case 'packageFontB/font-part2.js':   return require('./packageFontB/font-part2.js');
    default: throw new Error('unknown module key: ' + key);
  }
}

/* 单文件加载：先确保所属分包就绪（去重后只 loadSubpackage 一次），
   再 require 该文件。优先同步 require（分包就绪后最可靠）；
   失败才回退 require.async（老基础库/主包）。 */
function _loadOne(pkg, rel) {
  var key = pkg.root + '/' + rel;

  return _ensureSubpackage(pkg.name).then(function () {
    try {
      loadedModules[key] = _requireLiteral(key);
      return loadedModules[key];
    } catch (e1) {
      /* 同步失败（如老基础库）：尝试 require.async 兜底 */
      if (typeof require.async === 'function') {
        return new Promise(function (resolve, reject) {
          var settled = false;
          var settleOnce = function (fn) { if (!settled) { settled = true; fn(); } };
          var to2 = setTimeout(function () {
            settleOnce(function () { reject(new Error('require.async timeout: ' + key)); });
          }, 10000);
          require.async('./' + key).then(function (mod) {
            clearTimeout(to2);
            loadedModules[key] = mod;
            settleOnce(function () { resolve(mod); });
          }, function (err) {
            clearTimeout(to2);
            settleOnce(function () { reject(err); });
          });
        });
      }
      throw e1;
    }
  });
}

function loadAll() {
  var tasks = [];
  PACKAGE_MODULES.forEach(function (pkg) {
    pkg.files.forEach(function (f) {
      tasks.push(_loadOne(pkg, f));
    });
  });
  return Promise.all(tasks);
}

/* 把全局数据回传给所有注册的回调（成功路径） */
function _fireReady(gd) {
  var cbs = readyCallbacks.slice();
  readyCallbacks = [];
  cbs.forEach(function (cb) {
    try { cb(gd); } catch (e) { /* ignore */ }
  });
}

/* 真正执行「加载 4 个分包 + 初始化引擎」，onLaunch 与 reload 共用。 */
function _startLoad(app) {
  loadedReady = false;
  app.globalData.ready = false;
  app.globalData.loadError = null;

  loadAll().then(function () {
    try {
      var pinyin = require('./utils/pinyin');
      var base64 = require('./utils/base64');

      var engine = new pinyin.PinyinEngine();
      var ok = engine.loadCharObject(loadedModules['packageData/data/pinyin.js']);
      var w1 = engine.loadWordObject(loadedModules['packagePhrase/data/phrase.js']);
      var w2 = engine.loadWordObject(loadedModules['packageData/data/zdic.js']);

      app.globalData.engine = engine;
      app.globalData.wordCount = w1 + w2;
      app.globalData.charOk = !!ok;

      /* 预解码字体分片缓存，便于 PDF 立即使用 */
      try {
        var b64 = loadedModules['packageFontA/font-part1.js'] +
                  loadedModules['packageFontB/font-part2.js'] +
                  loadedModules['packageFontA/font-part3.js'];
        fontBytes = base64.decode(b64);
        app.globalData.fontBytes = fontBytes;
      } catch (e) { fontBytes = null; app.globalData.fontBytes = null; }

      loadedReady = true;
      app.globalData.ready = true;
    } catch (e) {
      app.globalData.loadError = e;
    }
    /* 无论成败都通知所有页面，避免永远停在"加载中" */
    _fireReady(app.globalData);
  }, function (err) {
    app.globalData.loadError = err;
    _fireReady(app.globalData);
  });
}

App({
  globalData: {
    ready: false,
    loadError: null,
    loadedModules: loadedModules,
    fontBytes: null,
    wordCount: 0,
    charOk: false,
    engine: null
  },

  onLaunch: function () {
    /* 1. settings.boot() 加载持久化设置 */
    try { settings.boot(); } catch (e) { /* ignore */ }
    /* 2. 主题刷新 + 监听系统主题变化 */
    try {
      var theme = require('./utils/theme');
      theme.refresh();
      theme.onSystemThemeChange(function () { theme.refresh(); });
    } catch (e) { /* ignore */ }

    var self = this;
    _startLoad(self);
  },

  /**
   * 任意页面 onLoad 中调用：app.onReady(cb)，已就绪立即回调。
   * 回调签名：cb(globalData)，其中 globalData 含 engine / wordCount / loadError。
   */
  onReady: function (cb) {
    if (loadedReady || this.globalData.loadError) {
      try { cb(this.globalData); } catch (e) { /* ignore */ }
      return;
    }
    if (typeof cb === 'function') readyCallbacks.push(cb);
  },

  /**
   * 加载失败后重试：清空分包 Promise 缓存，重新 loadSubpackage + 初始化。
   * 页面可传入新的回调（如 retry 后刷新 UI）。
   */
  reload: function (cb) {
    subpackagePromises = {};
    loadedModules = {};
    this.globalData.loadedModules = loadedModules;
    if (typeof cb === 'function') readyCallbacks.push(cb);
    _startLoad(this);
  }
});
