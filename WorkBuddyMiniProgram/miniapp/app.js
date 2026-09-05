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
var loadedReady = false;       // 是否所有分包都加载成功
var fontBytes = null;          // Uint8Array（用于 PDF 嵌入）

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

/* 单文件加载：先确保所属分包就绪（去重后只 loadSubpackage 一次），
   再 require 该文件。优先同步 require（分包就绪后最可靠）；
   失败才回退 require.async（老基础库/主包）。 */
function _loadOne(pkg, rel) {
  var pkgRoot = pkg.root;
  var reqPath = './' + pkgRoot + '/' + rel;
  var key = pkgRoot + '/' + rel;

  return _ensureSubpackage(pkg.name).then(function () {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var settleOnce = function (fn) { if (!settled) { settled = true; fn(); } };

      /* 分包已就绪，优先同步 require */
      try {
        loadedModules[key] = require(reqPath);
        settleOnce(function () { resolve(loadedModules[key]); });
        return;
      } catch (e) {
        /* 同步失败（如老基础库）：尝试 require.async 兜底 */
        if (typeof require.async === 'function') {
          var to2 = setTimeout(function () {
            settleOnce(function () { reject(new Error('require.async timeout: ' + reqPath)); });
          }, 10000);
          require.async(reqPath).then(function (mod) {
            clearTimeout(to2);
            loadedModules[key] = mod;
            settleOnce(function () { resolve(mod); });
          }, function (err) {
            clearTimeout(to2);
            settleOnce(function () { reject(err); });
          });
          return;
        }
        settleOnce(function () { reject(e); });
      }
    });
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

App({
  globalData: {
    ready: false,
    loadError: null,
    loadedModules: loadedModules,
    fontBytes: null,
    wordCount: 0,
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

    /* 3. 异步加载 4 个分包并初始化拼音引擎 */
    loadAll().then(function () {
      try {
        var pinyin = require('./utils/pinyin');
        var base64 = require('./utils/base64');

        var engine = new pinyin.PinyinEngine();
        var ok = engine.loadCharObject(loadedModules['packageData/data/pinyin.js']);
        var w1 = engine.loadWordObject(loadedModules['packagePhrase/data/phrase.js']);
        var w2 = engine.loadWordObject(loadedModules['packageData/data/zdic.js']);

        self.globalData.engine = engine;
        self.globalData.wordCount = w1 + w2;

        /* 预解码字体分片缓存，便于 PDF 立即使用 */
        try {
          var b64 = loadedModules['packageFontA/font-part1.js'] +
                    loadedModules['packageFontB/font-part2.js'] +
                    loadedModules['packageFontA/font-part3.js'];
          fontBytes = base64.decode(b64);
          self.globalData.fontBytes = fontBytes;
        } catch (e) { fontBytes = null; }

        loadedReady = true;
        self.globalData.ready = true;
      } catch (e) {
        self.globalData.loadError = e;
      }
      /* 无论成败都通知所有页面，避免永远停在"加载中" */
      _fireReady(self.globalData);
    }, function (err) {
      self.globalData.loadError = err;
      _fireReady(self.globalData);
    });
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
  }
});