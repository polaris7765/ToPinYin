#!/usr/bin/env node
/**
 * 预生成 PDF 内嵌用「源字体」子集：
 *   packageFontA/font-part1.js + font-part3.js
 *   packageFontB/font-part2.js
 * 字符集 = charset.json（GB2312 全部 + 拼音声调字母 + ASCII + 全角标点）。
 * 运行时还会对实际用到的字符做二次子集化，PDF 通常只有几十 KB。
 * 分包规划：packageFontA 1731KB + packageFontB 1229KB（各 < 2MB）。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var PROJ = path.resolve(__dirname, '../..');
var ttf = require('../utils/ttf');
var base64 = require('../utils/base64');

var FONT_SRC = path.join(PROJ, 'Assets/StreamingAssets/NotoSansSC.ttf');
var CHARSET = JSON.parse(fs.readFileSync(path.join(__dirname, 'charset.json'), 'utf8'));
var OUT_A = path.join(__dirname, '../packageFontA');
var OUT_B = path.join(__dirname, '../packageFontB');

// 每个分片模块的目标大小（保证单分包 < 2MB，且单文件不超大）
var PART_TARGET = 1200 * 1024;

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

var fontBytes = new Uint8Array(fs.readFileSync(FONT_SRC));
console.log('源字体: ' + Math.round(fontBytes.length / 1024) + ' KB');

var font = new ttf.TtfFont();
if (!font.parse(fontBytes)) { console.error('字体解析失败'); process.exit(1); }
console.log('unitsPerEm=' + font.unitsPerEm + ' numGlyphs=' + font.numGlyphs);

// 覆盖检查
var missing = [];
for (var i = 0; i < CHARSET.length; i++) {
  if (!font.hasGlyph(CHARSET[i])) missing.push(CHARSET[i]);
}
console.log('字符集 ' + CHARSET.length + '，字体缺失 ' + missing.length + '：' +
  missing.slice(0, 20).map(function (c) { return 'U+' + c.toString(16); }).join(' '));

// 子集化
var subset = font.buildSubset(CHARSET);
console.log('子集字形数: ' + subset.newNumGlyphs + '，子集大小: ' +
  Math.round(subset.fontBytes.length / 1024) + ' KB');

// 校验：子集可被再次解析
var sub2 = new ttf.TtfFont();
var ok = sub2.parse(subset.fontBytes);
console.log('子集可再解析: ' + ok + '，numGlyphs=' + (ok ? sub2.numGlyphs : -1));

// base64 分片
var b64 = base64.encode(subset.fontBytes);
console.log('base64 总长: ' + Math.round(b64.length / 1024) + ' KB');
var parts = [];
for (var p = 0; p < b64.length; p += PART_TARGET) {
  parts.push(b64.substring(p, p + PART_TARGET));
}
console.log('分片数: ' + parts.length);

ensureDir(OUT_A);
ensureDir(OUT_B);
// 分片写入 A/B 两个分包，保证每个分包 < 2MB：交替分配（A: 1,3  B: 2）
var targets = [OUT_A, OUT_B];
for (var pi = 0; pi < parts.length; pi++) {
  var dir = targets[pi % 2];
  var file = path.join(dir, 'font-part' + (pi + 1) + '.js');
  var body = '/* 自动生成：NotoSansSC.ttf 子集（GB2312+拼音字母+ASCII），base64 分片 ' + (pi + 1) + '/' + parts.length + ' */\n' +
             "'use strict';\nmodule.exports =\n'" + parts[pi] + "';\n";
  fs.writeFileSync(file, body, 'utf8');
  console.log('write ' + path.relative(__dirname + '/..', file) + '  ' + Math.round(fs.statSync(file).size / 1024) + ' KB');
}

console.log('字体模块生成完毕。');
