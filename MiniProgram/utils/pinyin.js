/**
 * 中文 → 带声调拼音引擎 —— PinyinEngine.cs 的 JS 移植。
 * 词库优先进行最大匹配分词，未命中词语的汉字取单字默认读音（常见读音）。
 * 纯逻辑，不依赖 wx / Node。
 */
'use strict';

var tone = require('./tone');
var ToneStyle = tone.ToneStyle;

/** 单个汉字的拼音信息。 */
function CharPinyin(ch, py) {
  this.char = ch;
  this.pinyin = py || '';
  this.tone = tone.detectTone(this.pinyin);
  this.isCjk = true;
}

/** 一行文本切分后的一个片段（一段连续汉字，或一段非汉字）。 */
function PinyinToken(source, isCjk) {
  this.source = source;
  this.isCjk = isCjk;
  this.items = []; // 仅 CJK 片段填充 CharPinyin[]
}

/** 输入中的一行。 */
function PinyinLine(source) {
  this.source = source;
  this.tokens = [];
}

/** 整个输入文本的转换结果。 */
function PinyinResult() {
  this.lines = [];
  this.cjkCharCount = 0;
  this.totalCharCount = 0;
}

PinyinResult.prototype.allChars = function () {
  var list = [];
  for (var li = 0; li < this.lines.length; li++) {
    var toks = this.lines[li].tokens;
    for (var ti = 0; ti < toks.length; ti++) {
      if (toks[ti].isCjk) list = list.concat(toks[ti].items);
    }
  }
  return list;
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 中文 → 带声调拼音引擎。 */
function PinyinEngine() {
  this._charReadings = null;   // code(int) -> 读音列表（第一个为默认读音）
  this._wordDict = {};         // 词语 -> 每字读音数组
  this._maxWordLen = 0;
}

/** 加载单字拼音数据（pinyin.txt 文本格式，兼容原版）。 */
PinyinEngine.prototype.loadCharData = function (content) {
  this._charReadings = {};
  if (!content) return false;
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length === 0 || line.charAt(0) === '#') continue;
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
      if (rr.length > 0) list.push(rr);
    }
    if (list.length > 0) this._charReadings[code] = list;
  }
  return Object.keys(this._charReadings).length > 0;
};

/**
 * 加载预生成的单字数据模块（{"4e00":"yī", "3007":"líng,yuán,xīng", ...}）。
 */
PinyinEngine.prototype.loadCharObject = function (obj) {
  this._charReadings = {};
  if (!obj) return false;
  for (var k in obj) {
    if (!hasOwn(obj, k)) continue;
    var code = parseInt(k, 16);
    if (isNaN(code)) continue;
    this._charReadings[code] = String(obj[k]).split(',');
  }
  return Object.keys(this._charReadings).length > 0;
};

/**
 * 加载词级拼音数据（文本格式，兼容 phrase-pinyin-data 与 zdic 两种格式）。
 * 返回加载的词条数。
 */
PinyinEngine.prototype.loadWordData = function (content) {
  var count = 0;
  if (!content) return 0;
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length === 0 || line.charAt(0) === '#') continue;
    var word, pinyinPart;
    var colon = line.indexOf(':');
    if (colon > 0) {
      word = line.substring(0, colon).trim();
      pinyinPart = line.substring(colon + 1).trim();
    } else {
      var sep = indexOfWhitespace(line);
      if (sep <= 0) continue;
      word = line.substring(0, sep).trim();
      pinyinPart = line.substring(sep).trim();
    }
    if (word.length < 2) continue;
    var syls = pinyinPart.split(/\s+/);
    if (syls.length !== word.length) continue;
    this._addWord(word, syls);
    count++;
  }
  return count;
};

/**
 * 加载预生成的词库数据模块（{"银行":"yín háng", ...}）。
 * 返回加载的词条数。
 */
PinyinEngine.prototype.loadWordObject = function (obj) {
  var count = 0;
  if (!obj) return 0;
  for (var w in obj) {
    if (!hasOwn(obj, w)) continue;
    var syls = String(obj[w]).split(' ');
    if (w.length < 2 || syls.length !== w.length) continue;
    this._addWord(w, syls);
    count++;
  }
  return count;
};

function indexOfWhitespace(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u3000') return i;
  }
  return -1;
}

PinyinEngine.prototype._addWord = function (word, syls) {
  this._wordDict[word] = syls;
  if (word.length > this._maxWordLen) this._maxWordLen = word.length;
};

/** 取单个汉字的默认（最常见）读音。 */
PinyinEngine.prototype.defaultPinyin = function (c) {
  var readings = this._charReadings ? this._charReadings[c.charCodeAt(0)] : null;
  return (readings && readings.length > 0) ? readings[0] : '';
};

/** 该汉字是否有拼音数据。 */
PinyinEngine.prototype.hasPinyin = function (c) {
  return !!this._charReadings && hasOwn(this._charReadings, c.charCodeAt(0));
};

/** 判断是否为 CJK 汉字。 */
PinyinEngine.isCjk = function (c) {
  var u = c.charCodeAt(0);
  if (u >= 0x4E00 && u <= 0x9FFF) return true;
  if (u >= 0x3400 && u <= 0x4DBF) return true;
  if (u >= 0xF900 && u <= 0xFAFF) return true;
  if (u >= 0x20000 && u <= 0x2A6DF) return true;
  if (u >= 0x2A700 && u <= 0x2EBEF) return true;
  return false;
};

