/**
 * Base64 编解码（小程序无 atob/btoa，需手写）。
 * decode: base64 string -> Uint8Array
 * encode: Uint8Array -> base64 string（用于生成模块时）
 */
'use strict';

var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var LOOKUP = null;

function buildLookup() {
  LOOKUP = {};
  for (var i = 0; i < B64_CHARS.length; i++) LOOKUP[B64_CHARS.charAt(i)] = i;
}

function decode(b64) {
  if (!LOOKUP) buildLookup();
  // 去除空白与补齐符
  var s = String(b64).replace(/[\s\r\n=]/g, '');
  if (s.length === 0) return new Uint8Array(0);
  var len = Math.floor(s.length * 3 / 4);
  var out = new Uint8Array(len);
  var p = 0, acc = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var v = LOOKUP[s.charAt(i)];
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (p < len) out[p++] = (acc >> bits) & 0xFF;
    }
  }
  return out;
}

function encode(bytes) {
  var out = '';
  var i = 0;
  var n = bytes.length;
  while (i + 2 < n) {
    var a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64_CHARS.charAt(a >> 2);
    out += B64_CHARS.charAt(((a & 3) << 4) | (b >> 4));
    out += B64_CHARS.charAt(((b & 15) << 2) | (c >> 6));
    out += B64_CHARS.charAt(c & 63);
    i += 3;
  }
  if (i + 1 === n) {
    var x = bytes[i];
    out += B64_CHARS.charAt(x >> 2);
    out += B64_CHARS.charAt(((x & 3) << 4));
    out += '==';
  } else if (i + 2 === n) {
    var y = bytes[i], z = bytes[i + 1];
    out += B64_CHARS.charAt(y >> 2);
    out += B64_CHARS.charAt(((y & 3) << 4) | (z >> 4));
    out += B64_CHARS.charAt(((z & 15) << 2));
    out += '=';
  }
  return out;
}

module.exports = { decode: decode, encode: encode };
