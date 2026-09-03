using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace PinyinApp.Core
{
    /// <summary>Word 导出选项。</summary>
    public class DocxOptions
    {
        public string Title = "中文拼音对照表";
        public ToneStyle ToneStyle = ToneStyle.Symbol;
        public bool UAsV = false;
        public bool IncludeLineByLine = true;
        public bool IncludeCharTable = true;
        public string Timestamp = "";       // 转换时间字符串
    }

    /// <summary>
    /// 纯 C# 生成 .docx（OOXML）文件，不依赖任何第三方库。
    /// 支持中文（设置 eastAsia 字体）、表格、标题等。
    /// </summary>
    public static class DocxBuilder
    {
        private const string W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        private const string RELPKG = "http://schemas.openxmlformats.org/package/2006/relationships";
        private const string EASTASIA = "微软雅黑";   // Word 中用于中文回退的字体名
        private const string LATIN = "Calibri";

        public static byte[] Build(PinyinResult result, DocxOptions opts)
        {
            if (opts == null) opts = new DocxOptions();
            string documentXml = BuildDocument(result, opts);

            using (MemoryStream ms = new MemoryStream())
            {
                using (ZipArchive zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
                {
                    WriteEntry(zip, "[Content_Types].xml", ContentTypes());
                    WriteEntry(zip, "_rels/.rels", Rels());
                    WriteEntry(zip, "word/document.xml", documentXml);
                    WriteEntry(zip, "word/styles.xml", Styles());
                    WriteEntry(zip, "word/settings.xml", Settings());
                    WriteEntry(zip, "word/_rels/document.xml.rels", DocumentRels());
                    WriteEntry(zip, "docProps/core.xml", CoreProps(opts));
                    WriteEntry(zip, "docProps/app.xml", AppProps());
                }
                return ms.ToArray();
            }
        }

        private static void WriteEntry(ZipArchive zip, string name, string content)
        {
            ZipArchiveEntry e = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (Stream s = e.Open())
            {
                byte[] bytes = Encoding.UTF8.GetBytes(content);
                s.Write(bytes, 0, bytes.Length);
            }
        }

        // ---------------- document.xml ----------------

        private static string BuildDocument(PinyinResult result, DocxOptions opts)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
            sb.Append("<w:document xmlns:w=\"").Append(W).Append("\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\n");
            sb.Append("<w:body>\n");

            // 标题
            sb.Append(Para(opts.Title, bold: true, 44, "2F5496", "center", before: 80, after: 120));

            // 元信息
            string meta = "原文共 " + result.Lines.Count + " 行 · 汉字 " + result.CjkCharCount + " 个 · 共 " + result.TotalCharCount + " 字";
            if (!string.IsNullOrEmpty(opts.Timestamp)) meta += " · 转换时间 " + opts.Timestamp;
            sb.Append(Para(meta, bold: false, 20, "595959", "center", before: 0, after: 60));

            string toneDesc = opts.ToneStyle == ToneStyle.Symbol ? "带声调符号（ā á ǎ à）" :
                              opts.ToneStyle == ToneStyle.Number ? "数字声调（a1 a2 a3 a4）" : "不带声调";
            sb.Append(Para("拼音风格：" + toneDesc, bold: false, 20, "595959", "center", before: 0, after: 180));

            // 正文：注音排版（拼音在上、汉字在下，逐字上下居中对齐）
            foreach (PinyinLine line in result.Lines)
            {
                if (line.Source.Length == 0)
                {
                    sb.Append(Para("", bold: false, 20, "595959", "left", before: 80, after: 80));
                    continue;
                }
                sb.Append(RubyPara(line, opts));
            }

            // 说明
            sb.Append(Para("注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。", bold: false, 18, "808080", "left", before: 160, after: 0));

            // sectPr
            sb.Append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr>\n");
            sb.Append("</w:body>\n</w:document>\n");
            return sb.ToString();
        }

        private static string RenderLinePinyin(PinyinLine line, DocxOptions opts)
        {
            StringBuilder sb = new StringBuilder();
            foreach (PinyinToken t in line.Tokens)
            {
                if (!t.IsCJK)
                {
                    sb.Append(t.Source);
                }
                else
                {
                    for (int k = 0; k < t.Items.Count; k++)
                    {
                        if (k > 0) sb.Append(' ');
                        sb.Append(PinyinEngine.Render(t.Items[k].Pinyin, opts.ToneStyle, opts.UAsV));
                    }
                }
            }
            return sb.Length == 0 ? "（无内容）" : sb.ToString();
        }

        // ---------------- 注音（拼音指南）段落 ----------------

        private const int BaseSz = 30;      // 汉字字号（半点）= 15pt
        private const int RubySz = 15;      // 拼音字号（半点）= 7.5pt
        private const int RubyRaise = 30;   // 拼音相对基线抬升（半点）

        /// <summary>
        /// 生成一段“拼音指南”排版：每个汉字使用 w:ruby，
        /// 拼音位于汉字正上方并水平居中，Word / WPS / LibreOffice 均可正确显示与换行。
        /// </summary>
        private static string RubyPara(PinyinLine line, DocxOptions opts)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<w:p><w:pPr>");
            // 行距留足拼音空间
            sb.Append("<w:spacing w:before=\"80\" w:after=\"80\" w:line=\"420\" w:lineRule=\"auto\"/>");
            sb.Append("<w:jc w:val=\"left\"/>");
            sb.Append("</w:pPr>");

            foreach (PinyinToken t in line.Tokens)
            {
                if (!t.IsCJK)
                {
                    sb.Append(Run(t.Source, BaseSz, "22304A"));
                    continue;
                }
                foreach (CharPinyin cp in t.Items)
                {
                    string py = PinyinEngine.Render(cp.Pinyin, opts.ToneStyle, opts.UAsV);
                    if (string.IsNullOrEmpty(py))
                    {
                        sb.Append(Run(cp.Char.ToString(), BaseSz, "22304A"));
                        continue;
                    }
                    sb.Append(Ruby(cp.Char.ToString(), py));
                }
            }

            sb.Append("</w:p>\n");
            return sb.ToString();
        }

        /// <summary>单个 w:ruby 元素：rt = 拼音（上），rubyBase = 汉字（下）。</summary>
        private static string Ruby(string baseText, string rubyText)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<w:r><w:ruby>");
            sb.Append("<w:rubyPr>");
            sb.Append("<w:rubyAlign w:val=\"center\"/>");
            sb.Append("<w:hps w:val=\"").Append(RubySz).Append("\"/>");
            sb.Append("<w:hpsRaise w:val=\"").Append(RubyRaise).Append("\"/>");
            sb.Append("<w:hpsBaseText w:val=\"").Append(BaseSz).Append("\"/>");
            sb.Append("<w:lid w:val=\"zh-CN\"/>");
            sb.Append("</w:rubyPr>");
            sb.Append("<w:rt>").Append(Run(rubyText, RubySz, "3B6EF6")).Append("</w:rt>");
            sb.Append("<w:rubyBase>").Append(Run(baseText, BaseSz, "22304A")).Append("</w:rubyBase>");
            sb.Append("</w:ruby></w:r>");
            return sb.ToString();
        }

        private static string Run(string text, int szHalf, string color)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<w:r><w:rPr>");
            sb.Append("<w:rFonts w:ascii=\"").Append(LATIN).Append("\" w:eastAsia=\"").Append(EASTASIA)
              .Append("\" w:hAnsi=\"").Append(LATIN).Append("\" w:cs=\"").Append(LATIN).Append("\"/>");
            sb.Append("<w:color w:val=\"").Append(color).Append("\"/>");
            sb.Append("<w:sz w:val=\"").Append(szHalf).Append("\"/><w:szCs w:val=\"").Append(szHalf).Append("\"/>");
            sb.Append("</w:rPr><w:t xml:space=\"preserve\">").Append(Escape(text)).Append("</w:t></w:r>");
            return sb.ToString();
        }

        // ---------------- XML 片段生成 ----------------

        private static string Para(string text, bool bold, int szHalf, string color, string jc, int before, int after)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<w:p><w:pPr>");
            sb.Append("<w:spacing w:before=\"").Append(before).Append("\" w:after=\"").Append(after).Append("\"/>");
            if (!string.IsNullOrEmpty(jc)) sb.Append("<w:jc w:val=\"").Append(jc).Append("\"/>");
            sb.Append("</w:pPr>");
            sb.Append("<w:r><w:rPr>");
            sb.Append("<w:rFonts w:ascii=\"").Append(LATIN).Append("\" w:eastAsia=\"").Append(EASTASIA)
              .Append("\" w:hAnsi=\"").Append(LATIN).Append("\" w:cs=\"").Append(LATIN).Append("\"/>");
            if (bold) sb.Append("<w:b/>");
            sb.Append("<w:color w:val=\"").Append(color).Append("\"/>");
            sb.Append("<w:sz w:val=\"").Append(szHalf).Append("\"/><w:szCs w:val=\"").Append(szHalf).Append("\"/>");
            sb.Append("</w:rPr><w:t xml:space=\"preserve\">").Append(Escape(text)).Append("</w:t></w:r></w:p>\n");
            return sb.ToString();
        }

        /// <summary>生成带边框表格。rows[0] 为表头（加底色加粗）。</summary>
        private static string Table(List<string[]> rows, int[] colWidths)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("<w:tbl><w:tblPr>");
            sb.Append("<w:tblW w:w=\"0\" w:type=\"auto\"/>");
            sb.Append("<w:tblBorders>");
            sb.Append("<w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/>");
            sb.Append("</w:tblBorders>");
            sb.Append("<w:tblLayout w:type=\"autofit\"/>");
            sb.Append("</w:tblPr>");
            sb.Append("<w:tblGrid>");
            for (int i = 0; i < colWidths.Length; i++) sb.Append("<w:gridCol w:w=\"").Append(colWidths[i]).Append("\"/>");
            sb.Append("</w:tblGrid>");

            for (int r = 0; r < rows.Count; r++)
            {
                sb.Append("<w:tr><w:trPr><w:cantSplit/></w:trPr>");
                for (int c = 0; c < rows[r].Length && c < colWidths.Length; c++)
                {
                    bool header = r == 0;
                    sb.Append("<w:tc><w:tcPr>");
                    sb.Append("<w:tcW w:w=\"").Append(colWidths[c]).Append("\" w:type=\"dxa\"/>");
                    if (header) sb.Append("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"D9E2F3\"/>");
                    sb.Append("</w:tcPr>");
                    sb.Append("<w:p><w:pPr><w:spacing w:before=\"20\" w:after=\"20\"/></w:pPr>");
                    sb.Append("<w:r><w:rPr>");
                    sb.Append("<w:rFonts w:ascii=\"").Append(LATIN).Append("\" w:eastAsia=\"").Append(EASTASIA)
                      .Append("\" w:hAnsi=\"").Append(LATIN).Append("\"/>");
                    if (header) sb.Append("<w:b/>");
                    sb.Append("<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/>");
                    sb.Append("</w:rPr><w:t xml:space=\"preserve\">").Append(Escape(rows[r][c])).Append("</w:t></w:r>");
                    sb.Append("</w:p></w:tc>");
                }
                sb.Append("</w:tr>");
            }
            sb.Append("</w:tbl>\n");
            return sb.ToString();
        }

        private static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                    .Replace("\"", "&quot;").Replace("'", "&apos;");
        }

        // ---------------- 其他部件 ----------------

        private static string ContentTypes()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
