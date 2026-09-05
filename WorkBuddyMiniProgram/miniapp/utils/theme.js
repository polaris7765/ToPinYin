/**
 * 主题（Theme）+ 字号（Font Scale）解析
 * ────────────────────────────────────────────────────────────────
 *  - 根据 settings.theme 与系统深色模式决定最终主题
 *  - 提供 readCssVars() 输出可在 WXSS 中引用的全局变量
 *  - 提供 notifyThemeChanged() 主动广播（settings 变化或 system 变化）
 */
'use strict';

var settings = require('./settings');

var current = {
  theme: 'light',
  fontSize: 'medium',
};

/* 不同字号对应的 rpx 倍率（基础字号 28rpx）。 */
var FONT_SCALE = { small: 0.88, medium: 1.0, large: 1.18 };

/* 浅色主题变量。 */
var LIGHT_VARS = {
  '--bg':              '#F3F5FA',
  '--card':            '#FFFFFF',
  '--card-border':     '#E3E8F2',
  '--primary':         '#3B6EF6',
  '--primary-soft':    '#E8EEFD',
  '--primary-text':    '#FFFFFF',
  '--text':            '#22304A',
  '--text-soft':       '#5C6A85',
  '--text-muted':      '#8A94A6',
  '--text-faint':      '#B9C2D0',
  '--input-bg':        '#F2F4F8',
  '--pinyin':          '#3B6EF6',
  '--success':         '#22C55E',
  '--danger':          '#EF4444',
  '--shadow':          'rgba(20, 30, 60, 0.06)',
};

/* 深色主题变量。 */
var DARK_VARS = {
  '--bg':              '#0F1115',
  '--card':            '#1A1E27',
  '--card-border':     '#262B36',
  '--primary':         '#5C8CFF',
  '--primary-soft':    '#243049',
  '--primary-text':    '#FFFFFF',
  '--text':            '#E7ECF5',
  '--text-soft':       '#B5BFD2',
  '--text-muted':      '#7F8AA0',
  '--text-faint':      '#5A647A',
  '--input-bg':        '#212633',
  '--pinyin':          '#7AA8FF',
  '--success':         '#34D399',
  '--danger':          '#F87171',
  '--shadow':          'rgba(0, 0, 0, 0.45)',
};

function _readSystemTheme() {
  try {
    var info = wx.getSystemInfoSync && wx.getSystemInfoSync();
    if (info && (info.theme === 'dark' || info.darkMode === true)) return 'dark';
  } catch (e) { /* ignore */ }
  return 'light';
}

function _resolveTheme(setting) {
  if (setting === 'dark') return 'dark';
  if (setting === 'light') return 'light';
  return _readSystemTheme();
}

function _applyPageVars() {
  var t = current.theme;
  var vars = t === 'dark' ? DARK_VARS : LIGHT_VARS;
  var css = '';
  for (var k in vars) css += k + ':' + vars[k] + ';';
  // 字号修正：通过 CSS 变量驱动即可
  css += '--font-scale:' + (FONT_SCALE[current.fontSize] || 1) + ';';
  css += '--base-font:' + Math.round(28 * (FONT_SCALE[current.fontSize] || 1)) + 'rpx;';
  css += '--base-pinyin:' + Math.round(20 * (FONT_SCALE[current.fontSize] || 1)) + 'rpx;';
  css += '--base-char:' + Math.round(30 * (FONT_SCALE[current.fontSize] || 1)) + 'rpx;';
  css += '--base-title:' + Math.round(32 * (FONT_SCALE[current.fontSize] || 1)) + 'rpx;';
  return css;
}

/* 计算并返回最新的当前主题 + 字号 CSS。 */
function refresh() {
  var s = settings.all();
  current.theme = _resolveTheme(s.theme);
  current.fontSize = s.fontSize;
  return _applyPageVars();
}

/* 当前主题（用于 JS 计算时的判断，例如需要展示暗色图标）。 */
function getTheme() {
  if (!current.theme) refresh();
  return current.theme;
}

function getFontSize() {
  if (!current.fontSize) refresh();
  return current.fontSize;
}

function onSystemThemeChange(cb) {
  try {
    if (wx.onThemeChange) {
      wx.onThemeChange(function () {
        refresh();
        if (typeof cb === 'function') cb(current);
      });
    }
  } catch (e) { /* ignore */ }
}

/** 平台信息：是否为 iPhone / iOS / Android / PC / 宽屏。 */
function deviceProfile() {
  var info = {};
  try { info = wx.getSystemInfoSync() || {}; } catch (e) { /* ignore */ }
  var screenW = info.screenWidth || 375;
  var screenH = info.screenHeight || 812;
  var isTablet = (info.model && /(iPad|tablet|tablet)/i.test(info.model)) || screenW >= 768;
  return {
    screenWidth: screenW,
    screenHeight: screenH,
    pixelRatio: info.pixelRatio || 2,
    statusBarHeight: info.statusBarHeight || 0,
    safeArea: info.safeArea || null,
    platform: info.platform || 'devtools',
    isTablet: isTablet,
    isWide: screenW >= 600,
    isLandscape: screenW > screenH,
    model: info.model || '',
    system: info.system || '',
  };
}

module.exports = {
  refresh: refresh,
  getTheme: getTheme,
  getFontSize: getFontSize,
  onSystemThemeChange: onSystemThemeChange,
  current: function () { return Object.assign({}, current); },
  deviceProfile: deviceProfile,
  LIGHT_VARS: LIGHT_VARS,
  DARK_VARS: DARK_VARS,
  FONT_SCALE: FONT_SCALE,
};
