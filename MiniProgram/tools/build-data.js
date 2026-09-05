#!/usr/bin/env node
/**
 * 预生成小程序数据模块：
 *   packageData/data/pinyin.js     单字拼音（{"4e00":"yī,..."}）
 *   packagePhrase/data/phrase.js   词级拼音（{"银行":"yín háng"}）
 *   packageData/data/zdic.js       补充词库（同 phrase 格式）
 * 数据来自 Unity 项目 Assets/Resources/Data/*.txt，保证与 C# 版完全一致。
 * 分包规划（每个分包 < 2MB）：
 *   packageData   pinyin.js(685KB) + zdic.js(165KB)
 *   packagePhrase phrase.js(1365KB)
 */
'use strict';

var fs = require('fs');
var path = require('path');

var PROJ = path.resolve(__dirname, '../..'); // 项目根目录（ToPinYin）
var DATA = path.join(PROJ, 'Assets/Resources/Data');
var OUT_DATA = path.join(__dirname, '../packageData/data');
var OUT_PHRASE = path.join(__dirname, '../packagePhrase/data');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/** 解析单字数据：U+XXXX: pinyin[,pinyin...]  [# 注释] */
function parseCharData(content) {
  var obj = {};
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    if (line.indexOf('U+') !== 0) continue;
    var colon = line.indexOf(':');
    if (colon < 2) continue;
    var hex = line.substring(2, colon).trim();
    var code = parseInt(hex, 16);
    if (isNaN(code)) continue;
    var pinyins = line.substring(colon + 1);
    var hash = pinyins.indexOf('#');
    if (hash >= 0) pinyins = pinyins.substring(0, hash);
    var readings = pinyins.split(',');
    var list = [];
    for (var r = 0; r < readings.length; r++) {
      var rr = readings[r].trim();
      if (rr) list.push(rr);
    }
    if (list.length > 0) obj[code.toString(16)] = list.join(',');
  }
  return obj;
}

/** 解析词级数据（兼容冒号 / 空白分隔） */
function parseWordData(content) {
  var obj = {};
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    var word, pinyinPart;
    var colon = line.indexOf(':');
    if (colon > 0) {
      word = line.substring(0, colon).trim();
      pinyinPart = line.substring(colon + 1).trim();
    } else {
      var m = line.match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      word = m[1];
      pinyinPart = m[2].trim();
    }
    if (word.length < 2) continue;
    var syls = pinyinPart.split(/\s+/);
    if (syls.length !== word.length) continue;
    // 校验：拼音数量必须等于字数，否则丢弃（与 C# 行为一致）
    obj[word] = syls.join(' ');
  }
  return obj;
}

function writeModule(file, obj) {
  var keys = Object.keys(obj);
  var chunks = [];
  var line = [];
  var size = 0;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var entry = JSON.stringify(k) + ':' + JSON.stringify(obj[k]);
    line.push(entry);
    size += entry.length + 1;
    if (line.length >= 400 || size >= 200000) {
      chunks.push('  ' + line.join(',') + ',\n');
      line = [];
      size = 0;
    }
  }
  if (line.length > 0) chunks.push('  ' + line.join(',') + '\n');
  var body = '/* 自动生成，请勿手改。来源：Assets/Resources/Data */\n' +
             "'use strict';\nmodule.exports = {\n" + chunks.join('') + '};\n';
  fs.writeFileSync(file, body, 'utf8');
  console.log('write ' + path.basename(file) + '  ' + keys.length + ' 条  ' +
              Math.round(fs.statSync(file).size / 1024) + ' KB');
}

ensureDir(OUT_DATA);
ensureDir(OUT_PHRASE);

var charData = parseCharData(fs.readFileSync(path.join(DATA, 'pinyin.txt'), 'utf8'));
writeModule(path.join(OUT_DATA, 'pinyin.js'), charData);

var phraseData = parseWordData(fs.readFileSync(path.join(DATA, 'phrase_pinyin.txt'), 'utf8'));
writeModule(path.join(OUT_PHRASE, 'phrase.js'), phraseData);

var zdicData = parseWordData(fs.readFileSync(path.join(DATA, 'zdic_cibs.txt'), 'utf8'));
writeModule(path.join(OUT_DATA, 'zdic.js'), zdicData);

console.log('数据模块生成完毕。');
