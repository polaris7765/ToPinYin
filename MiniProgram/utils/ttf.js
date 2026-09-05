/**
 * TrueType 字体解析器 + 静态子集化 —— TtfFont.cs 的 JS 移植。
 * 读取 cmap / hmtx / head / hhea / maxp / loca / glyf 等表，
 * 生成供 PDF 内嵌的静态子集字体（去掉 fvar/gvar，保留 glyf 默认外形）。
 * 纯逻辑，不依赖 wx / Node。
 */
'use strict';

function FontSubset() {
  this.fontBytes = null;            // Uint8Array 子集 TTF
  this.unicodeToNewGid = {};        // Unicode(code int) -> 新 GID(CID)
  this.oldToNew = {};               // 旧 GID -> 新 GID
  this.newNumGlyphs = 0;
}

function TtfFont() {
  this.unitsPerEm = 1000;
  this.numGlyphs = 0;
  this.indexToLocFormat = 0;
  this.xMin = 0; this.yMin = 0; this.xMax = 0; this.yMax = 0;
  this.ascent = 0; this.descent = 0; this.lineGap = 0;
  this._data = null;
  this._cmap = null;
  this._advanceWidth = null;
  this._lsb = null;
  this._loca = null;
  this._glyf = null;
  this._tableOffset = {};
  this._tableLength = {};
}

// ---------------- 二进制读取 ----------------

