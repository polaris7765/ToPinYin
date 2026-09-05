/**
 * 主页：输入中文 → 转换 → 三种显示方式 → 复制 / 导出 Word / PDF / 文本
 * ─────────────────────────────────────────────────────────────
 *  - 多语言：所有 UI 文案通过 i18n.t() 取；订阅 settings.onChange 实时刷新
 *  - 字号：fontScale 通过 CSS 变量驱动，无需重新 setData
 *  - 主题：theme.refresh() 计算 CSS 变量并 setData 到 page 根节点 style
 *  - 状态：resultReady / loading / status 三状态控制按钮可用性
 */
'use strict';

var pinyin = require('../../utils/pinyin');
var docx = require('../../utils/docx');
var pdf = require('../../utils/pdf');
var exporter = require('../../utils/exporter');
var settings = require('../../utils/settings');
var i18n = require('../../utils/i18n');
var theme = require('../../utils/theme');

var app = getApp();

function t(key, vars) { return i18n.t(key, vars); }

/* 把 settings 中的所有选项转成 UI 用数据：toneOptions / modeOptions。 */
function _buildOptions() {
  return [
    { key: '0', label: t('input.tone.symbol') },
    { key: '1', label: t('input.tone.number') },
    { key: '2', label: t('input.tone.none') },
  ];
}
function _buildModeOptions() {
  return [
    { key: '0', label: t('input.mode.annotated') },
    { key: '1', label: t('input.mode.inline') },
    { key: '2', label: t('input.mode.only') },
  ];
}

