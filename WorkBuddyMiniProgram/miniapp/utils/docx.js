/**
 * 纯 JS 生成 .docx（OOXML）—— DocxBuilder.cs 的移植。
 * 支持中文（eastAsia 字体）、标题、拼音指南（w:ruby）排版。
 * 输出为 ZIP 字节（Uint8Array），可直接写入 .docx 文件。
 */
'use strict';

var zip = require('./zip');
var pinyin = require('./pinyin');

var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
var RELPKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
var EASTASIA = '微软雅黑'; // Word 中用于中文回退的字体名
var LATIN = 'Calibri';

// 注音排版常量（与 C# 版一致）
var BaseSz = 30;        // 汉字字号（半点）= 15pt
var RubySz = 15;        // 拼音字号（半点）= 7.5pt
var RubyRaise = 30;     // 拼音相对基线抬升（半点）
var BodyCharSpacing = 12; // 二十分之一磅，正文字符间距 0.6pt

function DocxOptions(o) {
  o = o || {};
  this.title = o.title !== undefined ? o.title : '中文拼音对照表';
  this.toneStyle = o.toneStyle !== undefined ? o.toneStyle : pinyin.ToneStyle.Symbol;
  this.uAsV = !!o.uAsV;
  this.includeLineByLine = o.includeLineByLine !== undefined ? o.includeLineByLine : true;
  this.includeCharTable = o.includeCharTable !== undefined ? o.includeCharTable : true;
  this.timestamp = o.timestamp || '';
}

/** 生成 .docx 字节（Uint8Array）。 */
function build(result, opts) {
  if (!opts) opts = new DocxOptions();
  else opts = new DocxOptions(opts);
  var documentXml = buildDocument(result, opts);
  var utf8 = require('./utf8');
  var enc = function (s) { return utf8.encode(s); };

  var entries = [
    { name: '[Content_Types].xml', data: enc(contentTypes()) },
    { name: '_rels/.rels', data: enc(rels()) },
    { name: 'word/document.xml', data: enc(documentXml) },
    { name: 'word/styles.xml', data: enc(styles()) },
    { name: 'word/settings.xml', data: enc(settings()) },
    { name: 'word/_rels/document.xml.rels', data: enc(documentRels()) },
    { name: 'docProps/core.xml', data: enc(coreProps(opts)) },
    { name: 'docProps/app.xml', data: enc(appProps()) }
  ];
  return zip.buildZip(entries);
}

function buildDocument(result, opts) {
  var sb = '';
  sb += '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  sb += '<w:document xmlns:w="' + W + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n';
  sb += '<w:body>\n';

  // 标题
  sb += para(opts.title, true, 44, '2F5496', 'center', 80, 120);

  // 元信息
  var meta = '汉字 ' + result.cjkCharCount + ' 个 · 共 ' + result.totalCharCount + ' 字';
  if (opts.timestamp) meta += ' · 转换时间 ' + opts.timestamp;
  sb += para(meta, false, 20, '595959', 'center', 0, 60);

  var toneDesc = opts.toneStyle === pinyin.ToneStyle.Symbol ? '带声调符号（ā á ǎ à）' :
                 opts.toneStyle === pinyin.ToneStyle.Number ? '数字声调（a1 a2 a3 a4）' : '不带声调';
  sb += para('拼音风格：' + toneDesc, false, 20, '595959', 'center', 0, 180);

  // 正文：注音排版
  var lines = result.lines;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.source.length === 0) {
      sb += para('', false, 20, '595959', 'left', 80, 80);
      continue;
    }
    sb += rubyPara(line, opts);
  }

  // 说明
  sb += para('注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。', false, 18, '808080', 'left', 160, 0);

  // sectPr
  sb += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>\n';
  sb += '</w:body>\n</w:document>\n';
  return sb;
}

function renderLinePinyin(line, opts) {
  var sb = '';
  var toks = line.tokens;
  for (var ti = 0; ti < toks.length; ti++) {
    var t = toks[ti];
    if (!t.isCjk) {
      sb += t.source;
    } else {
      for (var k = 0; k < t.items.length; k++) {
        if (k > 0) sb += ' ';
        sb += pinyin.PinyinEngine.render(t.items[k].pinyin, opts.toneStyle, opts.uAsV);
      }
    }
  }
  return sb.length === 0 ? '（无内容）' : sb;
}

