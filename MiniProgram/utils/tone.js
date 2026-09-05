/**
 * 声调输出风格与转换工具 —— ToneUtil.cs 的 JS 移植。
 * 纯逻辑，不依赖 wx / Node，可在小程序与 Node 中运行。
 * 声调风格：Symbol(带声调符号 ā) / Number(数字 a1) / None(无声调)
 */
'use strict';

var ToneStyle = { Symbol: 0, Number: 1, None: 2 };

// 带声调字符 -> { base, tone }
var MARKED = {};
(function () {
  function add(marked, base, tone) { MARKED[marked] = { base: base, tone: tone }; }
  add('ā', 'a', 1); add('á', 'a', 2); add('ǎ', 'a', 3); add('à', 'a', 4);
  add('ē', 'e', 1); add('é', 'e', 2); add('ě', 'e', 3); add('è', 'e', 4);
  add('ī', 'i', 1); add('í', 'i', 2); add('ǐ', 'i', 3); add('ì', 'i', 4);
  add('ō', 'o', 1); add('ó', 'o', 2); add('ǒ', 'o', 3); add('ò', 'o', 4);
  add('ū', 'u', 1); add('ú', 'u', 2); add('ǔ', 'u', 3); add('ù', 'u', 4);
  // ü 及其四声
  add('ǖ', 'ü', 1); add('ǘ', 'ü', 2); add('ǚ', 'ü', 3); add('ǜ', 'ü', 4);
  // 罕见的鼻音/唇音声调
  add('ń', 'n', 2); add('ň', 'n', 3); add('ǹ', 'n', 4);
  add('ḿ', 'm', 2);
  add('ế', 'ê', 3); add('ề', 'ê', 4);
})();

function isMarked(c) { return Object.prototype.hasOwnProperty.call(MARKED, c); }

/** 从带声调拼音串中检测声调（1-4），无标记返回 0（轻声）。 */
function detectTone(pinyin) {
  if (!pinyin) return 0;
  for (var i = 0; i < pinyin.length; i++) {
    var mc = MARKED[pinyin.charAt(i)];
    if (mc) return mc.tone;
  }
  return 0;
}

/**
 * 将带声调拼音转换为指定风格。
 * uAsV：数字/无声调模式下，将 ü 写成 v（输入法惯例）。
 */
function convertStyle(pinyin, style, uAsV) {
  if (!pinyin) return pinyin;
  if (style === ToneStyle.Symbol) return pinyin;

  var out = '';
  var tone = 0;
  for (var i = 0; i < pinyin.length; i++) {
    var c = pinyin.charAt(i);
    var mc = MARKED[c];
    if (mc) {
      out += mc.base;
      if (tone === 0) tone = mc.tone;
    } else {
      out += c;
    }
  }
  if (uAsV) out = out.replace(/\u00fc/g, 'v'); // ü -> v
  if (style === ToneStyle.Number && tone > 0) out += String(tone);
  return out;
}

module.exports = {
  ToneStyle: ToneStyle,
  isMarked: isMarked,
  detectTone: detectTone,
  convertStyle: convertStyle
};
