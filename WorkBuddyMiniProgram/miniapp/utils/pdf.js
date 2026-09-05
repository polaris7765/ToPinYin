/**
 * 纯 JS 生成 PDF（内嵌 TrueType 子集字体，Identity-H 编码，支持文字复制）——
 * PdfBuilder.cs 的移植。不依赖任何第三方库。
 */
'use strict';

var pinyin = require('./pinyin');
var ttfMod = require('./ttf');

var PageW = 595.28;
var PageH = 841.89;
var Margin = 50;
var ContentW = PageW - Margin * 2;
var FontName = 'ABCDEF+PinyinSubset';

function PdfOptions(o) {
  o = o || {};
  this.title = o.title !== undefined ? o.title : '中文拼音对照表';
  this.toneStyle = o.toneStyle !== undefined ? o.toneStyle : pinyin.ToneStyle.Symbol;
  this.uAsV = !!o.uAsV;
  this.timestamp = o.timestamp || '';
}

// ---------------- 字形/度量 ----------------

function PdfGlyph(font, subset) {
  this.font = font;
  this.subset = subset;
}

PdfGlyph.prototype.widthChar = function (c, size) {
  var oldGid = this.font.getGlyph(c.charCodeAt(0));
  var adv = this.font.getAdvance(oldGid);
  return adv / this.font.unitsPerEm * size;
};

PdfGlyph.prototype.width = function (s, size) {
  var w = 0;
  for (var i = 0; i < s.length; i++) w += this.widthChar(s.charAt(i), size);
  return w;
};

PdfGlyph.prototype.hex = function (s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    var newGid = Object.prototype.hasOwnProperty.call(this.subset.unicodeToNewGid, code)
      ? this.subset.unicodeToNewGid[code] : 0;
    out += pad4(newGid.toString(16).toUpperCase());
  }
  return out;
};

function pad4(h) {
  while (h.length < 4) h = '0' + h;
  return h;
}

// ---------------- 布局 ----------------

function PageInfo() {
  this.contentStreams = []; // 字符串
  this.contentBytes = null;  // Uint8Array 页脚
}

function Layout(opts, result, g) {
  this.opts = opts;
  this.result = result;
  this.g = g;
  this.pages = [];
  this.cur = '';
  this.y = 0;
}

// 注音排版常量
var CharSize = 15, PySize = 7.5, PyGap = 3, UnitGap = 1.5, RowPad = 9;

Layout.prototype.run = function () {
  this.newPage();

  // 标题
  this.title(this.opts.title);

  // 元信息
  var meta = '汉字 ' + this.result.cjkCharCount + ' 个 · 共 ' + this.result.totalCharCount + ' 字';
  if (this.opts.timestamp) meta += ' · 转换时间 ' + this.opts.timestamp;
  this.meta(meta);
  var toneDesc = this.opts.toneStyle === pinyin.ToneStyle.Symbol ? '带声调符号（ā á ǎ à）' :
                 this.opts.toneStyle === pinyin.ToneStyle.Number ? '数字声调（a1 a2 a3 a4）' : '不带声调';
  this.meta('拼音风格：' + toneDesc);

  // 正文：注音排版
  var lines = this.result.lines;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.source.length === 0) {
      this.ensure(24);
      this.y -= 20;
      continue;
    }
    this.annotatedLine(line);
    this.y -= 6;
  }

  this.note();

  // 收尾：把最后一页缓冲落地
  if (this.cur.length > 0) {
    this.pages[this.pages.length - 1].contentStreams.push(this.cur);
    this.cur = '';
  }
  return this.pages;
};

Layout.prototype.newPage = function () {
  if (this.cur.length > 0) {
    this.pages[this.pages.length - 1].contentStreams.push(this.cur);
  }
  this.pages.push(new PageInfo());
  this.cur = '';
  this.y = PageH - Margin;
};

Layout.prototype.ensure = function (dy) {
  if (this.y - dy < Margin) {
    this.pages[this.pages.length - 1].contentStreams.push(this.cur);
    this.pages.push(new PageInfo());
    this.cur = '';
    this.y = PageH - Margin;
  }
};