"<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
"<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
"<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
"<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
"<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>" +
"<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
"<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>" +
"</Types>";
        }

        private static string Rels()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<Relationships xmlns=\"" + RELPKG + "\">" +
"<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
"<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
"<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>" +
"</Relationships>";
        }

        private static string DocumentRels()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<Relationships xmlns=\"" + RELPKG + "\">" +
"<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
"<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>" +
"</Relationships>";
        }

        private static string Styles()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<w:styles xmlns:w=\"" + W + "\">" +
"<w:docDefaults><w:rPrDefault><w:rPr>" +
"<w:rFonts w:ascii=\"" + LATIN + "\" w:eastAsia=\"" + EASTASIA + "\" w:hAnsi=\"" + LATIN + "\" w:cs=\"" + LATIN + "\"/>" +
"<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:rPrDefault>" +
"<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>" +
"</w:docDefaults>" +
"<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>" +
"<w:style w:type=\"paragraph\" w:styleId=\"TableNormal\"><w:name w:val=\"Normal Table\"/><w:uiPriority w:val=\"99\"/></w:style>" +
"<w:style w:type=\"table\" w:styleId=\"TableGrid\"><w:name w:val=\"Table Grid\"/><w:basedOn w:val=\"TableNormal\"/><w:uiPriority w:val=\"39\"/></w:style>" +
"</w:styles>";
        }

        private static string Settings()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<w:settings xmlns:w=\"" + W + "\">" +
"<w:zoom w:percent=\"100\"/><w:defaultTabStop w:val=\"708\"/>" +
"<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/></w:compat>" +
"</w:settings>";
        }

        private static string CoreProps(DocxOptions opts)
        {
            string ts = "2026-01-01T00:00:00Z";
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
"xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
"xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
"<dc:title>" + Escape(opts.Title) + "</dc:title>" +
"<dc:creator>中文拼音助手</dc:creator>" +
"<cp:lastModifiedBy>中文拼音助手</cp:lastModifiedBy>" +
"<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + ts + "</dcterms:created>" +
"<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + ts + "</dcterms:modified>" +
"</cp:coreProperties>";
        }

        private static string AppProps()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
"<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" " +
"xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">" +
"<Application>中文拼音助手</Application></Properties>";
        }
    }
}