function be16(d, o) { return (d[o] << 8) | d[o + 1]; }
function be16s(d, o) {
  var v = (d[o] << 8) | d[o + 1];
  return v >= 0x8000 ? v - 0x10000 : v;
}
function be32(d, o) {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

// ---------------- 解析 ----------------

TtfFont.prototype.parse = function (data) {
  if (!data || data.length < 12) return false;
  this._data = data;
  var numTables = be16(data, 4);
  var off = {}, len = {};
  for (var i = 0; i < numTables; i++) {
    var rec = 12 + i * 16;
    if (rec + 16 > data.length) return false;
    var tag = String.fromCharCode(data[rec], data[rec + 1], data[rec + 2], data[rec + 3]);
    var offset = be32(data, rec + 8);
    var length = be32(data, rec + 12);
    off[tag] = offset;
    len[tag] = length;
  }
  this._tableOffset = off;
  this._tableLength = len;

  // head
  if (!off['head']) return false;
  var head = off['head'];
  if (head + 54 > data.length) return false;
  this.unitsPerEm = be16(data, head + 18);
  this.xMin = be16s(data, head + 36);
  this.yMin = be16s(data, head + 38);
  this.xMax = be16s(data, head + 40);
  this.yMax = be16s(data, head + 42);
  this.indexToLocFormat = be16s(data, head + 50);

  // maxp
  if (!off['maxp']) return false;
  this.numGlyphs = be16(data, off['maxp'] + 4);

  // hhea
  if (!off['hhea']) return false;
  var hhea = off['hhea'];
  this.ascent = be16s(data, hhea + 4);
  this.descent = be16s(data, hhea + 6);
  this.lineGap = be16s(data, hhea + 8);
  var numberOfHMetrics = be16(data, hhea + 34);

  // hmtx
  if (!off['hmtx']) return false;
  var hmtx = off['hmtx'];
  this._advanceWidth = new Uint16Array(this.numGlyphs);
  this._lsb = new Int16Array(this.numGlyphs);
  var p = hmtx;
  var lastAdvance = 0;
  for (var g = 0; g < this.numGlyphs; g++) {
    if (g < numberOfHMetrics && p + 4 <= data.length) {
      lastAdvance = be16(data, p);
      this._advanceWidth[g] = lastAdvance;
      this._lsb[g] = be16s(data, p + 2);
      p += 4;
    } else if (p + 2 <= data.length) {
      this._advanceWidth[g] = lastAdvance;
      this._lsb[g] = be16s(data, p);
      p += 2;
    } else {
      this._advanceWidth[g] = lastAdvance;
      this._lsb[g] = 0;
    }
  }

  // cmap
  if (!off['cmap']) return false;
  if (!this._parseCmap(off['cmap'], len['cmap'])) return false;

  // loca / glyf
  if (!off['loca'] || !off['glyf']) return false;
  var locaOff = off['loca'];
  var locaLen = len['loca'];
  this._loca = new Uint32Array(this.numGlyphs + 1);
  if (this.indexToLocFormat === 0) {
    for (var li = 0; li <= this.numGlyphs; li++) {
      if (locaOff + li * 2 + 2 > data.length) return false;
      this._loca[li] = be16(data, locaOff + li * 2) * 2;
    }
  } else {
    for (var li2 = 0; li2 <= this.numGlyphs; li2++) {
      if (locaOff + li2 * 4 + 4 > data.length) return false;
      this._loca[li2] = be32(data, locaOff + li2 * 4);
    }
  }
  this._glyf = data.subarray(off['glyf'], off['glyf'] + len['glyf']);
  return true;
};

TtfFont.prototype._parseCmap = function (cmapOff, cmapLen) {
  var d = this._data;
  var numTables = be16(d, cmapOff + 2);
  var best = -1, bestScore = -1;
  for (var i = 0; i < numTables; i++) {
    var rec = cmapOff + 4 + i * 8;
    if (rec + 8 > d.length) continue;
    var platform = be16(d, rec);
    var encoding = be16(d, rec + 2);
    var subOff = cmapOff + be32(d, rec + 4);
    var score = scoreCmap(platform, encoding);
    if (score > bestScore) {
      bestScore = score;
      best = subOff;
    }
  }
  if (best < 0) return false;
  if (best + 2 > cmapOff + cmapLen || best + 2 > d.length) return false;
  return this._readSubtable(best);
};

function scoreCmap(platform, encoding) {
  if (platform === 3 && encoding === 1) return 100;
  if (platform === 0 && encoding === 4) return 90;
  if (platform === 3 && encoding === 10) return 80;
  if (platform === 0 && encoding === 3) return 70;
  if (platform === 0 && encoding === 6) return 60;
  if (platform === 0 && encoding === 0) return 50;
  return -1;
}

TtfFont.prototype._readSubtable = function (off) {
  var d = this._data;
  var format = be16(d, off);
  this._cmap = {};
  if (format === 4) {
    var segCountX2 = be16(d, off + 6);
    var segCount = segCountX2 / 2;
    var endBase = off + 14;
    var startBase = endBase + segCountX2 + 2;
    var deltaBase = startBase + segCountX2;
    var rangeBase = deltaBase + segCountX2;
    var glyphBase = rangeBase + segCountX2;
    for (var s = 0; s < segCount; s++) {
      var endCode = be16(d, endBase + s * 2);
      var startCode = be16(d, startBase + s * 2);
      var idDelta = be16s(d, deltaBase + s * 2);
      var idRangeOffset = be16(d, rangeBase + s * 2);
      for (var c = startCode; c <= endCode; c++) {
        var gid;
        if (idRangeOffset === 0) {
          gid = (c + idDelta) & 0xFFFF;
        } else {
          var gp = rangeBase + s * 2 + idRangeOffset + (c - startCode) * 2;
          if (gp + 2 > d.length) continue;
          var g = be16(d, gp);
          gid = g === 0 ? 0 : (g + idDelta) & 0xFFFF;
        }
        if (gid !== 0) this._cmap[c] = gid;
      }
    }
    return true;
  }
  if (format === 12) {
    var nGroups = be32(d, off + 12);
    var basePos = off + 16;
    for (var gi = 0; gi < nGroups; gi++) {
      var gp2 = basePos + gi * 12;
      var start = be32(d, gp2);
      var end = be32(d, gp2 + 4);
      var startGid = be32(d, gp2 + 8);
      for (var cc = start; cc <= end; cc++) {
        var gid2 = (startGid + (cc - start)) & 0xFFFF;
        if (gid2 !== 0) this._cmap[cc] = gid2;
      }
    }
    return true;
  }
  if (format === 6) {
    var firstCode = be16(d, off + 6);
    var entryCount = be16(d, off + 8);
    for (var ei = 0; ei < entryCount; ei++) {
      var gid3 = be16(d, off + 10 + ei * 2);
      if (gid3 !== 0) this._cmap[firstCode + ei] = gid3;
    }
    return true;
  }
  if (format === 0) {
    for (var bi = 0; bi < 256; bi++) {
      var gid4 = d[off + 6 + bi];
      if (gid4 !== 0) this._cmap[bi] = gid4;
    }
    return true;
  }
  return false;
};

TtfFont.prototype.hasGlyph = function (unicode) {
  return !!this._cmap && Object.prototype.hasOwnProperty.call(this._cmap, unicode);
};

TtfFont.prototype.getGlyph = function (unicode) {
  var g = this._cmap ? this._cmap[unicode] : undefined;
  return g || 0;
};

TtfFont.prototype.getAdvance = function (gid) {
  if (gid < 0 || gid >= this._advanceWidth.length) return 0;
  return this._advanceWidth[gid];
};

TtfFont.prototype.getLsb = function (gid) {
  if (gid < 0 || gid >= this._lsb.length) return 0;
  return this._lsb[gid];
};

// ---------------- 复合字形解析 ----------------

function parseComponents(font, start, end) {
  var glyf = font._glyf;
  var isComposite = false;
  if (end - start < 10) return null;
  var numContours = be16s(glyf, start);
  if (numContours >= 0) return null; // 简单字形

  isComposite = true;
  var list = [];
  var pos = start + 10;
  var more = true;
  while (more && pos + 4 <= end) {
    var flags = be16(glyf, pos);
    var gid = be16(glyf, pos + 2);
    list.push({ fieldPos: pos + 2, oldGid: gid });
    pos += 4;
    pos += (flags & 0x0001) !== 0 ? 4 : 2;
    if ((flags & 0x0008) !== 0) pos += 2;
    else if ((flags & 0x0040) !== 0) pos += 4;
    else if ((flags & 0x0080) !== 0) pos += 8;
    more = (flags & 0x0020) !== 0;
  }
  return list;
}

// ---------------- 子集化 ----------------

/** 基于用到的 Unicode 字符生成静态子集字体。 */
TtfFont.prototype.buildSubset = function (unicodeChars) {
  var self = this;

  // 1. 收集用到的旧 GID
  var used = {};        // gid -> true（用对象模拟有序集合，按插入序）
  var usedUnicode = {}; // code -> true
  var usedList = [];    // 有序 gid 列表
  function addUsed(gid) {
    if (gid > 0 && !used[gid]) { used[gid] = true; usedList.push(gid); }
  }
  for (var i = 0; i < unicodeChars.length; i++) {
    var u = unicodeChars[i];
    var g = self.getGlyph(u);
    if (g > 0) { addUsed(g); usedUnicode[u] = true; }
  }
  addUsed(0); // .notdef 始终保留
  used[0] = true;
  if (usedList.indexOf(0) < 0) usedList.unshift(0);

  // 2. 展开复合字形引用的组件
  var changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    var snapshot = usedList.slice();
    for (var si = 0; si < snapshot.length; si++) {
      var gid = snapshot[si];
      var start = self._loca[gid];
      var end = self._loca[gid + 1];
      if (end <= start) continue;
      var comps = parseComponents(self, start, end);
      if (comps) {
        for (var ci = 0; ci < comps.length; ci++) {
          var og = comps[ci].oldGid;
          if (!used[og]) { used[og] = true; usedList.push(og); changed = true; }
        }
      }
    }
  }
  usedList.sort(function (a, b) { return a - b; });

  // 3. 旧->新映射（按旧 GID 升序）
  var oldToNew = {};
  var next = 0;
  for (var oi = 0; oi < usedList.length; oi++) oldToNew[usedList[oi]] = next++;
  var newNum = next;

  // 4. 构建新 glyf / loca
  var glyfChunks = [];
  var glyfLen = 0;
  var newLoca = new Uint32Array(newNum + 1);
  for (var bi = 0; bi < usedList.length; bi++) {
    var old = usedList[bi];
    newLoca[bi] = glyfLen;
    var s = self._loca[old];
    var e = self._loca[old + 1];
    var length = e - s;
    if (length <= 0) continue;
    var comps2 = parseComponents(self, s, e);
    var slice = self._glyf.slice(s, e);
    if (comps2) {
      for (var ci2 = 0; ci2 < comps2.length; ci2++) {
        var cr = comps2[ci2];
        var newGid = oldToNew[cr.oldGid];
        var rel = cr.fieldPos - s;
        if (rel + 1 < slice.length) {
          slice[rel] = (newGid >> 8) & 0xFF;
          slice[rel + 1] = newGid & 0xFF;
        }
      }
    }
    glyfChunks.push(slice);
    glyfLen += slice.length;
  }
  newLoca[newNum] = glyfLen;
  var newGlyf = concatU8(glyfChunks, glyfLen);

  // 5. 新 hmtx
  var newAdvance = new Uint16Array(newNum);
  var newLsb = new Int16Array(newNum);
  for (var hi = 0; hi < usedList.length; hi++) {
    var o = usedList[hi];
    newAdvance[hi] = (o < self._advanceWidth.length) ? self._advanceWidth[o] : 0;
    newLsb[hi] = (o < self._lsb.length) ? self._lsb[o] : 0;
  }
  var hmtxChunks = [];
  for (var hmi = 0; hmi < newNum; hmi++) {
    hmtxChunks.push(u8([(newAdvance[hmi] >> 8) & 0xFF, newAdvance[hmi] & 0xFF,
                        (newLsb[hmi] >> 8) & 0xFF, newLsb[hmi] & 0xFF]));
  }
  var newHmtx = concatU8(hmtxChunks, newNum * 4);

  // 6. 新 loca（长格式）
  var locaChunks = [];
  for (var li = 0; li < newLoca.length; li++) {
    var v = newLoca[li];
    locaChunks.push(u8([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]));
  }
  var newLocaBytes = concatU8(locaChunks, newLoca.length * 4);

  // 7. 新 cmap（format 4）
  var newCmap = buildCmapFormat4(self, usedUnicode, oldToNew);

  // 8. 新 head（indexToLocFormat=1）
  var newHead = self._copyTable('head');
  setBe16(newHead, 50, 1);
  setBe32(newHead, 8, 0);

  // 9. 新 hhea（numberOfHMetrics = newNum）
  var newHhea = self._copyTable('hhea');
  setBe16(newHhea, 34, newNum);

  // 10. 新 maxp（numGlyphs）
  var newMaxp = self._copyTable('maxp');
  setBe16(newMaxp, 4, newNum);

  // 11. OS/2：更新 usFirstCharIndex / usLastCharIndex
  var newOS2 = null;
  if (self._tableOffset['OS/2'] && self._tableLength['OS/2'] >= 68) {
    newOS2 = self._copyTable('OS/2');
    var minU = 0x10FFFF, maxU = 0;
    for (var uk in usedUnicode) {
      if (!Object.prototype.hasOwnProperty.call(usedUnicode, uk)) continue;
      var uu = parseInt(uk, 10);
      if (uu < minU) minU = uu;
      if (uu > maxU) maxU = uu;
    }
    setBe16(newOS2, 64, Math.min(minU, 0xFFFF));
    setBe16(newOS2, 66, Math.min(maxU, 0xFFFF));
  }

  // 12. post（3.0）
  var newPost = new Uint8Array(32);
  writeBe32(newPost, 0, 0x00030000);
  writeBe32(newPost, 4, 0);
  writeBe16(newPost, 8, -100 & 0xFFFF); // underlinePosition
  writeBe16(newPost, 10, 50);           // underlineThickness

  // 13. name（最小化）
  var newName = buildMinName('PinyinSubset');

  // 14. 组装
  var tables = {};
  tables['cmap'] = newCmap;
  tables['glyf'] = newGlyf;
  tables['head'] = newHead;
  tables['hhea'] = newHhea;
  tables['hmtx'] = newHmtx;
  tables['loca'] = newLocaBytes;
  tables['maxp'] = newMaxp;
  tables['name'] = newName;
  tables['post'] = newPost;
  if (newOS2) tables['OS/2'] = newOS2;

  var fontBytes = assembleFont(tables);

  var subset = new FontSubset();
  subset.fontBytes = fontBytes;
  subset.oldToNew = oldToNew;
  subset.newNumGlyphs = newNum;
  var u2n = {};
  for (var u2 in usedUnicode) {
    if (!Object.prototype.hasOwnProperty.call(usedUnicode, u2)) continue;
    var code = parseInt(u2, 10);
    var oldGid = self.getGlyph(code);
    u2n[code] = oldToNew[oldGid];
  }
  subset.unicodeToNewGid = u2n;
  return subset;
};