Layout.prototype.text = function (text, size, r, g, b, x, centered) {
  if (!text) return;
  var w = this.g.width(text, size);
  if (centered) x = x - w / 2;
  this.cur += 'BT /F1 ' + fmt(size) + ' Tf ' + fmt(r) + ' ' + fmt(g) + ' ' + fmt(b) + ' rg ' +
              '1 0 0 1 ' + fmt(x) + ' ' + fmt(this.y) + ' Tm <' + this.g.hex(text) + '> Tj ET\n';
};

/** 在指定基线位置绘制文本（不改变 _y）。 */
Layout.prototype.textAt = function (text, size, r, g, b, x, y) {
  if (!text) return;
  this.cur += 'BT /F1 ' + fmt(size) + ' Tf ' + fmt(r) + ' ' + fmt(g) + ' ' + fmt(b) + ' rg ' +
              '1 0 0 1 ' + fmt(x) + ' ' + fmt(y) + ' Tm <' + this.g.hex(text) + '> Tj ET\n';
};

Layout.prototype.title = function (s) {
  this.text(s, 22, 0.184, 0.329, 0.588, PageW / 2, true);
  this.y -= 30;
};

Layout.prototype.meta = function (s) {
  this.text(s, 10, 0.349, 0.349, 0.349, PageW / 2, true);
  this.y -= 16;
};

Layout.prototype.note = function () {
  this.ensure(30);
  this.y -= 8;
  this.text('注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。', 9, 0.502, 0.502, 0.502, Margin);
  this.y -= 14;
};

Layout.prototype.annotatedLine = function (line) {
  var units = this.buildUnits(line);
  var row = [];
  var rowW = 0;

  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var topW = u.top.length > 0 ? this.g.width(u.top, PySize) : 0;
    var baseW = this.g.width(u.base, CharSize);
    u.w = Math.max(topW, baseW) + UnitGap;

    if (rowW + u.w > ContentW && row.length > 0) {
      this.drawRow(row);
      row = [];
      rowW = 0;
    }
    row.push(u);
    rowW += u.w;
  }
  if (row.length > 0) this.drawRow(row);
};

Layout.prototype.drawRow = function (row) {
  var rowH = PySize + PyGap + CharSize + RowPad;
  this.ensure(rowH);

  var pyBaseline = this.y - PySize;
  var chBaseline = pyBaseline - PyGap - CharSize * 0.88;

  var x = Margin;
  for (var i = 0; i < row.length; i++) {
    var u = row[i];
    var colW = u.w - UnitGap;
    if (u.top.length > 0) {
      var w = this.g.width(u.top, PySize);
      this.textAt(u.top, PySize, 0.231, 0.431, 0.965, x + (colW - w) / 2, pyBaseline);
    }
    var bw = this.g.width(u.base, CharSize);
    this.textAt(u.base, CharSize, 0, 0, 0, x + (colW - bw) / 2, chBaseline);
    x += u.w;
  }
  this.y -= rowH;
};

/** 汉字：一字一列（带拼音）；非汉字：字母/数字成词，其余逐字符成列。 */
Layout.prototype.buildUnits = function (line) {
  var units = [];
  var toks = line.tokens;
  for (var ti = 0; ti < toks.length; ti++) {
    var t = toks[ti];
    if (t.isCjk) {
      for (var k = 0; k < t.items.length; k++) {
        var cp = t.items[k];
        units.push({
          top: pinyin.PinyinEngine.render(cp.pinyin, this.opts.toneStyle, this.opts.uAsV),
          base: cp.char,
          w: 0
        });
      }
      continue;
    }
    var s = t.source;
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (isLetterOrDigit(c)) {
        var j = i;
        while (j < s.length && isLetterOrDigit(s.charAt(j))) j++;
        units.push({ top: '', base: s.substring(i, j), w: 0 });
        i = j;
      } else {
        units.push({ top: '', base: c, w: 0 });
        i++;
      }
    }
  }
  return units;
};

function isLetterOrDigit(c) {
  var u = c.charCodeAt(0);
  return (u >= 48 && u <= 57) || (u >= 65 && u <= 90) || (u >= 97 && u <= 122);
}

