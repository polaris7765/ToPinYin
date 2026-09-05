/**
 * 导出与文件交互（依赖 wx API）：
 *   保存到用户目录 → wx.openDocument 打开（Word/PDF）→ 分享 / 剪贴板（文本）
 *   → actionSheet 让用户进一步「转发 / 用其他应用打开 / 保存到收藏」
 *
 * 文件名规则：「拼音对照_yyyyMMdd_HHmmss.扩展名」
 */
'use strict';

var utf8 = require('./utf8');

/* 工具：获取微信文件系统管理器 */
function _fs() { return wx.getFileSystemManager(); }

/* 工具：获取用户数据目录 */
function _userDir() { return wx.env.USER_DATA_PATH; }

/* 工具：分割路径 */
function baseName(p) {
  if (!p) return '';
  var idx = p.lastIndexOf('/');
  return idx >= 0 ? p.substring(idx + 1) : p;
}

/* 工具：yyyy-MM-dd HH:mm:ss */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function nowStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/* 工具：yyyyMMdd_HHmmss */
function stamp() {
  var d = new Date();
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/** 把 Uint8Array 写到本地文件；返回绝对路径。 */
function saveBytes(fileName, bytes) {
  var fs = _fs();
  var dir = _userDir() + '/pinyin-export';
  try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
  var filePath = dir + '/' + fileName;
  // 注意：Uint8Array 可能引用一个更大的 ArrayBuffer，必须切片出来
  var ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  fs.writeFileSync(filePath, ab, 'binary');
  return filePath;
}

/** 读取本地文件内容为 Uint8Array */
function readBytes(filePath) {
  var fs = _fs();
  var ab = fs.readFileSync(filePath);
  return new Uint8Array(ab);
}

/** 列举历史导出文件，按时间倒序。 */
function listExports() {
  var fs = _fs();
  var dir = _userDir() + '/pinyin-export';
  try {
    var names = fs.readdirSync(dir);
    return names.sort().reverse();
  } catch (e) { return []; }
}

/** 用微信内置文档查看器打开文件。fileType: docx / pdf / txt 等 */
function openDoc(filePath, fileType, onStatus) {
  if (!wx.openDocument) {
    if (typeof onStatus === 'function') onStatus('已保存到本地：' + filePath);
    return;
  }
  wx.openDocument({
    filePath: filePath,
    fileType: fileType,
    showMenu: true, // 用户可在右上角菜单转发 / 用其他应用打开 / 保存到收藏
    success: function () {
      if (typeof onStatus === 'function') onStatus('已打开：' + baseName(filePath));
    },
    fail: function (err) {
      if (typeof onStatus === 'function') onStatus('已保存到本地：' + filePath + '（自动打开失败：' + (err && err.errMsg ? err.errMsg : '未知错误') + '）');
    }
  });
}

/** 显示加载遮罩、保存文件并按 opts.openAfterExport 决定后续动作。 */
function generateAndOpen(fileName, bytes, fileType, onStatus, opts) {
  opts = opts || {};
  wx.showLoading && wx.showLoading({ title: '正在生成…', mask: true });
  setTimeout(function () {
    try {
      var filePath = saveBytes(fileName, bytes);
      wx.hideLoading && wx.hideLoading();
      if (opts.openAfterExport === false) {
        if (typeof onStatus === 'function') onStatus('已保存：' + baseName(filePath));
        return;
      }
      openDoc(filePath, fileType, onStatus);
    } catch (e) {
      wx.hideLoading && wx.hideLoading();
      if (typeof onStatus === 'function') onStatus('导出失败：' + (e && e.message ? e.message : e));
    }
  }, 30);
}

/** 复制文本到剪贴板。 */
function copyText(text, onStatus) {
  wx.setClipboardData({
    data: text,
    success: function () { if (typeof onStatus === 'function') onStatus('已复制到剪贴板（' + text.length + ' 字符）。'); },
    fail: function () { if (typeof onStatus === 'function') onStatus('复制失败。'); }
  });
}

/** 分享本地文件到聊天（部分客户端支持）。 */
function shareFile(filePath, fileName) {
  if (typeof wx.shareFileMessage !== 'function') {
    return false;
  }
  wx.shareFileMessage({
    filePath: filePath,
    fileName: fileName,
    fail: function (err) { console.warn('shareFileMessage fail', err); }
  });
  return true;
}

/** ActionSheet：让用户在导出文件后选「打开 / 分享 / 保存收藏」。*/
function actionSheet(filePath, fileName, fileType) {
  if (!wx.showActionSheet) return;
  var items = ['打开文档', '复制文件名'];
  if (wx.shareFileMessage) items.push('分享到聊天');
  if (wx.addFileToFavorites) items.push('保存到收藏');
  wx.showActionSheet({
    itemList: items,
    success: function (res) {
      var picked = items[res.tapIndex];
      if (!picked) return;
      if (picked === '打开文档') openDoc(filePath, fileType, console.log);
      else if (picked === '复制文件名') copyText(fileName);
      else if (picked === '分享到聊天') shareFile(filePath, fileName);
      else if (picked === '保存到收藏') {
        try { wx.addFileToFavorites({ filePath: filePath, fileName: fileName }); } catch (e) { /* ignore */ }
      }
    }
  });
}

module.exports = {
  saveBytes: saveBytes,
  readBytes: readBytes,
  listExports: listExports,
  openDoc: openDoc,
  generateAndOpen: generateAndOpen,
  copyText: copyText,
  shareFile: shareFile,
  actionSheet: actionSheet,
  baseName: baseName,
  nowStr: nowStr,
  stamp: stamp,
  utf8: utf8,
};