/** 转换整段文本。 */
PinyinEngine.prototype.convert = function (text) {
  var result = new PinyinResult();
  if (!text) return result;
  var normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var rawLines = normalized.split('\n');
  for (var i = 0; i < rawLines.length; i++) {
    var line = new PinyinLine(rawLines[i]);
    this._convertLine(rawLines[i], line);
    result.lines.push(line);
    result.totalCharCount += rawLines[i].length;
  }
  for (var j = 0; j < normalized.length; j++) {
    if (PinyinEngine.isCjk(normalized.charAt(j))) result.cjkCharCount++;
  }
  return result;
};

PinyinEngine.prototype._convertLine = function (lineText, line) {
  var i = 0, n = lineText.length;
  while (i < n) {
    if (PinyinEngine.isCjk(lineText.charAt(i))) {
      var start = i;
      while (i < n && PinyinEngine.isCjk(lineText.charAt(i))) i++;
      var run = lineText.substring(start, i);
      var token = new PinyinToken(run, true);
      this._segmentCjk(run, token.items);
      line.tokens.push(token);
    } else {
      var s2 = i;
      while (i < n && !PinyinEngine.isCjk(lineText.charAt(i))) i++;
      line.tokens.push(new PinyinToken(lineText.substring(s2, i), false));
    }
  }
};

/** 对一段连续汉字进行最大匹配分词并逐字注音。 */
PinyinEngine.prototype._segmentCjk = function (run, output) {
  var i = 0, n = run.length;
  while (i < n) {
    var bestLen = 0, bestReadings = null;
    var maxTry = this._maxWordLen;
    if (maxTry > n - i) maxTry = n - i;
    // 与 C# Trie 等价：取「以 i 开头的最长词条」
    for (var len = maxTry; len >= 2; len--) {
      var word = run.substr(i, len);
      if (hasOwn(this._wordDict, word)) {
        bestLen = len;
        bestReadings = this._wordDict[word];
        break;
      }
    }
    if (bestLen > 1 && bestReadings) {
      for (var k = 0; k < bestLen; k++) {
        output.push(new CharPinyin(run.charAt(i + k), bestReadings[k]));
      }
      i += bestLen;
    } else {
      output.push(new CharPinyin(run.charAt(i), this.defaultPinyin(run.charAt(i))));
      i++;
    }
  }
};

// ---------------- 渲染辅助 ----------------

/** 渲染单个拼音到指定风格。 */
PinyinEngine.render = function (pinyin, style, uAsV) {
  return tone.convertStyle(pinyin, style, uAsV);
};

/** 整段结果渲染为"原文 + 拼音"（拼音只渲染拼音部分）。 */
PinyinEngine.renderResult = function (result, style, uAsV, includeSource, syllableSep) {
  var sb = '';
  for (var li = 0; li < result.lines.length; li++) {
    var line = result.lines[li];
    if (li > 0) sb += '\n';
    var source = '', pinyin = '';
    var toks = line.tokens;
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti];
      if (!t.isCjk) {
        source += t.source;
        pinyin += t.source;
      } else {
        source += t.source;
        for (var k = 0; k < t.items.length; k++) {
          if (k > 0) pinyin += syllableSep;
          pinyin += PinyinEngine.render(t.items[k].pinyin, style, uAsV);
        }
      }
    }
    if (includeSource) {
      sb += source;
      if (source.length > 0 && pinyin.length > 0) sb += '  ';
      sb += pinyin;
    } else {
      sb += pinyin;
    }
  }
  return sb;
};

/** 渲染"拼音在上"排版中某行的拼音行：按词/音节分组、空格分隔、省略标点。 */
PinyinEngine.renderLinePinyinAbove = function (line, style, uAsV) {
  var sb = '', first = true;
  var toks = line.tokens;
  for (var ti = 0; ti < toks.length; ti++) {
    var t = toks[ti];
    if (!t.isCjk) continue;
    for (var k = 0; k < t.items.length; k++) {
      var py = PinyinEngine.render(t.items[k].pinyin, style, uAsV);
      if (py.length === 0) continue;
      if (!first) sb += ' ';
      sb += py;
      first = false;
    }
  }
  return sb;
};

/** 渲染为"汉字(拼音)"逐字对照形式。 */
PinyinEngine.renderParenthesis = function (result, style, uAsV) {
  var sb = '';
  for (var li = 0; li < result.lines.length; li++) {
    var line = result.lines[li];
    if (li > 0) sb += '\n';
    var toks = line.tokens;
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti];
      if (!t.isCjk) {
        sb += t.source;
      } else {
        for (var k = 0; k < t.items.length; k++) {
          var cp = t.items[k];
          sb += cp.char + '(' + PinyinEngine.render(cp.pinyin, style, uAsV) + ')';
        }
      }
    }
  }
  return sb;
};

module.exports = {
  ToneStyle: ToneStyle,
  CharPinyin: CharPinyin,
  PinyinToken: PinyinToken,
  PinyinLine: PinyinLine,
  PinyinResult: PinyinResult,
  PinyinEngine: PinyinEngine
};