/** 按最大宽度换行（CJK 任意断行，拉丁词按空格断行）。 */
function wrap(text, widths, maxWidth) {
  var result = [];
  if (!text) { result.push(''); return result; }
  var n = text.length;
  var lineStart = 0;
  var lastSpace = -1;
  var width = 0;
  for (var i = 0; i < n; i++) {
    var c = text.charAt(i);
    if (c === ' ') lastSpace = i;
    var w = widths[i];
    if (width + w > maxWidth && i > lineStart) {
      var cut = (lastSpace >= lineStart) ? lastSpace : i;
      var piece = text.substring(lineStart, cut).replace(/\s+$/, '');
      if (piece.length > 0) result.push(piece);
      var nextStart = (lastSpace >= lineStart) ? lastSpace + 1 : i;
      lineStart = nextStart;
      lastSpace = -1;
      width = 0;
      for (var k = nextStart; k < i; k++) {
        if (text.charAt(k) === ' ') lastSpace = k;
        width += widths[k];
      }
      i--;
      continue;
    }
    width += w;
  }
  var last = text.substring(lineStart).replace(/\s+$/, '');
  if (last.length > 0 || result.length === 0) result.push(last);
  return result;
}

// ---------------- 主入口 ----------------

/**
 * 生成 PDF 字节（Uint8Array）。
 * @param {object} result  PinyinResult
 * @param {object} opts    PdfOptions
 * @param {Uint8Array} fontBytes 源字体（TTF）
 */
function build(result, opts, fontBytes) {
  if (!opts) opts = new PdfOptions();
  else opts = new PdfOptions(opts);

  var font = new ttfMod.TtfFont();
  if (!font.parse(fontBytes)) throw new Error('无法解析字体文件');

  // 收集需要用到（并子集化）的全部字符
  var used = collectUsedChars(result);

  var subset = font.buildSubset(used);
  var g = new PdfGlyph(font, subset);

  // 布局
  var layout = new Layout(opts, result, g);
  var pages = layout.run();

  // 页脚（第 X 页）——使用子集字形（Identity-H），否则中文会乱码
  for (var i = 0; i < pages.length; i++) {
    var footer = '中文拼音助手 · 第 ' + (i + 1) + ' / ' + pages.length + ' 页';
    var fs = 9;
    var fw = g.width(footer, fs);
    var fb = 'BT /F1 ' + fmt(fs) + ' Tf 0.55 0.55 0.55 rg 1 0 0 1 ' +
             fmt(PageW / 2 - fw / 2) + ' ' + fmt(30) + ' Tm <' + g.hex(footer) + '> Tj ET\n';
    pages[i].contentBytes = asciiBytes(fb);
  }

  return assemblePdf(pages, g, font, subset, opts);
}

function collectUsedChars(result) {
  var used = [];
  var seen = {};
  function add(s) {
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (!seen[code]) { seen[code] = true; used.push(code); }
    }
  }
  add('中文拼音对照表');
  add('中文拼音助手 · 第 页 / 共 字');
  add('汉字 个 · 转换时间 ：-:.0123456789（）()');
  add('拼音风格：带声调符号数字（ā á ǎ à a1 a2 a3 a4）');
  add('注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。');

  var lines = result.lines;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    add(line.source);
    var toks = line.tokens;
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti];
      if (!t.isCjk) continue;
      for (var k = 0; k < t.items.length; k++) {
        add(t.items[k].pinyin);
      }
    }
  }
  return used;
}

// ---------------- 组装 PDF ----------------

function ByteWriter() {
  this.chunks = [];
  this.len = 0;
}
ByteWriter.prototype.write = function (u8) {
  this.chunks.push(u8);
  this.len += u8.length;
};
ByteWriter.prototype.ascii = function (s) {
  this.write(asciiBytes(s));
};
ByteWriter.prototype.toU8 = function () {
  var out = new Uint8Array(this.len);
  var p = 0;
  for (var i = 0; i < this.chunks.length; i++) { out.set(this.chunks[i], p); p += this.chunks[i].length; }
  return out;
};

function asciiBytes(s) {
  // 与 C# Encoding.ASCII.GetBytes 语义一致：非 ASCII 字符替换为 '?'
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    out[i] = c < 128 ? c : 0x3F;
  }
  return out;
}

function fmt(v) {
  var r = Math.round(v * 100) / 100;
  var s = r.toString();
  return s;
}

