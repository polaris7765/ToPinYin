/**
 * 设置存储模块
 * ────────────────────────────────────────────────────────────────
 *  - 全部设置写入 wx.storage（异步 setStorageSync 同步刷盘）
 *  - 兼容老版本（缺失字段时使用默认值）
 *  - 通过 EventBus 通知页面更新；任意页面 set 后所有订阅页面会刷新
 *  - 由 app.onLaunch 调用 boot() 完成一次加载
 */
'use strict';

var i18n = require('./i18n');

/* 默认设置。保持 schema 稳定；新增字段请加到 ALL_DEFAULTS 末尾并补默认值。 */
var ALL_DEFAULTS = {
  /* 通用 */
  lang: 'zh-CN',           // i18n lang code，跟 i18n.setLang 同步
  theme: 'system',         // light | dark | system
  fontSize: 'medium',      // small | medium | large

  /* 输入 */
  defaultTone: 0,          // 0=symbol 1=number 2=none
  defaultMode: 0,          // 0=annotated 1=inline 2=only
  uAsV: true,

  /* 导出 */
  openAfterExport: true,
  exportFormat: 'docx',    // 默认导出格式 docx | pdf | txt
  keepHistory: true,       // 暂时不持久化文本，但保留选项

  /* 历史 */
  lastInput: '',           // 上次输入文本（仅在 keepHistory=true 时写入）
};

var STORAGE_KEY = 'wb.settings.v1';
var STATE = Object.assign({}, ALL_DEFAULTS);
var LOADED = false;
var listeners = [];

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function _merge(saved) {
  if (!saved || typeof saved !== 'object') return;
  for (var k in ALL_DEFAULTS) {
    if (Object.prototype.hasOwnProperty.call(saved, k)) STATE[k] = saved[k];
  }
  // 与 i18n 模块保持同步（避免初始化竞态）
  if (STATE.lang && i18n.isSupported(STATE.lang)) {
    try { i18n.setLang(STATE.lang); } catch (e) { /* ignore */ }
  }
}

function boot() {
  if (LOADED) return STATE;
  // 先把 i18n 加载好（推断系统语言）
  try { i18n.load(); STATE.lang = i18n.getLang(); } catch (e) { /* ignore */ }
  // 再用持久化值覆盖
  try {
    var saved = wx.getStorageSync(STORAGE_KEY);
    _merge(saved);
  } catch (e) { /* ignore */ }
  LOADED = true;
  // 同步 i18n 状态（持久化值优先于系统语言推断）
  try { i18n.setLang(STATE.lang); } catch (e) { /* ignore */ }
  // 监听 i18n 变化 → 写回 settings
  i18n.onChange(function (e) { STATE.lang = e.next; _persist(); });
  return STATE;
}

/** 读取所有设置（返回一个新对象，避免外部直接修改内部状态）。 */
function all() {
  if (!LOADED) boot();
  return clone(STATE);
}

/** 读取单个字段；返回默认值兜底。 */
function get(key) {
  if (!LOADED) boot();
  return Object.prototype.hasOwnProperty.call(STATE, key) ? STATE[key] : ALL_DEFAULTS[key];
}

/** 写入单个字段 + 立即落盘 + 通知订阅者。 */
function set(key, value) {
  if (!LOADED) boot();
  if (!Object.prototype.hasOwnProperty.call(ALL_DEFAULTS, key)) return false;
  var prev = STATE[key];
  STATE[key] = value;
  _persist();
  // 联动：如果是 lang，同步 i18n
  if (key === 'lang' && i18n.isSupported(value)) {
    try { i18n.setLang(value); } catch (e) { /* ignore */ }
  }
  _emit({ key: key, prev: prev, value: value });
  return true;
}

/** 批量更新。 */
function updateMany(patch) {
  if (!LOADED) boot();
  if (!patch || typeof patch !== 'object') return false;
  var changed = [];
  for (var k in patch) {
    if (!Object.prototype.hasOwnProperty.call(ALL_DEFAULTS, k)) continue;
    if (STATE[k] !== patch[k]) {
      changed.push({ key: k, prev: STATE[k], value: patch[k] });
      STATE[k] = patch[k];
    }
  }
  if (!changed.length) return true;
  _persist();
  if (Object.prototype.hasOwnProperty.call(patch, 'lang') && i18n.isSupported(patch.lang)) {
    try { i18n.setLang(patch.lang); } catch (e) { /* ignore */ }
  }
  for (var i = 0; i < changed.length; i++) _emit(changed[i]);
  return true;
}

/** 重置回默认值。 */
function reset() {
  var prev = clone(STATE);
  for (var k in ALL_DEFAULTS) STATE[k] = ALL_DEFAULTS[k];
  try { i18n.setLang(STATE.lang); } catch (e) { /* ignore */ }
  _persist();
  _emit({ key: '*', prev: prev, value: clone(STATE) });
}

function _persist() {
  try { wx.setStorageSync(STORAGE_KEY, clone(STATE)); } catch (e) { /* ignore */ }
}

function onChange(cb) {
  if (typeof cb === 'function') listeners.push(cb);
}

function _emit(evt) {
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](evt); } catch (e) { /* ignore */ }
  }
}

/** 取默认值拷贝，给设置页用。 */
function defaults() { return clone(ALL_DEFAULTS); }
function keys() { return Object.keys(ALL_DEFAULTS); }

module.exports = {
  boot: boot,
  all: all,
  get: get,
  set: set,
  updateMany: updateMany,
  reset: reset,
  onChange: onChange,
  defaults: defaults,
  keys: keys,
  STORAGE_KEY: STORAGE_KEY,
};
