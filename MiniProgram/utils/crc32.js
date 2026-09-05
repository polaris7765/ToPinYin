/**
 * CRC-32（ZIP 使用），查表法。
 */
'use strict';

var TABLE = null;

function buildTable() {
  TABLE = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    TABLE[n] = c;
  }
}

/**
 * 计算 CRC32（无符号）。
 * @param {Uint8Array} bytes
 * @param {number} [start] 起始偏移
 * @param {number} [end] 结束偏移（不含）
 */
function crc32(bytes, start, end) {
  if (!TABLE) buildTable();
  start = start || 0;
  end = (end === undefined || end === null) ? bytes.length : end;
  var crc = 0xFFFFFFFF;
  for (var i = start; i < end; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { crc32: crc32 };
