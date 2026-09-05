/**
 * 中文拼音助手 · 小程序入口
 * 启动时并行加载 4 个分包（数据 + 字体），完成后置 ready。
 * 加载方式：require.async（基础库 2.14.4+）→ wx.loadSubpackage 兜底 → 同步 require 兜底。
 */
'use strict';

// 分包清单（与 app.json 的 subpackages 的 root/name 保持一致）
var PACKAGE_MODULES = [
  { root: 'packageData', name: 'data', files: ['data/pinyin.js', 'data/zdic.js'] },
  { root: 'packagePhrase', name: 'phrase', files: ['data/phrase.js'] },
  { root: 'packageFontA', name: 'fontA', files: ['font-part1.js', 'font-part3.js'] },
  { root: 'packageFontB', name: 'fontB', files: ['font-part2.js'] }
];

var loadedModules = {}; // 完整路径 -> exports

function loadOne(pkgRoot, rel) {
  // 相对路径（微信运行时与 Node 模拟均按当前文件解析）
  var reqPath = './' + pkgRoot + '/' + rel;
  var key = pkgRoot + '/' + rel;
  return new Promise(function (resolve, reject) {
    if (typeof require.async === 'function') {
      require.async(reqPath).then(function (mod) {
        loadedModules[key] = mod;
        resolve(mod);
      }, function (err) { reject(err); });
    } else if (wx.loadSubpackage) {
      wx.loadSubpackage({
        name: pkg.name,
        success: function () {
          try {
            loadedModules[key] = require(reqPath);
            resolve(loadedModules[key]);
          } catch (e) { reject(e); }
        },
        fail: function (e) { reject(e); }
      });
    } else {
      try {
        loadedModules[key] = require(reqPath);
        resolve(loadedModules[key]);
      } catch (e) { reject(e); }
    }
  });
}

function loadAll() {
  var tasks = [];
  PACKAGE_MODULES.forEach(function (pkg) {
    pkg.files.forEach(function (f) {
      tasks.push(loadOne(pkg.root, f));
    });
  });
  return Promise.all(tasks);
}

App({
  globalData: {
    ready: false,
    loadError: null,
    loadedModules: loadedModules,
    // 运行时缓存
    fontBytes: null,     // Uint8Array（由 font-part 解码）
    engine: null         // PinyinEngine 实例
  },

  onLaunch: function () {
    var self = this;
    loadAll().then(function () {
      self.globalData.ready = true;
      // 通知已注册的回调
      if (self._readyCallbacks) {
        self._readyCallbacks.forEach(function (cb) { cb(); });
        self._readyCallbacks = [];
      }
    }, function (err) {
      self.globalData.loadError = err;
      if (self._readyCallbacks) {
        self._readyCallbacks.forEach(function (cb) { cb(); });
        self._readyCallbacks = [];
      }
    });
  },

  /** 页面在 onLoad 注册就绪回调；已就绪则立即回调。 */
  onReady: function (cb) {
    if (this.globalData.ready) { cb(); return; }
    this._readyCallbacks = this._readyCallbacks || [];
    this._readyCallbacks.push(cb);
  }
});