// ---------------- 表构建 ----------------

TtfFont.prototype._copyTable = function (tag) {
  var off = this._tableOffset[tag];
  var len = this._tableLength[tag];
  return this._data.slice(off, off + len);
};

function buildCmapFormat4(font, usedUnicode, oldToNew) {
  var sorted = [];
  for (var uk in usedUnicode) {
    if (Object.prototype.hasOwnProperty.call(usedUnicode, uk)) sorted.push(parseInt(uk, 10));
  }
  sorted.sort(function (a, b) { return a - b; });

  // 分段：连续的码点且新 GID 连续则合并
  var starts = [], ends = [], firstGids = [];
  var i = 0;
  while (i < sorted.length) {
    var segStart = sorted[i];
    var g0 = oldToNew[font.getGlyph(segStart)];
    var segEnd = segStart;
    var j = i + 1;
    while (j < sorted.length) {
      var prev = sorted[j - 1], cur = sorted[j];
      var gp = oldToNew[font.getGlyph(prev)];
      var gc = oldToNew[font.getGlyph(cur)];
      if (cur === prev + 1 && gc === gp + 1) { segEnd = cur; j++; }
      else break;
    }
    starts.push(segStart);
    ends.push(segEnd);
    firstGids.push(g0);
    i = j;
  }

  var segCount = starts.length;
  var parts = [];
  parts.push(u16bytes(4));                     // format
  parts.push(u16bytes(0));                     // length（稍后回填）
  parts.push(u16bytes(0));                     // language
  parts.push(u16bytes(segCount * 2));          // segCountX2
  var pow = 1, entrySelector = 0;
  while (pow * 2 <= segCount) { pow *= 2; entrySelector++; }
  parts.push(u16bytes(pow * 2));               // searchRange
  parts.push(u16bytes(entrySelector));
  parts.push(u16bytes(segCount * 2 - pow * 2)); // rangeShift

  for (var s = 0; s < segCount; s++) parts.push(u16bytes(ends[s]));
  parts.push(u16bytes(0));                     // reservedPad
  for (var s2 = 0; s2 < segCount; s2++) parts.push(u16bytes(starts[s2]));
  for (var s3 = 0; s3 < segCount; s3++) {
    var delta = (firstGids[s3] - starts[s3]) & 0xFFFF;
    parts.push(u16bytes(delta));
  }
  for (var s4 = 0; s4 < segCount; s4++) parts.push(u16bytes(0)); // idRangeOffset = 0

  var sub = concatU8(parts, parts.reduce(function (a, b) { return a + b.length; }, 0));
  setBe16(sub, 2, sub.length); // 回填 length

  // 组装完整 cmap 表：表头 + 编码记录 + format4 子表
  var full = [];
  full.push(u16bytes(0));   // version
  full.push(u16bytes(1));   // numTables
  full.push(u16bytes(3));   // platformID = Windows
  full.push(u16bytes(1));   // encodingID = Unicode BMP
  full.push(u32bytes(12));  // 子表偏移
  full.push(sub);
  return concatU8(full, 12 + sub.length);
}