/** 生成一段"拼音指南"排版：每个汉字使用 w:ruby。 */
function rubyPara(line, opts) {
  var sb = '';
  sb += '<w:p><w:pPr>';
  sb += '<w:spacing w:before="80" w:after="80" w:line="420" w:lineRule="auto"/>';
  sb += '<w:jc w:val="left"/>';
  sb += '</w:pPr>';

  var toks = line.tokens;
  for (var ti = 0; ti < toks.length; ti++) {
    var t = toks[ti];
    if (!t.isCjk) {
      sb += run(t.source, BaseSz, '22304A', BodyCharSpacing);
      continue;
    }
    for (var k = 0; k < t.items.length; k++) {
      var cp = t.items[k];
      var py = pinyin.PinyinEngine.render(cp.pinyin, opts.toneStyle, opts.uAsV);
      if (!py) {
        sb += run(cp.char, BaseSz, '22304A');
        continue;
      }
      sb += ruby(cp.char, py);
    }
  }
  sb += '</w:p>\n';
  return sb;
}

/** 单个 w:ruby 元素：rt = 拼音（上），rubyBase = 汉字（下）。 */
function ruby(baseText, rubyText) {
  var sb = '';
  sb += '<w:r><w:rPr><w:spacing w:val="' + BodyCharSpacing + '"/></w:rPr><w:ruby>';
  sb += '<w:rubyPr>';
  sb += '<w:rubyAlign w:val="center"/>';
  sb += '<w:hps w:val="' + RubySz + '"/>';
  sb += '<w:hpsRaise w:val="' + RubyRaise + '"/>';
  sb += '<w:hpsBaseText w:val="' + BaseSz + '"/>';
  sb += '<w:lid w:val="zh-CN"/>';
  sb += '</w:rubyPr>';
  sb += '<w:rt>' + run(rubyText, RubySz, '3B6EF6') + '</w:rt>';
  sb += '<w:rubyBase>' + run(baseText, BaseSz, '22304A') + '</w:rubyBase>';
  sb += '</w:ruby></w:r>';
  return sb;
}

function run(text, szHalf, color, spacing) {
  var sb = '';
  sb += '<w:r><w:rPr>';
  sb += '<w:rFonts w:ascii="' + LATIN + '" w:eastAsia="' + EASTASIA +
        '" w:hAnsi="' + LATIN + '" w:cs="' + LATIN + '"/>';
  sb += '<w:color w:val="' + color + '"/>';
  sb += '<w:sz w:val="' + szHalf + '"/><w:szCs w:val="' + szHalf + '"/>';
  if (spacing) sb += '<w:spacing w:val="' + spacing + '"/>';
  sb += '</w:rPr><w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r>';
  return sb;
}

function para(text, bold, szHalf, color, jc, before, after) {
  var sb = '';
  sb += '<w:p><w:pPr>';
  sb += '<w:spacing w:before="' + before + '" w:after="' + after + '"/>';
  if (jc) sb += '<w:jc w:val="' + jc + '"/>';
  sb += '</w:pPr>';
  sb += '<w:r><w:rPr>';
  sb += '<w:rFonts w:ascii="' + LATIN + '" w:eastAsia="' + EASTASIA +
        '" w:hAnsi="' + LATIN + '" w:cs="' + LATIN + '"/>';
  if (bold) sb += '<w:b/>';
  sb += '<w:color w:val="' + color + '"/>';
  sb += '<w:sz w:val="' + szHalf + '"/><w:szCs w:val="' + szHalf + '"/>';
  sb += '</w:rPr><w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>\n';
  return sb;
}

function escapeXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------- 其他部件 ----------------

function contentTypes() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
'<Default Extension="xml" ContentType="application/xml"/>' +
'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
'</Types>';
}

function rels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Relationships xmlns="' + RELPKG + '">' +
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
'</Relationships>';
}

function documentRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Relationships xmlns="' + RELPKG + '">' +
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
'</Relationships>';
}

function styles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<w:styles xmlns:w="' + W + '">' +
'<w:docDefaults><w:rPrDefault><w:rPr>' +
'<w:rFonts w:ascii="' + LATIN + '" w:eastAsia="' + EASTASIA + '" w:hAnsi="' + LATIN + '" w:cs="' + LATIN + '"/>' +
'<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
'<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
'</w:docDefaults>' +
'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
'<w:style w:type="paragraph" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/></w:style>' +
'<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/></w:style>' +
'</w:styles>';
}

function settings() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<w:settings xmlns:w="' + W + '">' +
'<w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/>' +
'<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
'</w:settings>';
}

function coreProps(opts) {
  var ts = '2026-01-01T00:00:00Z';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
'<dc:title>' + escapeXml(opts.title) + '</dc:title>' +
'<dc:creator>中文拼音助手</dc:creator>' +
'<cp:lastModifiedBy>中文拼音助手</cp:lastModifiedBy>' +
'<dcterms:created xsi:type="dcterms:W3CDTF">' + ts + '</dcterms:created>' +
'<dcterms:modified xsi:type="dcterms:W3CDTF">' + ts + '</dcterms:modified>' +
'</cp:coreProperties>';
}

function appProps() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
'<Application>中文拼音助手</Application></Properties>';
}

module.exports = {
  DocxOptions: DocxOptions,
  build: build,
  renderLinePinyin: renderLinePinyin
};
