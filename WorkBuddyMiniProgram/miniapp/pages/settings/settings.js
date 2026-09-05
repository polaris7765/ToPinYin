/**
 * 设置页：界面语言 / 字号 / 主题 / 默认选项 / 导出行为
 * ─────────────────────────────────────────────────────────────
 *  - 所有设置通过 settings.js 统一写入；本页面只是 UI 投影
 *  - 监听 settings.onChange 与 i18n.onChange 自我刷新
 *  - 切片式交互：单击 row 进入选择器，再选（picker）回写
 */
'use strict';

var settings = require('../../utils/settings');
var i18n = require('../../utils/i18n');
var theme = require('../../utils/theme');

var app = getApp();

function t(k, v) { return i18n.t(k, v); }

Page({
  data: {
    themeStyle: '',
    themeIsDark: false,
    wordCount: 0,
    sections: [],          // 文案投影（动态刷新）
    rows: [],              // 当前所有可操作的设置项，WXML 通过 wx:for 渲染
    i18n: {},              // 静态文案：复位按钮 / 提示语
    navTitle: '',          // 自定义导航栏标题
    statusBarHeight: 0,    // 状态栏高度（px）
    langPickerVisible: false, // 语言选择弹窗显隐
    langPickerTemp: '',    // 弹窗内临时选中的语言 key
    pickerTitle: '',       // 弹窗标题（按预览语言）
    pickerCancel: '',      // 弹窗取消按钮（按预览语言）
    pickerConfirm: '',    // 弹窗确认按钮（按预览语言）
  },

  /* 用来聚合显示实际数值的镜像 */
  _snapshot: null,

  onLoad: function () {
    /* 读取状态栏高度，供自定义导航栏让出顶部 */
    try {
      var info = wx.getSystemInfoSync && wx.getSystemInfoSync();
      this._statusBarHeight = (info && info.statusBarHeight) ? info.statusBarHeight : 0;
    } catch (e) { this._statusBarHeight = 0; }
    this._init();
  },

  onShow: function () {
    this._init();
  },

  _init: function () {
    this.setData({
      themeStyle: theme.refresh(),
      themeIsDark: theme.getTheme() === 'dark',
      wordCount: (app && app.globalData && app.globalData.wordCount) || 0,
      statusBarHeight: this._statusBarHeight || 0,
      navTitle: t('settings.title'),
      i18n: {
        resetLabel: t('common.reset'),
        confirmTitle: t('common.confirm'),
        confirmBody: t('toast.restored'),
        cancelText: t('common.cancel'),
        confirmText: t('common.confirm'),
        exportNoteTitle: t('settings.exportNoteTitle'),
        exportNoteDocx: t('settings.exportNoteDocx'),
        aboutSectionTitle: t('settings.section.about'),
        aboutLabel: t('settings.about.appName'),
        aboutVersion: t('settings.about.version'),
        langPickerTitle: t('settings.langPickerTitle'),
        langPickerCancel: t('common.cancel'),
        langPickerConfirm: t('common.confirm'),
      },
    });
    this._renderRows();

    var self = this;
    if (!this._wired) {
      settings.onChange(function () { self._init(); });
      i18n.onChange(function () { self._init(); });
      this._wired = true;
    }
  },

  _renderRows: function () {
    var s = settings.all();
    this._snapshot = s;
    var toneKey = ['input.tone.symbol', 'input.tone.number', 'input.tone.none'];
    var modeKey = ['input.mode.annotated', 'input.mode.inline', 'input.mode.only'];
    var fontKey = ['settings.fontSize.small', 'settings.fontSize.medium', 'settings.fontSize.large'];
    var themeKey = ['settings.theme.light', 'settings.theme.dark', 'settings.theme.system'];

    var langOptions = [
      { key: 'zh-CN', label: t('settings.language.zh-CN') },
      { key: 'zh-TW', label: t('settings.language.zh-TW') },
      { key: 'en',    label: t('settings.language.en') },
      { key: 'ja',    label: t('settings.language.ja') },
      { key: 'fr',    label: t('settings.language.fr') },
      { key: 'es',    label: t('settings.language.es') },
      { key: 'pt',    label: t('settings.language.pt') },
      { key: 'ko',    label: t('settings.language.ko') },
      { key: 'hi',    label: t('settings.language.hi') },
    ];
    var langIdx = 0;
    for (var li = 0; li < langOptions.length; li++) {
      if (langOptions[li].key === s.lang) { langIdx = li; break; }
    }

    this.setData({
      sections: [
        { id: 'general', title: t('settings.section.general') },
        { id: 'appearance', title: t('settings.section.appearance') },
        { id: 'export', title: t('settings.section.export') },
      ],
      rows: [
        /* 通用 */
        { section: 'general', kind: 'picker-group', label: t('settings.language'),
          options: langOptions,
          valueKey: 'lang', value: s.lang,
          pickerIndex: langIdx,
          displayValue: t('settings.language.' + s.lang) || s.lang },

        /* 外观 */
        { section: 'appearance', kind: 'segment', label: t('settings.fontSize'),
          options: fontKey.map(function (k, i) { return { key: ['small', 'medium', 'large'][i], label: t(k) }; }),
          valueKey: 'fontSize', value: s.fontSize },
        { section: 'appearance', kind: 'segment', label: t('settings.theme'),
          options: themeKey.map(function (k, i) { return { key: ['light', 'dark', 'system'][i], label: t(k) }; }),
          valueKey: 'theme', value: s.theme },
        { section: 'appearance', kind: 'switch', label: t('settings.uAsV'),
          valueKey: 'uAsV', value: !!s.uAsV },

        /* 默认值 */
        { section: 'export', kind: 'segment', label: t('settings.defaultTone'),
          options: toneKey.map(function (k, i) { return { key: String(i), label: t(k) }; }),
          valueKey: 'defaultTone', value: String(s.defaultTone) },
        { section: 'export', kind: 'segment', label: t('settings.defaultMode'),
          options: modeKey.map(function (k, i) { return { key: String(i), label: t(k) }; }),
          valueKey: 'defaultMode', value: String(s.defaultMode) },
        { section: 'export', kind: 'switch', label: t('settings.openLastFile'),
          valueKey: 'openAfterExport', value: !!s.openAfterExport },
        { section: 'export', kind: 'switch', label: t('settings.history'),
          valueKey: 'keepHistory', value: !!s.keepHistory },
      ],
    });
  },

  /* ---------------- 交互 ---------------- */

  onSegmentPick: function (e) {
    var key = e.currentTarget.dataset.key;
    var val = e.currentTarget.dataset.val;
    if (!key) return;
    var cast = (key === 'defaultTone' || key === 'defaultMode') ? Number(val) : val;
    settings.set(key, cast);
    this._renderRows();
  },

  onSwitchChange: function (e) {
    var key = e.currentTarget.dataset.key;
    if (!key) return;
    settings.set(key, !!e.detail.value);
    this._renderRows();
  },

  onLangPickerOpen: function () {
    var s = settings.all();
    var lang = s.lang;
    this.setData({
      langPickerVisible: true,
      langPickerTemp: lang,
      pickerTitle: i18n.tLang(lang, 'settings.langPickerTitle'),
      pickerCancel: i18n.tLang(lang, 'common.cancel'),
      pickerConfirm: i18n.tLang(lang, 'common.confirm'),
    });
  },

  onLangPickerSelect: function (e) {
    var key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({
      langPickerTemp: key,
      pickerTitle: i18n.tLang(key, 'settings.langPickerTitle'),
      pickerCancel: i18n.tLang(key, 'common.cancel'),
      pickerConfirm: i18n.tLang(key, 'common.confirm'),
    });
  },

  onLangPickerCancel: function () {
    this.setData({ langPickerVisible: false, langPickerTemp: '', pickerTitle: '', pickerCancel: '', pickerConfirm: '' });
  },

  onLangPickerConfirm: function () {
    var key = this.data.langPickerTemp;
    if (!key) return;
    settings.set('lang', key);
    this.setData({ langPickerVisible: false, langPickerTemp: '', pickerTitle: '', pickerCancel: '', pickerConfirm: '' });
    this._renderRows();
  },

  /* 阻止点击弹窗内容时冒泡到遮罩关闭 */
  onPickerModalTap: function () { return; },

  goAbout: function () {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  goBack: function () {
    wx.navigateBack({ delta: 1, fail: function () { wx.switchTab({ url: '/pages/index/index' }); } });
  },

  reset: function () {
    var self = this;
    var i = this.data.i18n || {};
    wx.showModal({
      title: i.confirmTitle || t('common.confirm'),
      content: i.confirmBody || '确定要恢复默认设置？',
      confirmText: i.confirmText || t('common.confirm'),
      cancelText: i.cancelText || t('common.cancel'),
      success: function (r) {
        if (!r.confirm) return;
        settings.reset();
        self._renderRows();
        wx.showToast({ title: t('toast.restored'), icon: 'success', duration: 1500 });
      }
    });
  },
});
