#!/usr/bin/env node
/**
 * Node 对拍测试：验证 JS 移植版与 C# 参照版行为一致。
 * 参照物：
 *   - Tools/Test/out/result.txt    （C# 渲染的逐字对照文本）
 *   - Tools/Test/out/test.docx     （C# 生成的 docx）
 *   - Tools/Test/out/test.pdf      （C# 生成的 pdf）
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var PROJ = path.resolve(__dirname, '../..');
var pinyin = require('../utils/pinyin');
var docx = require('../utils/docx');
var pdf = require('../utils/pdf');
var base64 = require('../utils/base64');

var PinyinEngine = pinyin.PinyinEngine;

// ---------- 加载数据 ----------
var engine = new PinyinEngine();
var pinyinObj = require('../packageData/data/pinyin.js');
var phraseObj = require('../packagePhrase/data/phrase.js');
var zdicObj = require('../packageData/data/zdic.js');
engine.loadCharObject(pinyinObj);
var w1 = engine.loadWordObject(phraseObj);
var w2 = engine.loadWordObject(zdicObj);
console.log('[0] 单字=' + Object.keys(engine._charReadings).length +
  ' 词条=' + (w1 + w2) + ' 最大词长=' + engine._maxWordLen);

// ---------- 1. 拼音引擎对拍 ----------
var tests = [
  '你好，世界！',
  '银行 长大 音乐 重要 快乐 行走 长度',
  '我的书在桌子上。',
  '李白乘舟将欲行，忽闻岸上踏歌声。',
  '普通话测试：zhōng guó 123 abc'
];
tests.forEach(function (t) {
  var r = engine.convert(t);
  console.log('--- 输入: ' + t);
  console.log('  拼音: ' + PinyinEngine.renderResult(r, pinyin.ToneStyle.Symbol, false, false, ' '));
  console.log('  逐字: ' + PinyinEngine.renderParenthesis(r, pinyin.ToneStyle.Symbol, false));
  console.log('  数字: ' + PinyinEngine.renderResult(r, pinyin.ToneStyle.Number, true, false, ' '));
});

// ---------- 2. 综合长文本 + 与 result.txt 对拍 ----------
var big = engine.convert(
  '你好，世界！这是中文拼音转换应用，可以导出 Word 和 PDF 文档。' +
  '银行、长大、音乐、重要、快乐、行走。\n' +
  '多音字消歧示例：重庆 长安 朝阳 校长 干净 方便。');
console.log('[2] 长文本汉字数: ' + big.cjkCharCount + '，总字数: ' + big.totalCharCount + '，行数: ' + big.lines.length);

var jsText = PinyinEngine.renderParenthesis(big, pinyin.ToneStyle.Symbol, false);
var refText = fs.readFileSync(path.join(PROJ, 'Tools/Test/out/result.txt'), 'utf8');
console.log('[2a] 逐字对照 == C# result.txt : ' + (jsText === refText ? '一致 ✓' : '不一致 ✗'));
if (jsText !== refText) {
  for (var i = 0; i < Math.min(jsText.length, refText.length); i++) {
    if (jsText[i] !== refText[i]) {
      console.log('  首个差异位置 ' + i + ': JS="' + jsText.substring(i - 20, i + 20) +
        '" C#="' + refText.substring(i - 20, i + 20) + '"');
      break;
    }
  }
}

// ---------- 3. DOCX 对拍 ----------
var TS = '2026-09-02 12:00:00';
var docxBytes = docx.build(big, { toneStyle: pinyin.ToneStyle.Symbol, timestamp: TS });
console.log('[3] JS docx: ' + docxBytes.length + ' bytes');

// 解压 JS docx 的 document.xml
function unzipXml(buf) {
  // 简易 ZIP 读取：定位 central directory 中 word/document.xml，按 store 解出
  var u8 = new Uint8Array(buf);
  var dv = new DataView(buf);
  // 找 EOCD
  var eocd = -1;
  for (var i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no eocd');
  var cdOffset = dv.getUint32(eocd + 16, true);
  var cdEntries = dv.getUint16(eocd + 10, true);
  for (var e = 0; e < cdEntries; e++) {
    var p = cdOffset;
    for (var k = 0; k < e; k++) {
      var nLen = dv.getUint16(p + 28, true);
      var xLen = dv.getUint16(p + 30, true);
      var cLen = dv.getUint16(p + 32, true);
      p += 46 + nLen + xLen + cLen;
    }
    var nameLen2 = dv.getUint16(p + 28, true);
    var name = '';
    for (var bi = 0; bi < nameLen2; bi++) name += String.fromCharCode(u8[p + 46 + bi]);
    if (name === 'word/document.xml') {
      var localOff = dv.getUint32(p + 42, true);
      var compSize = dv.getUint32(p + 20, true);
      var method = dv.getUint16(p + 10, true);
      var dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
      var data = u8.slice(dataStart, dataStart + compSize);
      if (method === 8) {
        return zlib.inflateRawSync(Buffer.from(data)).toString('utf8');
      }
      return Buffer.from(data).toString('utf8');
    }
  }
  throw new Error('document.xml not found');
}

// 解压 C# docx
function unzipCSharpXml(file) {
  var buf = fs.readFileSync(file);
  // 使用同样的简易读取
  var u8 = new Uint8Array(buf);
  var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  var eocd = -1;
  for (var i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  var cdOffset = dv.getUint32(eocd + 16, true);
  var cdEntries = dv.getUint16(eocd + 10, true);
  for (var e = 0; e < cdEntries; e++) {
    var p = cdOffset;
    for (var k = 0; k < e; k++) {
      var nLen = dv.getUint16(p + 28, true);
      var xLen = dv.getUint16(p + 30, true);
      var cLen = dv.getUint16(p + 32, true);
      p += 46 + nLen + xLen + cLen;
    }
    var nameLen2 = dv.getUint16(p + 28, true);
    var name = '';
    for (var bi = 0; bi < nameLen2; bi++) name += String.fromCharCode(u8[p + 46 + bi]);
    if (name === 'word/document.xml') {
      var localOff = dv.getUint32(p + 42, true);
      var compSize = dv.getUint32(p + 20, true);
      var method = dv.getUint16(p + 10, true);
      var dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
      var data = u8.slice(dataStart, dataStart + compSize);
      if (method === 8) return zlib.inflateRawSync(Buffer.from(data)).toString('utf8');
      return Buffer.from(data).toString('utf8');
    }
  }
  throw new Error('document.xml not found');
}

var jsXml = unzipXml(docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength));
var csharpXml = unzipCSharpXml(path.join(PROJ, 'Tools/Test/out/test.docx'));
console.log('[3a] document.xml == C# : ' + (jsXml === csharpXml ? '一致 ✓' : '不一致 ✗'));
if (jsXml !== csharpXml) {
  for (var x = 0; x < Math.min(jsXml.length, csharpXml.length); x++) {
    if (jsXml[x] !== csharpXml[x]) {
      console.log('  doc 差异位置 ' + x + ':\n  JS=' + jsXml.substring(x - 60, x + 60) + '\n  C#=' + csharpXml.substring(x - 60, x + 60));
      break;
    }
  }
}

// ---------- 4. PDF 对拍 ----------
// 4a. 与 C# 同源（原始 NotoSansSC.ttf）→ 期望字节级一致
var origFontBytes = new Uint8Array(fs.readFileSync(path.join(PROJ, 'Assets/StreamingAssets/NotoSansSC.ttf')));
var jsPdfOrig = pdf.build(big, { toneStyle: pinyin.ToneStyle.Symbol, timestamp: TS }, origFontBytes);
console.log('[4] JS pdf(原始字体): ' + jsPdfOrig.length + ' bytes');

var refPdf = fs.readFileSync(path.join(PROJ, 'Tools/Test/out/test.pdf'));
var same = jsPdfOrig.length === refPdf.length;
if (same) {
  for (var pb = 0; pb < jsPdfOrig.length; pb++) {
    if (jsPdfOrig[pb] !== refPdf[pb]) { same = false; break; }
  }
}
console.log('[4a] PDF == C# test.pdf 字节级一致: ' + (same ? '一致 ✓' : '不一致 ✗'));
if (!same) {
  var firstDiff = -1, diffCount = 0;
  for (var pd = 0; pd < Math.min(jsPdfOrig.length, refPdf.length); pd++) {
    if (jsPdfOrig[pd] !== refPdf[pd]) { if (firstDiff < 0) firstDiff = pd; diffCount++; }
  }
  console.log('  len JS=' + jsPdfOrig.length + ' C#=' + refPdf.length + ' 首个差异@' + firstDiff + ' 差异数=' + diffCount);
  if (firstDiff >= 0) {
    console.log('  JS=' + JSON.stringify(jsPdfOrig.slice(Math.max(0, firstDiff - 30), firstDiff + 30).toString('latin1')));
    console.log('  C#=' + JSON.stringify(refPdf.slice(Math.max(0, firstDiff - 30), firstDiff + 30).toString('latin1')));
  }
}

// 4b. 生产路径：预子集字体作为源
// 分片分布：font-part1/3 在 packageFontA，font-part2 在 packageFontB
var fontParts = [];
var fi = 1;
var fontDirs = ['../packageFontA', '../packageFontB'];
while (fs.existsSync(path.join(__dirname, fontDirs[(fi - 1) % 2], 'font-part' + fi + '.js'))) {
  fontParts.push(require(fontDirs[(fi - 1) % 2] + '/font-part' + fi + '.js'));
  fi++;
}
var fontBytes = base64.decode(fontParts.join(''));
var jsPdf = pdf.build(big, { toneStyle: pinyin.ToneStyle.Symbol, timestamp: TS }, fontBytes);
console.log('[4b] JS pdf(预子集字体): ' + jsPdf.length + ' bytes（生产路径）');

// 输出
if (!fs.existsSync(path.join(__dirname, '../out-test'))) fs.mkdirSync(path.join(__dirname, '../out-test'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../out-test/result.txt'), jsText, 'utf8');
fs.writeFileSync(path.join(__dirname, '../out-test/test.docx'), Buffer.from(docxBytes));
fs.writeFileSync(path.join(__dirname, '../out-test/test.pdf'), Buffer.from(jsPdf));
fs.writeFileSync(path.join(__dirname, '../out-test/test-orig.pdf'), Buffer.from(jsPdfOrig));
console.log('ALL DONE');