function assemblePdf(pages, glyph, font, subset, opts) {
  var pdf = new ByteWriter();
  var offsets = [];
  pdf.ascii('%PDF-1.4\n');

  // 对象编号分配
  var objCatalog = 1, objPages = 2, objType0 = 3, objCid = 4, objDescriptor = 5;
  var objFontFile = 6, objToUnicode = 7, objPageStart = 8;
  var objContentStart = objPageStart + pages.length;
  var objInfo = objContentStart + pages.length;

  // 1. Catalog
  writeObjStart(pdf, offsets, objCatalog);
  pdf.ascii('<< /Type /Catalog /Pages ' + objPages + ' 0 R >>');
  writeObjEnd(pdf);

  // 2. Pages
  writeObjStart(pdf, offsets, objPages);
  var kids = '';
  for (var i = 0; i < pages.length; i++) {
    if (i > 0) kids += ' ';
    kids += (objPageStart + i) + ' 0 R';
  }
  pdf.ascii('<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  writeObjEnd(pdf);

  // 3. Type0 字体
  writeObjStart(pdf, offsets, objType0);
  pdf.ascii('<< /Type /Font /Subtype /Type0 /BaseFont /' + FontName + ' /Encoding /Identity-H ' +
            '/DescendantFonts [' + objCid + ' 0 R] /ToUnicode ' + objToUnicode + ' 0 R >>');
  writeObjEnd(pdf);

  // 4. CIDFontType2
  writeObjStart(pdf, offsets, objCid);
  pdf.ascii('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + FontName + ' ' +
            '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
            '/FontDescriptor ' + objDescriptor + ' 0 R /DW 1000 /W ' + buildWArray(subset, font) +
            ' /CIDToGIDMap /Identity >>');
  writeObjEnd(pdf);

  // 5. FontDescriptor（与 C# 输出逐字节对齐：ascent/descent 用双精度计算；
  //    capHeight 复现 0.7f*1000f 的单精度截断结果 699）
  var upm = font.unitsPerEm;
  var ascent = Math.floor(font.ascent / upm * 1000);
  var descent = Math.floor(font.descent / upm * 1000);
  var capHeight = Math.floor(Math.fround(0.7) * 1000);
  writeObjStart(pdf, offsets, objDescriptor);
  pdf.ascii('<< /Type /FontDescriptor /FontName /' + FontName + ' /Flags 32 ' +
            '/FontBBox [' + font.xMin + ' ' + font.yMin + ' ' + font.xMax + ' ' + font.yMax + '] ' +
            '/ItalicAngle 0 /Ascent ' + ascent + ' /Descent ' + descent + ' /CapHeight ' + capHeight +
            ' /StemV 80 /FontFile2 ' + objFontFile + ' 0 R >>');
  writeObjEnd(pdf);

  // 6. FontFile2（子集字体二进制流）
  writeStream(pdf, offsets, objFontFile, subset.fontBytes, '<< /Length ' + subset.fontBytes.length + ' >>');

  // 7. ToUnicode
  var touc = asciiBytes(buildToUnicode(subset));
  writeStream(pdf, offsets, objToUnicode, touc, '<< /Length ' + touc.length + ' >>');

  // 8. 页面对象 + 内容流
  for (var pi = 0; pi < pages.length; pi++) {
    var pageObj = objPageStart + pi;
    writeObjStart(pdf, offsets, pageObj);
    pdf.ascii('<< /Type /Page /Parent ' + objPages + ' 0 R /MediaBox [0 0 ' + fmt(PageW) + ' ' + fmt(PageH) + '] ' +
              '/Resources << /Font << /F1 ' + objType0 + ' 0 R >> >> /Contents ' + (objContentStart + pi) + ' 0 R >>');
    writeObjEnd(pdf);
  }

  for (var ci = 0; ci < pages.length; ci++) {
    var content = concatContent(pages[ci]);
    writeStream(pdf, offsets, objContentStart + ci, content, '<< /Length ' + content.length + ' >>');
  }

  // Info
  writeObjStart(pdf, offsets, objInfo);
  pdf.ascii('<< /Title (' + sanitize(opts.title) + ') /Producer (PinyinApp) /CreationDate (D:20260101000000) >>');
  writeObjEnd(pdf);

  // xref
  var xrefPos = pdf.len;
  pdf.ascii('xref\n0 ' + (objInfo + 1) + '\n');
  pdf.ascii('0000000000 65535 f \n');
  for (var oi = 0; oi < offsets.length; oi++) {
    pdf.ascii(pad10(offsets[oi]) + ' 00000 n \n');
  }
  pdf.ascii('trailer\n<< /Size ' + (objInfo + 1) + ' /Root ' + objCatalog + ' 0 R /Info ' + objInfo + ' 0 R >>\n' +
            'startxref\n' + xrefPos + '\n%%EOF\n');

  return pdf.toU8();
}

function pad10(v) {
  var s = String(v);
  while (s.length < 10) s = '0' + s;
  return s;
}

function concatContent(p) {
  var chunks = [];
  var total = 0;
  for (var i = 0; i < p.contentStreams.length; i++) {
    var b = asciiBytes(p.contentStreams[i]);
    chunks.push(b);
    total += b.length;
  }
  if (p.contentBytes) { chunks.push(p.contentBytes); total += p.contentBytes.length; }
  var out = new Uint8Array(total);
  var pos = 0;
  for (var j = 0; j < chunks.length; j++) { out.set(chunks[j], pos); pos += chunks[j].length; }
  return out;
}

function buildWArray(subset, font) {
  // /W 数组必须使用十进制 CID（c [w1 w2 …] 形式）
  var widths = {};
  var cids = [];
  for (var u in subset.unicodeToNewGid) {
    if (!Object.prototype.hasOwnProperty.call(subset.unicodeToNewGid, u)) continue;
    var newGid = subset.unicodeToNewGid[u];
    if (Object.prototype.hasOwnProperty.call(widths, newGid)) continue;
    var oldGid = font.getGlyph(parseInt(u, 10));
    var adv = font.getAdvance(oldGid);
    widths[newGid] = Math.round(adv / font.unitsPerEm * 1000);
    cids.push(newGid);
  }
  cids.sort(function (a, b) { return a - b; });

  var sb = '[ ';
  var i = 0;
  while (i < cids.length) {
    var j = i + 1;
    while (j < cids.length && cids[j] === cids[j - 1] + 1) j++;
    sb += cids[i] + ' [';
    for (var k = i; k < j; k++) {
      if (k > i) sb += ' ';
      sb += widths[cids[k]];
    }
    sb += '] ';
    i = j;
  }
  sb += ']';
  return sb;
}

function buildToUnicode(subset) {
  var sb = '';
  sb += '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n';
  sb += '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n';
  sb += '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n';
  sb += '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';

  var codes = [];
  for (var u in subset.unicodeToNewGid) {
    if (Object.prototype.hasOwnProperty.call(subset.unicodeToNewGid, u)) codes.push(parseInt(u, 10));
  }
  codes.sort(function (a, b) { return a - b; });
  sb += codes.length + ' beginbfchar\n';
  for (var i = 0; i < codes.length; i++) {
    var u = codes[i];
    var gid = subset.unicodeToNewGid[u];
    var hex;
    if (u <= 0xFFFF) hex = pad4(u.toString(16).toUpperCase());
    else {
      var v = u - 0x10000;
      var hi = 0xD800 + (v >> 10);
      var lo = 0xDC00 + (v & 0x3FF);
      hex = pad4(hi.toString(16).toUpperCase()) + pad4(lo.toString(16).toUpperCase());
    }
    sb += '<' + pad4(gid.toString(16).toUpperCase()) + '> <' + hex + '>\n';
  }
  sb += 'endbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  return sb;
}

function sanitize(s) {
  if (!s) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function writeObjStart(pdf, offsets, num) {
  offsets.push(pdf.len);
  pdf.ascii(num + ' 0 obj\n');
}

function writeObjEnd(pdf) {
  pdf.ascii('\nendobj\n');
}

function writeStream(pdf, offsets, num, data, dict) {
  offsets.push(pdf.len);
  pdf.ascii(num + ' 0 obj\n' + dict + '\nstream\n');
  pdf.write(data);
  pdf.ascii('\nendstream\nendobj\n');
}

module.exports = {
  PdfOptions: PdfOptions,
  build: build,
  wrap: wrap
};
