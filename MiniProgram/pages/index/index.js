/**
 * 主页面：输入中文 → 转换 → 三种显示方式 → 导出 Word / PDF / 文本 / 复制
 * 功能与 Unity 版「中文拼音助手」完全对齐。
 */
'use strict';

var pinyin = require('../../utils/pinyin');
var docx = require('../../utils/docx');
var pdf = require('../../utils/pdf');
var base64 = require('../../utils/base64');
var exporter = require('../../utils/exporter');

var app = getApp();

Page({
  data: {
    input: '',
    charCount: '0 字',
    toneIndex: 0,
    modeIndex: 0,
    uAsV: true,
    ready: false,        // 拼音库是否就绪
    resultReady: false,  // 是否有可导出的结果
    toneOptions: ['带声调 ā', '数字 a1', '无声调'],
    modeOptions: ['逐字标注', '行内对照', '仅拼音'],
    annLines: [],
    inlineText: '',
    pinyinOnlyText: '',
    status: '正在初始化…'
  },

  _result: null,

  onLoad: function () {
    app.onReady(this._onReady.bind(this));
  },

  _onReady: function () {
    var gd = app.globalData;
    if (gd.loadError) {
      this.setData({ status: '拼音库加载失败，请重启小程序重试。' });
      return;
    }
    try {
      var engine = new pinyin.PinyinEngine();
      engine.loadCharObject(gd.loadedModules['packageData/data/pinyin.js']);
      var w1 = engine.loadWordObject(gd.loadedModules['packagePhrase/data/phrase.js']);
      var w2 = engine.loadWordObject(gd.loadedModules['packageData/data/zdic.js']);
      gd.engine = engine;
      this.setData({
        ready: true,
        status: '拼音库就绪 · 词条 ' + (w1 + w2) + ' · 请输入中文后点击「转换」'
      });
    } catch (e) {
      this.setData({ status: '拼音库加载失败：' + (e && e.message ? e.message : e) });
    }
  },

  // ---------------- 输入与选项 ----------------

  onInput: function (e) {
    var v = e.detail.value || '';
    this.setData({ input: v, charCount: v.length + ' 字' });
  },

  onToneChange: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    this.setData({ toneIndex: idx });
    if (this._result) this._render();
  },

  onModeChange: function (e) {
    var idx = Number(e.currentTarget.dataset.index);
    this.setData({ modeIndex: idx });
    if (this._result) this._render();
  },

  onUVChange: function (e) {
    this.setData({ uAsV: !!e.detail.value });
    if (this._result) this._render();
  },

  _tone: function () {
    var idx = this.data.toneIndex;
    return idx === 0 ? pinyin.ToneStyle.Symbol : (idx === 1 ? pinyin.ToneStyle.Number : pinyin.ToneStyle.None);
  },

  // ---------------- 转换 ----------------

  onConvert: function () {
    if (!this.data.ready) { this.setData({ status: '拼音库仍在加载，请稍候…' }); return; }
    var text = this.data.input;
    if (!text.trim()) { this.setData({ status: '请先输入中文内容。' }); return; }
    try {
      this._result = app.globalData.engine.convert(text);
      this._render();
      this.setData({
        charCount: this._result.cjkCharCount + ' 汉字 · ' + this._result.totalCharCount + ' 字',
        resultReady: true,
        status: '转换完成：' + this._result.cjkCharCount + ' 个汉字。可点击下方按钮导出。'
      });
    } catch (e) {
      this.setData({ status: '转换出错：' + (e && e.message ? e.message : e) });
    }
  },

  onClear: function () {
    this._result = null;
    this.setData({
      input: '',
      charCount: '0 字',
      annLines: [],
      inlineText: '',
      pinyinOnlyText: '',
      resultReady: false,
      status: '已清空。'
    });
  },

  // ---------------- 渲染 ----------------

  _render: function () {
    var result = this._result;
    var tone = this._tone();
    var uAsV = this.data.uAsV;

    if (this.data.modeIndex === 0) {
      // 逐字标注：拼音在上、汉字在下
      var lines = [];
      for (var li = 0; li < result.lines.length; li++) {
        var srcLine = result.lines[li];
        var units = [];
        var ui = 0;
        if (srcLine.tokens.length === 0) {
          units.push({ type: 'plain', id: 'u' + ui, text: '\u00a0' });
        } else {
          for (var ti = 0; ti < srcLine.tokens.length; ti++) {
            var t = srcLine.tokens[ti];
            if (!t.isCjk) {
              units.push({ type: 'plain', id: 'u' + (ui++), text: t.source });
            } else {
              for (var k = 0; k < t.items.length; k++) {
                var cp = t.items[k];
                var py = pinyin.PinyinEngine.render(cp.pinyin, tone, uAsV);
                units.push({ type: 'cjk', id: 'u' + (ui++), top: py, base: cp.char });
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

  // ---------------- 导出 ----------------

  _ensureResult: function () {
    if (!this._result || this._result.totalCharCount === 0) {
      this.setData({ status: '请先输入中文并点击「转换」。' });
      return false;
    }
    return true;
  },

  _exportOpts: function () {
    return { toneStyle: this._tone(), uAsV: this.data.uAsV, timestamp: exporter.nowStr() };
  },

  onCopy: function () {
    if (!this._ensureResult()) return;
    var body = pinyin.PinyinEngine.renderParenthesis(this._result, this._tone(), this.data.uAsV);
    var self = this;
    exporter.copyText(body, function (msg) { self.setData({ status: msg }); });
  },

  onExportWord: function () {
    if (!this._ensureResult()) return;
    var self = this;
    try {
      var bytes = docx.build(this._result, this._exportOpts());
      exporter.generateAndOpen('拼音对照_' + exporter.stamp() + '.docx', bytes, 'docx', function (msg) {
        self.setData({ status: msg });
      });
    } catch (e) {
      this.setData({ status: '导出 Word 失败：' + (e && e.message ? e.message : e) });
    }
  },

  onExportPdf: function () {
    if (!this._ensureResult()) return;
    var self = this;
    try {
      var fontBytes = this._ensureFont();
      var bytes = pdf.build(this._result, this._exportOpts(), fontBytes);
      exporter.generateAndOpen('拼音对照_' + exporter.stamp() + '.pdf', bytes, 'pdf', function (msg) {
        self.setData({ status: msg });
      });
    } catch (e) {
      this.setData({ status: '导出 PDF 失败：' + (e && e.message ? e.message : e) });
    }
  },

  /** 惰性解码字体分片（只做一次）。 */
  _ensureFont: function () {
    var gd = app.globalData;
    if (gd.fontBytes) return gd.fontBytes;
    var b64 = gd.loadedModules['packageFontA/font-part1.js'] +
              gd.loadedModules['packageFontB/font-part2.js'] +
              gd.loadedModules['packageFontA/font-part3.js'];
    var bytes = base64.decode(b64);
    gd.fontBytes = bytes;
    return bytes;
  },

  onExportTxt: function () {
    if (!this._ensureResult()) return;
    var self = this;
    var body = pinyin.PinyinEngine.renderParenthesis(this._result, this._tone(), this.data.uAsV);
    var fileName = '拼音对照_' + exporter.stamp() + '.txt';
    try {
      var filePath = exporter.saveBytes(fileName, exporter.utf8.encode(body));
      exporter.copyText(body, function () {});
      wx.showModal({
        title: '导出文本',
        content: '文本已复制到剪贴板，并保存为 ' + fileName + '。可分享文件给好友。',
        confirmText: '分享文件',
        cancelText: '知道了',
        success: function (r) {
          if (r.confirm) {
            exporter.shareFile(filePath, fileName);
            self.setData({ status: '已导出文本并复制到剪贴板。' });
          } else {
            self.setData({ status: '已导出文本并复制到剪贴板：' + fileName });
          }
        }
      });
    } catch (e) {
      this.setData({ status: '导出文本失败：' + (e && e.message ? e.message : e) });
    }
  }
});