Page({
  data: {
    /* i18n 文案集合（一并塞到 data 中，WXML 直接绑定） */
    i18n: {
      inputTitle: '',
      inputPlaceholder: '',
      toneLabel: '',
      modeLabel: '',
      uvLabel: '',
      convertLabel: '',
      clearLabel: '',
      outputTitle: '',
      emptyHint: '',
      copyLabel: '',
      exportWordLabel: '',
      exportPdfLabel: '',
      exportTextLabel: '',
      privacy: '',
    },
    toneOptions: [],
    modeOptions: [],

    /* 表单状态 */
    input: '',
    charCount: '0 字',
    toneIndex: 0,
    modeIndex: 0,
    uAsV: true,

    /* 运行时状态 */
    ready: false,
    loadFailed: false,
    resultReady: false,
    wordCount: 0,
    status: '正在初始化…',

    /* 输出数据（任选一种模式） */
    annLines: [],
    inlineText: '',
    pinyinOnlyText: '',

    /* 主题 CSS（注入到根 view 的 style） */
    themeStyle: '',
    themeIsDark: false,

    /* 安全区：状态栏高度 + 右侧胶囊（●●●）保留的内边距 */
    headerRightPad: 24,
  },

  /* engine 实例缓存 */
  _result: null,

  onLoad: function () {
    /* 一次性初始化：i18n / settings 都已 boot 后可以加载默认设置 */
    try { settings.boot(); } catch (e) { /* ignore */ }
    /* 读取系统状态栏高度 + 微信右上角胶囊（●●●）位置：自定义导航下，
       ① 容器顶部要让出 statusBarHeight 避免和系统状态栏重叠；
       ② 头部右侧要让出胶囊宽度，避免自定义按钮被胶囊挡住。 */
    try {
      var info = wx.getSystemInfoSync && wx.getSystemInfoSync();
      this._statusBarHeight = (info && info.statusBarHeight) ? info.statusBarHeight : 0;
      this._screenWidth = (info && info.screenWidth) ? info.screenWidth : 375;
    } catch (e) { this._statusBarHeight = 0; this._screenWidth = 375; }
    try {
      var rect = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      if (rect && rect.left) {
        /* 胶囊左侧到屏幕右边的距离 + 8px 缓冲 = 头部需要的右侧内边距 */
        this._headerRightPad = Math.max(0, this._screenWidth - rect.left + 8);
      } else {
        this._headerRightPad = 24;
      }
    } catch (e) { this._headerRightPad = 24; }
    this._initTheme();
    this._initFromSettings();
    this._refreshI18n();
    this._refreshStatus();
    /* 注册 settings / i18n 监听 */
    var self = this;
    settings.onChange(function () {
      self._initTheme();
      self._initFromSettings();
      self._refreshI18n();
      self._refreshStatus();
      if (self._result) self._render();
    });
    i18n.onChange(function () {
      self._refreshI18n();
      self._refreshStatus();
      if (self._result) self._render();
    });
    app.onReady(this._onReady.bind(this));
  },

  /* 在小程序 onShow 中刷新（i18n 可能在设置页改过） */
  onShow: function () {
    /* 主题 + 字号可能改了 */
    this._initTheme();
    this._initFromSettings();
    this._refreshI18n();
    if (this._result) this._render();
  },

  _initTheme: function () {
    var style = theme.refresh();
    /* 顶部蓝色背景由 .header 自己覆盖，容器不再加 padding-top */
    this.setData({
      themeStyle: style,
      statusBarHeight: this._statusBarHeight || 0,
      headerRightPad: this._headerRightPad || 24,
      themeIsDark: theme.getTheme() === 'dark',
      navigationBarTextStyle: theme.getTheme() === 'dark' ? 'white' : 'black'
    });
  },

  _initFromSettings: function () {
    var s = settings.all();
    this.setData({
      toneIndex: s.defaultTone,
      modeIndex: s.defaultMode,
      uAsV: s.uAsV,
      charCount: s.lastInput ? s.lastInput.length + ' 字' : '0 字',
      input: s.keepHistory ? s.lastInput : '',
    });
  },

  _refreshI18n: function () {
    this.setData({
      i18n: {
        headerTitle:           t('header.title'),
        inputTitle:           t('input.title'),
        inputPlaceholder:     t('input.placeholder'),
        toneLabel:            t('input.tone'),
        modeLabel:            t('input.mode'),
        uvLabel:              t('input.uvLabel'),
        convertLabel:         t('input.convert'),
        clearLabel:           t('input.clear'),
        outputTitle:          t('output.title'),
        emptyHint:            t('output.emptyHint'),
        copyLabel:            t('output.copy'),
        exportWordLabel:      t('output.exportWord'),
        exportPdfLabel:       t('output.exportPdf'),
        exportTextLabel:      t('output.exportText'),
        privacy:              t('footer.privacy'),
        headerSubtitle:       t('header.subtitle'),
      },
      toneOptions: _buildOptions(),
      modeOptions: _buildModeOptions(),
    });
    wx.setNavigationBarTitle({ title: t('common.appName') });
  },

  /* 根据当前状态重新生成底部状态栏文本，确保与当前语言一致 */
  _refreshStatus: function () {
    var s = '';
    if (this.data.loadFailed) {
      var err = this._loadError;
      var msg = (err && err.message) ? err.message : (err ? String(err) : '未知错误');
      s = '拼音库加载失败：' + msg + '。可点下方「重试加载」。';
    } else if (!this.data.ready) {
      s = t('output.statusReady');
    } else if (this._result && this._result.cjkCharCount) {
      s = t('output.statusDone', { n: this._result.cjkCharCount });
    } else {
      s = t('output.statusEngineReady', { n: this.data.wordCount || 0 });
    }
    this.setData({ status: s });
  },

  /* 拼音引擎加载完成 */
  _onReady: function (gd) {
    if (!gd || gd.loadError) {
      var msg = (gd && gd.loadError && gd.loadError.message)
        ? gd.loadError.message
        : (gd && gd.loadError ? String(gd.loadError) : '未知错误');
      this._loadError = (gd ? gd.loadError : null);
      this.setData({
        ready: false,
        loadFailed: true,
        status: '拼音库加载失败：' + msg + '。可点下方「重试加载」。'
      });
      return;
    }
    this.setData({
      ready: true,
      loadFailed: false,
      wordCount: gd.wordCount || 0,
      status: t('output.statusEngineReady', { n: gd.wordCount || 0 })
    });
  },

  /* 加载失败后「重试加载」：重新拉起分包并初始化引擎 */
  onRetry: function () {
    if (this.data.ready) return;
    this.setData({ loadFailed: false, status: '正在重新加载拼音库…' });
    var self = this;
    app.reload(function (gd) { self._onReady(gd); });
  },

  /* ---------------- 表单事件 ---------------- */

  onInput: function (e) {
    var v = e.detail.value || '';
    this.setData({
      input: v,
      charCount: t('input.charCount', { n: v.length })
    });
    if (settings.get('keepHistory')) settings.set('lastInput', v);
  },

  onToneChange: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    this.setData({ toneIndex: idx });
    settings.set('defaultTone', idx);
    if (this._result) this._render();
  },

  onModeChange: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    this.setData({ modeIndex: idx });
    settings.set('defaultMode', idx);
    if (this._result) this._render();
  },

  onUVChange: function (e) {
    this.setData({ uAsV: !!e.detail.value });
    settings.set('uAsV', !!e.detail.value);
    if (this._result) this._render();
  },

  onClear: function () {
    this._result = null;
    if (settings.get('keepHistory')) settings.set('lastInput', '');
    this.setData({
      input: '',
      charCount: t('input.charCount', { n: 0 }),
      annLines: [],
      inlineText: '',
      pinyinOnlyText: '',
      resultReady: false,
      status: '已清空。'
    });
  },

  /* ---------------- 转换 ---------------- */

  onConvert: function () {
    if (!this.data.ready) {
      this.setData({ status: t('output.statusEngineLoading') });
      return;
    }
    var text = this.data.input;
    if (!text || !text.trim()) {
      this.setData({ status: t('output.statusEmpty') });
      return;
    }
    try {
      this._result = app.globalData.engine.convert(text);
      this._render();
      this.setData({
        charCount: this._result.cjkCharCount + ' 汉字 · ' + this._result.totalCharCount + ' 字',
        resultReady: true,
        status: t('output.statusDone', { n: this._result.cjkCharCount })
      });
    } catch (e) {
      this.setData({ status: t('output.statusError', { msg: (e && e.message ? e.message : e) }) });
    }
  },

  _tone: function () {
    var idx = this.data.toneIndex;
    return idx === 0 ? pinyin.ToneStyle.Symbol : (idx === 1 ? pinyin.ToneStyle.Number : pinyin.ToneStyle.None);
  },

  _render: function () {
    var result = this._result;
    var tone = this._tone();
    var uAsV = this.data.uAsV;

    if (this.data.modeIndex === 0) {
      // 逐字标注
      var lines = [];
      for (var li = 0; li < result.lines.length; li++) {
        var srcLine = result.lines[li];
        var units = [];
        var ui = 0;
        if (srcLine.tokens.length === 0) {
          units.push({ id: 'u' + (ui++), type: 'plain', text: '\u00a0' });
        } else {
          for (var ti = 0; ti < srcLine.tokens.length; ti++) {
            var t = srcLine.tokens[ti];
            if (!t.isCjk) {
              units.push({ id: 'u' + (ui++), type: 'plain', text: t.source });
            } else {
              for (var k = 0; k < t.items.length; k++) {
                var cp = t.items[k];
                var py = pinyin.PinyinEngine.render(cp.pinyin, tone, uAsV);
                units.push({ id: 'u' + (ui++), type: 'cjk', top: py, base: cp.char });
              }
            }
          }
        }
        lines.push({ id: 'L' + li, units: units });
      }
      this.setData({ annLines: lines, inlineText: '', pinyinOnlyText: '' });
    } else if (this.data.modeIndex === 1) {
      this.setData({
        annLines: [],
        inlineText: pinyin.PinyinEngine.renderParenthesis(result, tone, uAsV),
        pinyinOnlyText: ''
      });
    } else {
      this.setData({
        annLines: [],
        inlineText: '',
        pinyinOnlyText: pinyin.PinyinEngine.renderResult(result, tone, uAsV, false, ' ')
      });
    }
  },

  /* ---------------- 顶部按钮 ---------------- */

  goSettings: function () {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  goAbout: function () {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  /* ---------------- 导出 ---------------- */

  _ensureResult: function () {
    if (!this._result || this._result.totalCharCount === 0) {
      this.setData({ status: t('output.statusConvertFirst') });
      return false;
    }
    return true;
  },

  _exportOpts: function () {
    return { toneStyle: this._tone(), uAsV: this.data.uAsV, timestamp: exporter.nowStr() };
  },

  _openOpts: function () {
    return { openAfterExport: settings.get('openAfterExport') };
  },

  onCopy: function () {
    if (!this._ensureResult()) return;
    var body = pinyin.PinyinEngine.renderParenthesis(this._result, this._tone(), this.data.uAsV);
    var self = this;
    exporter.copyText(body, function (msg) {
      self.setData({ status: msg });
      wx.showToast({ title: t('toast.copied'), icon: 'success', duration: 1200 });
    });
  },

  onExportWord: function () {
    if (!this._ensureResult()) return;
    var self = this;
    try {
      var bytes = docx.build(this._result, this._exportOpts());
      exporter.generateAndOpen('拼音对照_' + exporter.stamp() + '.docx', bytes, 'docx', function (msg) {
        self.setData({ status: msg });
      }, this._openOpts());
    } catch (e) {
      this.setData({ status: t('output.statusExportFailed', { msg: (e && e.message ? e.message : e) }) });
    }
  },

  onExportPdf: function () {
    if (!this._ensureResult()) return;
    var self = this;
    try {
      var fb = app.globalData.fontBytes;
      if (!fb) {
        this.setData({ status: t('output.statusExportFailed', { msg: 'font unavailable' }) });
        return;
      }
      var bytes = pdf.build(this._result, this._exportOpts(), fb);
      exporter.generateAndOpen('拼音对照_' + exporter.stamp() + '.pdf', bytes, 'pdf', function (msg) {
        self.setData({ status: msg });
      }, this._openOpts());
    } catch (e) {
      this.setData({ status: t('output.statusExportFailed', { msg: (e && e.message ? e.message : e) }) });
    }
  },

  onExportTxt: function () {
    if (!this._ensureResult()) return;
    var self = this;
    try {
      var body = pinyin.PinyinEngine.renderParenthesis(this._result, this._tone(), this.data.uAsV);
      var fileName = '拼音对照_' + exporter.stamp() + '.txt';
      var filePath = exporter.saveBytes(fileName, exporter.utf8.encode(body));
      if (settings.get('openAfterExport')) {
        exporter.openDoc(filePath, 'txt', function (msg) { self.setData({ status: msg }); });
      } else {
        self.setData({ status: t('output.statusExportText', { name: fileName }) });
      }
      // 再复制一份到剪贴板方便纯文本分享
      exporter.copyText(body, function () { });
    } catch (e) {
      this.setData({ status: t('output.statusExportFailed', { msg: (e && e.message ? e.message : e) }) });
    }
  },
});