function buildMinName(family) {
  var str = utf8Encode(family);
  var count = 1;
  var stringOffset = 6 + 12 * count;
  var parts = [];
  parts.push(u16bytes(0));                 // format
  parts.push(u16bytes(count));
  parts.push(u16bytes(stringOffset));
  // name record: platformID=3, encodingID=1, languageID=0x0409, nameID=1
  parts.push(u16bytes(3));
  parts.push(u16bytes(1));
  parts.push(u16bytes(0x0409));
  parts.push(u16bytes(1));
  parts.push(u16bytes(str.length));
  parts.push(u16bytes(0));
  parts.push(str);
  return concatU8(parts, stringOffset + str.length);
}

function utf8Encode(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else {
      out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return u8(out);
}

function u8(arr) { return new Uint8Array(arr); }
function u16bytes(v) { return u8([(v >> 8) & 0xFF, v & 0xFF]); }
function u32bytes(v) { return u8([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]); }

function writeBe16(arr, off, v) {
  arr[off] = (v >> 8) & 0xFF;
  arr[off + 1] = v & 0xFF;
}
function writeBe32(arr, off, v) {
  arr[off] = (v >>> 24) & 0xFF;
  arr[off + 1] = (v >>> 16) & 0xFF;
  arr[off + 2] = (v >>> 8) & 0xFF;
  arr[off + 3] = v & 0xFF;
}
function setBe16(arr, off, v) { writeBe16(arr, off, v); }
function setBe32(arr, off, v) { writeBe32(arr, off, v); }

function concatU8(chunks, total) {
  var out = new Uint8Array(total);
  var p = 0;
  for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
  return out;
}

function checksum(data, start, length) {
  var sum = 0;
  var end = start + length;
  var i = start;
  for (; i + 3 < end; i += 4) {
    sum = (sum + ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3])) >>> 0;
  }
  var rem = end - i;
  if (rem > 0) {
    var v = 0;
    for (var k = 0; k < rem; k++) v |= (data[i + k] << (24 - 8 * k));
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function align4(v) { return (v + 3) & ~3; }

function assembleFont(tables) {
  // 与 C# List<string>.Sort()（culture 排序，忽略大小写）保持一致：
  // cmap, glyf, head, hhea, hmtx, loca, maxp, name, OS/2, post
  var tags = Object.keys(tables).sort(function (a, b) {
    var la = a.toLowerCase(), lb = b.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  var n = tags.length;
  var headerSize = 12 + 16 * n;
  var total = headerSize;
  var tableOffsets = [];
  for (var ti = 0; ti < n; ti++) {
    total = align4(total);
    tableOffsets.push(total);
    total += tables[tags[ti]].length;
  }
  total = align4(total);
  var font = new Uint8Array(total);

  // sfnt 头
  writeBe32(font, 0, 0x00010000); // version 1.0
  writeBe16(font, 4, n);
  var pow = 1, entrySelector = 0;
  while (pow * 2 <= n) { pow *= 2; entrySelector++; }
  writeBe16(font, 6, pow * 16);              // searchRange
  writeBe16(font, 8, entrySelector);
  writeBe16(font, 10, n * 16 - pow * 16);    // rangeShift

  for (var i = 0; i < n; i++) {
    var tag = tags[i];
    var tdata = tables[tag];
    var off = tableOffsets[i];
    var rec = 12 + i * 16;
    font[rec] = tag.charCodeAt(0) & 0xFF;
    font[rec + 1] = tag.charCodeAt(1) & 0xFF;
    font[rec + 2] = tag.charCodeAt(2) & 0xFF;
    font[rec + 3] = tag.charCodeAt(3) & 0xFF;
    writeBe32(font, rec + 8, off);
    writeBe32(font, rec + 12, tdata.length);
    font.set(tdata, off);
  }

  // 计算并写入各表 checksum
  var totalChecksum = checksum(font, 0, headerSize);
  for (var i2 = 0; i2 < n; i2++) {
    var off2 = tableOffsets[i2];
    var cs = checksum(font, off2, tables[tags[i2]].length);
    var rec2 = 12 + i2 * 16;
    writeBe32(font, rec2 + 4, cs);
    totalChecksum = (totalChecksum + cs) >>> 0;
  }

  // head.checkSumAdjustment = 0xB1B0AFBA - totalChecksum
  var headOff = -1;
  for (var i3 = 0; i3 < n; i3++) {
    if (tags[i3] === 'head') { headOff = tableOffsets[i3]; break; }
  }
  if (headOff >= 0) {
    var adj = (0xB1B0AFBA - totalChecksum) >>> 0;
    writeBe32(font, headOff + 8, adj);
  }
  return font;
}

module.exports = {
  TtfFont: TtfFont,
  FontSubset: FontSubset
};
