/**
 * UTF-8 编解码（小程序无 TextEncoder，需手写）。
 * encode: string -> Uint8Array（严格 UTF-8，处理代理对）
 */
'use strict';

function encode(str) {
  if (!str || str.length === 0) return new Uint8Array(0);
  // 先计算字节长度
  var len = 0;
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) len += 1;
    else if (code < 0x800) len += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      var lo = str.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        // 代理对 -> 单个 4 字节字符
        len += 4;
        i++;
        continue;
      }
      len += 3; // 孤立高位代理，按 3 字节处理
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      len += 3; // 孤立低位代理
    } else {
      len += 3;
    }
  }
  var bytes = new Uint8Array(len);
  var p = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charCodeAt(j);
    if (c < 0x80) {
      bytes[p++] = c;
    } else if (c < 0x800) {
      bytes[p++] = 0xC0 | (c >> 6);
      bytes[p++] = 0x80 | (c & 0x3F);
    } else if (c >= 0xD800 && c <= 0xDBFF && j + 1 < str.length) {
      var lo2 = str.charCodeAt(j + 1);
      if (lo2 >= 0xDC00 && lo2 <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (lo2 - 0xDC00);
        bytes[p++] = 0xF0 | (cp >> 18);
        bytes[p++] = 0x80 | ((cp >> 12) & 0x3F);
        bytes[p++] = 0x80 | ((cp >> 6) & 0x3F);
        bytes[p++] = 0x80 | (cp & 0x3F);
        j++;
        continue;
      }
      bytes[p++] = 0xEF; bytes[p++] = 0xBF; bytes[p++] = 0xBD; // 替换符
    } else {
      bytes[p++] = 0xE0 | (c >> 12);
      bytes[p++] = 0x80 | ((c >> 6) & 0x3F);
      bytes[p++] = 0x80 | (c & 0x3F);
    }
  }
  return bytes;
}

module.exports = { encode: encode };
