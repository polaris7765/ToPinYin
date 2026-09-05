/**
 * 关于页：版本、词库大小、隐私政策、反馈入口
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

var i18n = require('../../utils/i18n');
var settings = require('../../utils/settings');
var theme = require('../../utils/theme');

var app = getApp();

function t(k, v) { return i18n.t(k, v); }

Page({
  data: {
    i18n: {},
    wordCount: 0,
    themeStyle: '',
  },

  onLoad: function () {
    this._render();
    var self = this;
    i18n.onChange(function () { self._render(); });
    settings.onChange(function () { self._render(); });
  },

  onShow: function () { this._render(); },

  _render: function () {
    this.setData({
      themeStyle: theme.refresh(),
      wordCount: (app && app.globalData && app.globalData.wordCount) || 0,
      i18n: {
        appName:  t('settings.about.appName'),
        version:  t('settings.about.version'),
        engine:   t('settings.about.engine', { n: this.data.wordCount || (app && app.globalData && app.globalData.wordCount) || 0 }),
        privacy:  t('settings.about.privacy'),
        feedback: t('settings.about.feedback'),
        license:  t('settings.about.license'),
        github:   t('settings.about.github'),
      }
    });
    wx.setNavigationBarTitle({ title: t('settings.section.about') });
  },

  copyFeedback: function () {
    var msg = 'Chinese Pinyin Assistant · 1.0.0 · ' + (app.globalData.wordCount || 0) + ' words';
    wx.setClipboardData({ data: msg });
  },

  openGithub: function () {
    /* 占位：未来可以换成 https://... 但小程序一般不允许外链跳转 */
    wx.showModal({
      title: '提示',
      content: '在小程序内不允许直接打开外部链接。',
      showCancel: false,
    });
  },
});
