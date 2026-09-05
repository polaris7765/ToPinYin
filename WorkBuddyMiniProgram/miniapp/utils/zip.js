/**
 * 极简 ZIP 写入器（store 方式，无压缩）。
 * 用于生成 .docx（OOXML 本质是 ZIP）。
 * 仅支持 ASCII 文件名、二进制内容；输出标准 ZIP 结构，
 * Word / WPS / LibreOffice 均可正常打开。
 */
'use strict';

var crc = require('./crc32');

function u16(dv, off, v) { dv.setUint16(off, v & 0xFFFF, true); }
function u32(dv, off, v) { dv.setUint32(off, v >>> 0, true); }

// 固定 DOS 时间（2026-01-01 00:00:00），保证输出确定
var DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 23585
var DOS_TIME = 0;

/**
 * 生成 ZIP 字节。
 * @param {Array<{name:string, data:Uint8Array}>} entries
 * @returns {Uint8Array}
 */
function buildZip(entries) {
  var localParts = [];
  var centralParts = [];
  var offset = 0;

  for (var i = 0; i < entries.length; i++) {
    var name = entries[i].name;
    var data = entries[i].data;
    var nameBytes = asciiBytes(name);
    var crc32 = crc.crc32(data);

    // ---- Local file header ----
    var local = new DataView(new ArrayBuffer(30));
    u32(local, 0, 0x04034b50);
    u16(local, 4, 20);        // version needed
    u16(local, 6, 0);         // flags
    u16(local, 8, 0);         // method: store
    u16(local, 10, DOS_TIME);
    u16(local, 12, DOS_DATE);
    u32(local, 14, crc32);
    u32(local, 18, data.length);
    u32(local, 22, data.length);
    u16(local, 26, nameBytes.length);
    u16(local, 28, 0);        // extra len
    var localBytes = new Uint8Array(30 + nameBytes.length + data.length);
    localBytes.set(new Uint8Array(local.buffer), 0);
    localBytes.set(nameBytes, 30);
    localBytes.set(data, 30 + nameBytes.length);
    localParts.push(localBytes);

    // ---- Central directory ----
    var central = new DataView(new ArrayBuffer(46));
    u32(central, 0, 0x02014b50);
    u16(central, 4, 20);      // version made by
    u16(central, 6, 20);      // version needed
    u16(central, 8, 0);       // flags
    u16(central, 10, 0);      // method
    u16(central, 12, DOS_TIME);
    u16(central, 14, DOS_DATE);
    u32(central, 16, crc32);
    u32(central, 20, data.length);
    u32(central, 24, data.length);
    u16(central, 28, nameBytes.length);
    u16(central, 30, 0);      // extra
    u16(central, 32, 0);      // comment
    u16(central, 34, 0);      // disk
    u16(central, 36, 0);      // internal attrs
    u32(central, 38, 0);      // external attrs
    u32(central, 42, offset); // local header offset
    var centralBytes = new Uint8Array(46 + nameBytes.length);
    centralBytes.set(new Uint8Array(central.buffer), 0);
    centralBytes.set(nameBytes, 46);
    centralParts.push(centralBytes);

    offset += localBytes.length;
  }

  // ---- EOCD ----
  var cdSize = 0;
  for (var j = 0; j < centralParts.length; j++) cdSize += centralParts[j].length;
  var eocd = new DataView(new ArrayBuffer(22));
  u32(eocd, 0, 0x06054b50);
  u16(eocd, 4, 0);  // disk
  u16(eocd, 6, 0);  // cd disk
  u16(eocd, 8, entries.length);
  u16(eocd, 10, entries.length);
  u32(eocd, 12, cdSize);
  u32(eocd, 16, offset);
  u16(eocd, 20, 0); // comment len

  var total = offset + cdSize + 22;
  var out = new Uint8Array(total);
  var p = 0;
  for (var k = 0; k < localParts.length; k++) { out.set(localParts[k], p); p += localParts[k].length; }
  for (var m = 0; m < centralParts.length; m++) { out.set(centralParts[m], p); p += centralParts[m].length; }
  out.set(new Uint8Array(eocd.buffer), p);
  return out;
}

function asciiBytes(s) {
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
  return out;
}

module.exports = { buildZip: buildZip };
