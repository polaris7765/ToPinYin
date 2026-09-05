/**
 * 导出与文件交互（依赖 wx API）：
 *   保存到用户目录 → wx.openDocument 打开（Word/PDF）→ 分享 / 剪贴板（文本）
 */
'use strict';

var utf8 = require('./utf8');

/** 保存字节到小程序用户目录，返回绝对路径。 */
function saveBytes(fileName, bytes) {
  var fs = wx.getFileSystemManager();
  var dir = wx.env.USER_DATA_PATH + '/pinyin-export';
  try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
  var filePath = dir + '/' + fileName;
  // Uint8Array -> ArrayBuffer（注意 slice 掉共享缓冲）
  var ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  fs.writeFileSync(filePath, ab, 'binary');
  return filePath;
}

/** 用微信内置文档查看器打开文件。fileType: docx / pdf / txt 等 */
function openDoc(filePath, fileType, onStatus) {
  wx.openDocument({
    filePath: filePath,
    fileType: fileType,
    showMenu: true, // 打开后右上角菜单可转发 / 保存
    success: function () {
      if (onStatus) onStatus('已导出并打开：' + baseName(filePath) + '（右上角菜单可转发 / 保存）');
    },
    fail: function (err) {
      if (onStatus) onStatus('已保存到本地：' + filePath + '（打开失败：' + (err && err.errMsg ? err.errMsg : '未知错误') + '）');
    }
  });
}

/** 生成并打开（带 loading 遮罩）。 */
function generateAndOpen(fileName, bytes, fileType, onStatus) {
  wx.showLoading({ title: '正在生成…', mask: true });
  setTimeout(function () {
    try {
      var filePath = saveBytes(fileName, bytes);
      wx.hideLoading();
      openDoc(filePath, fileType, onStatus);
    } catch (e) {
      wx.hideLoading();
      if (onStatus) onStatus('导出失败：' + e.message);
    }
  }, 30);
}

/** 复制文本到剪贴板。 */
function copyText(text, onStatus) {
  wx.setClipboardData({
    data: text,
    success: function () { if (onStatus) onStatus('已复制转换结果到剪贴板（' + text.length + ' 字符）。'); },
    fail: function () { if (onStatus) onStatus('复制失败。'); }
  });
}

/** 分享本地文件到聊天。 */
function shareFile(filePath, fileName) {
  wx.shareFileMessage({
    filePath: filePath,
    fileName: fileName,
    fail: function (err) { console.warn('shareFileMessage fail', err); }
  });
}

function baseName(p) {
  var idx = p.lastIndexOf('/');
  return idx >= 0 ? p.substring(idx + 1) : p;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/** 转换时间字符串 yyyy-MM-dd HH:mm:ss */
function nowStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 文件名时间戳 yyyyMMdd_HHmmss */
function stamp() {
  var d = new Date();
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

module.exports = {
  saveBytes: saveBytes,
  openDoc: openDoc,
  generateAndOpen: generateAndOpen,
  copyText: copyText,
  shareFile: shareFile,
  nowStr: nowStr,
  stamp: stamp,
  utf8: utf8
};
