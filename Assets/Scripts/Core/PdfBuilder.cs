using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace PinyinApp.Core
{
    /// <summary>PDF 导出选项。</summary>
    public class PdfOptions
    {
        public string Title = "中文拼音对照表";
        public ToneStyle ToneStyle = ToneStyle.Symbol;
        public bool UAsV = false;
        public bool IncludeLineByLine = true;
        public bool IncludeCharTable = true;
        public string Timestamp = "";
    }

    /// <summary>
    /// 纯 C# 生成 PDF（内嵌 TrueType 子集字体，Identity-H 编码，支持文字复制）。
    /// 不依赖任何第三方库。
    /// </summary>
    public static class PdfBuilder
    {
        private const float PageW = 595.28f;
        private const float PageH = 841.89f;
        private const float Margin = 50f;
        private const float ContentW = PageW - Margin * 2;
        private const string FontName = "ABCDEF+PinyinSubset";

        // ---------------- 主入口 ----------------

        public static byte[] Build(PinyinResult result, PdfOptions opts, byte[] fontBytes)
        {
            if (opts == null) opts = new PdfOptions();
            TtfFont font = new TtfFont();
            if (!font.Parse(fontBytes)) throw new InvalidOperationException("无法解析字体文件");

            // 收集需要用到（并子集化）的全部字符
            HashSet<uint> used = new HashSet<uint>();
            CollectUsedChars(result, used);

            FontSubset subset = font.BuildSubset(used);
            PdfGlyph glyph = new PdfGlyph(font, subset);

            // 布局：生成每页的内容流
            Layout layout = new Layout(opts, result, glyph);
            List<PageInfo> pages = layout.Run();

            // 页脚（第 X 页）
            for (int i = 0; i < pages.Count; i++)
            {
                StringBuilder fb = new StringBuilder();
                fb.Append("BT /F1 9 Tf 0.55 0.55 0.55 rg 1 0 0 1 ")
                  .Append(PageW / 2f - 30f).Append(" ").Append(30).Append(" Tm (");
                fb.Append("中文拼音助手 · 第 ").Append(i + 1).Append(" / ").Append(pages.Count).Append(" 页) Tj ET\n");
                pages[i].ContentBytes = Encoding.ASCII.GetBytes(fb.ToString());
            }

            return AssemblePdf(pages, glyph, font, subset, opts);
        }

        // ---------------- 字符收集 ----------------

        private static void CollectUsedChars(PinyinResult result, HashSet<uint> used)
        {
            Add(used, "中文拼音对照表");
            Add(used, "原文共 行 汉字 个 · 转换时间 ：-:.0123456789（）()");
            Add(used, "拼音风格：带声调符号数字（ā á ǎ à a1 a2 a3 a4）");
            Add(used, "注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。");

            foreach (PinyinLine line in result.Lines)
            {
                foreach (char c in line.Source) used.Add((uint)c);
                foreach (PinyinToken t in line.Tokens)
                {
                    if (!t.IsCJK) continue;
                    foreach (CharPinyin cp in t.Items)
                    {
                        foreach (char c in cp.Pinyin) used.Add((uint)c);
                    }
                }
            }
            // 数字声调风格需要的数字已在上面加入
        }

        private static void Add(HashSet<uint> used, string s)
        {
            foreach (char c in s) used.Add((uint)c);
        }

        // ---------------- 字形/度量 ----------------

        private class PdfGlyph
        {
            public TtfFont Font;
            public FontSubset Subset;

            public PdfGlyph(TtfFont font, FontSubset subset)
            {
                Font = font;
                Subset = subset;
            }

            public float Width(char c, float size)
            {
                ushort oldGid = Font.GetGlyph((uint)c);
                float adv = Font.GetAdvance(oldGid);
                return adv / Font.UnitsPerEm * size;
            }

            public float Width(string s, float size)
            {
                float w = 0f;
                foreach (char c in s) w += Width(c, size);
                return w;
            }

            public string Hex(string s)
            {
                StringBuilder sb = new StringBuilder(s.Length * 4);
                foreach (char c in s)
                {
                    ushort newGid;
                    if (!Subset.UnicodeToNewGid.TryGetValue((uint)c, out newGid)) newGid = 0;
                    sb.Append(newGid.ToString("X4"));
                }
                return sb.ToString();
            }
        }

        // ---------------- 布局 ----------------

        private class PageInfo
        {
            public List<byte[]> ContentStreams = new List<byte[]>();
            public byte[] ContentBytes;   // 页脚
        }

        private class Layout
        {
            private readonly PdfOptions _opts;
            private readonly PinyinResult _result;
            private readonly PdfGlyph _g;

            private readonly List<PageInfo> _pages = new List<PageInfo>();
            private StringBuilder _cur;
            private float _y;

            public Layout(PdfOptions opts, PinyinResult result, PdfGlyph g)
            {
                _opts = opts;
                _result = result;
                _g = g;
            }

            public List<PageInfo> Run()
            {
                NewPage();

                // 标题
                Title(_opts.Title);

                // 元信息
                string meta = "原文共 " + _result.Lines.Count + " 行 · 汉字 " + _result.CjkCharCount + " 个 · 共 " + _result.TotalCharCount + " 字";
                if (!string.IsNullOrEmpty(_opts.Timestamp)) meta += " · 转换时间 " + _opts.Timestamp;
                Meta(meta);
                string toneDesc = _opts.ToneStyle == ToneStyle.Symbol ? "带声调符号（ā á ǎ à）" :
                                  _opts.ToneStyle == ToneStyle.Number ? "数字声调（a1 a2 a3 a4）" : "不带声调";
                Meta("拼音风格：" + toneDesc);

                // 正文：注音排版（拼音在上、汉字在下，逐字上下居中对齐）
                foreach (PinyinLine line in _result.Lines)
                {
                    if (line.Source.Length == 0)
                    {
                        Ensure(24f);
                        _y -= 20f;
                        continue;
                    }
                    AnnotatedLine(line);
                    _y -= 6f;
                }

                Note();

                // 收尾：把最后一页缓冲落地（否则内容会丢失）
                if (_cur != null && _cur.Length > 0)
                {
                    _pages[_pages.Count - 1].ContentStreams.Add(Encoding.ASCII.GetBytes(_cur.ToString()));
                    _cur = new StringBuilder();
                }
                return _pages;
            }

            private void NewPage()
            {
                if (_cur != null && _cur.Length > 0)
                {
                    _pages[_pages.Count - 1].ContentStreams.Add(Encoding.ASCII.GetBytes(_cur.ToString()));
                }
                PageInfo p = new PageInfo();
                _pages.Add(p);
                _cur = new StringBuilder();
                _y = PageH - Margin;   // PDF 坐标（左下原点），靠近顶部
            }

            private void Ensure(float dy)
            {
                if (_y - dy < Margin)
                {
                    // 空间不足：将当前页内容落地，新建一个物理页
                    _pages[_pages.Count - 1].ContentStreams.Add(Encoding.ASCII.GetBytes(_cur.ToString()));
                    PageInfo p = new PageInfo();
                    _pages.Add(p);
                    _cur = new StringBuilder();
                    _y = PageH - Margin;
                }
            }

            private void Text(string text, float size, float r, float g, float b, float x, bool centered = false)
            {
                if (string.IsNullOrEmpty(text)) return;
                float w = _g.Width(text, size);
                if (centered) x = x - w / 2f;
                _cur.Append("BT /F1 ").Append(Fmt(size)).Append(" Tf ")
                    .Append(Fmt(r)).Append(' ').Append(Fmt(g)).Append(' ').Append(Fmt(b)).Append(" rg ")
                    .Append("1 0 0 1 ").Append(Fmt(x)).Append(' ').Append(Fmt(_y)).Append(" Tm <")
                    .Append(_g.Hex(text)).Append("> Tj ET\n");
            }

            /// <summary>在指定基线位置绘制文本（不改变 _y）。</summary>
            private void TextAt(string text, float size, float r, float g, float b, float x, float y)
            {
                if (string.IsNullOrEmpty(text)) return;
                _cur.Append("BT /F1 ").Append(Fmt(size)).Append(" Tf ")
                    .Append(Fmt(r)).Append(' ').Append(Fmt(g)).Append(' ').Append(Fmt(b)).Append(" rg ")
                    .Append("1 0 0 1 ").Append(Fmt(x)).Append(' ').Append(Fmt(y)).Append(" Tm <")
                    .Append(_g.Hex(text)).Append("> Tj ET\n");
            }

            private void Title(string s)
            {
                Text(s, 20f, 0.16f, 0.30f, 0.56f, PageW / 2f, true);
                _y -= 26f;
            }

            private void Meta(string s)
            {
                Text(s, 10f, 0.40f, 0.40f, 0.40f, PageW / 2f, true);
                _y -= 15f;
            }

            private void Heading(string s)
            {
                Ensure(30f);
                _y -= 6f;
                Text(s, 13f, 0.12f, 0.24f, 0.44f, Margin);
                _y -= 24f;
            }

            private void Body(string s, float size, float r, float g, float b, float lineH)
            {
                if (string.IsNullOrEmpty(s)) { _y -= lineH; return; }
                float[] widths = new float[s.Length];
                for (int i = 0; i < s.Length; i++) widths[i] = _g.Width(s[i], size);
                List<string> lines = Wrap(s, widths, ContentW);
                foreach (string ln in lines)
                {
                    Ensure(lineH);
                    Text(ln, size, r, g, b, Margin);
                    _y -= lineH;
                }
            }

            private void Note()
            {
                Ensure(30f);
                _y -= 8f;
                Text("注：拼音依据常见词库进行多音字消歧，未命中词语的汉字取常见读音。", 9f, 0.55f, 0.55f, 0.55f, Margin);
                _y -= 14f;
            }

            // ---------- 注音排版（一行拼音 + 一行汉字，逐字对齐） ----------

            private const float CharSize = 15f;     // 汉字字号
            private const float PySize = 8.5f;      // 拼音字号
            private const float PyGap = 3f;         // 拼音与汉字的垂直间距
            private const float UnitGap = 1.5f;     // 字与字之间的水平间距
            private const float RowPad = 9f;        // 行间距

            private class Unit
            {
                public string Top = "";     // 拼音
                public string Base = "";    // 汉字 / 原文片段
                public float W;             // 列宽（含 UnitGap）
            }

            /// <summary>把一行拆成「拼音 + 汉字」列，逐列排布并按页宽自动折行。</summary>
            private void AnnotatedLine(PinyinLine line)
            {
                List<Unit> units = BuildUnits(line);
                List<Unit> row = new List<Unit>();
                float rowW = 0f;

                foreach (Unit u in units)
                {
                    float topW = u.Top.Length > 0 ? _g.Width(u.Top, PySize) : 0f;
                    float baseW = _g.Width(u.Base, CharSize);
                    u.W = Math.Max(topW, baseW) + UnitGap;

                    if (rowW + u.W > ContentW && row.Count > 0)
                    {
                        DrawRow(row);
                        row.Clear();
                        rowW = 0f;
                    }
                    row.Add(u);
                    rowW += u.W;
                }
                if (row.Count > 0) DrawRow(row);
            }

            /// <summary>绘制一行：上方拼音、下方汉字，每列水平居中对齐。</summary>
            private void DrawRow(List<Unit> row)
            {
                float rowH = PySize + PyGap + CharSize + RowPad;
                Ensure(rowH);

                float pyBaseline = _y - PySize;                       // 拼音基线
                float chBaseline = pyBaseline - PyGap - CharSize * 0.88f;   // 汉字基线

                float x = Margin;
                foreach (Unit u in row)
                {
                    float colW = u.W - UnitGap;
                    if (u.Top.Length > 0)
                    {
                        float w = _g.Width(u.Top, PySize);
                        TextAt(u.Top, PySize, 0.16f, 0.37f, 0.83f, x + (colW - w) / 2f, pyBaseline);
                    }
                    float bw = _g.Width(u.Base, CharSize);
                    TextAt(u.Base, CharSize, 0.12f, 0.16f, 0.28f, x + (colW - bw) / 2f, chBaseline);
                    x += u.W;
                }
                _y -= rowH;
            }

            /// <summary>汉字：一字一列（带拼音）；非汉字：字母/数字成词，其余逐字符成列。</summary>
            private List<Unit> BuildUnits(PinyinLine line)
            {
                List<Unit> units = new List<Unit>();
                foreach (PinyinToken t in line.Tokens)
                {
                    if (t.IsCJK)
                    {
                        foreach (CharPinyin cp in t.Items)
                        {
                            units.Add(new Unit
                            {
                                Top = PinyinEngine.Render(cp.Pinyin, _opts.ToneStyle, _opts.UAsV),
                                Base = cp.Char.ToString()
                            });
                        }
                        continue;
                    }

                    string s = t.Source;
                    int i = 0;
                    while (i < s.Length)
                    {
                        char c = s[i];
                        if (char.IsLetterOrDigit(c))
                        {
                            int j = i;
                            while (j < s.Length && char.IsLetterOrDigit(s[j])) j++;
                            units.Add(new Unit { Base = s.Substring(i, j - i) });
                            i = j;
                        }
                        else
                        {
                            units.Add(new Unit { Base = c.ToString() });
                            i++;
                        }
                    }
                }
                return units;
            }
        }

        private static string Fmt(float v)
        {
            return v.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>按最大宽度换行（CJK 任意断行，拉丁词按空格断行）。</summary>
        public static List<string> Wrap(string text, float[] widths, float maxWidth)
        {
            List<string> result = new List<string>();
            if (string.IsNullOrEmpty(text)) { result.Add(""); return result; }
            int n = text.Length;
            int lineStart = 0;
            int lastSpace = -1;
            float width = 0f;
            for (int i = 0; i < n; i++)
            {
                char c = text[i];
                if (c == ' ') lastSpace = i;
                float w = widths[i];
                if (width + w > maxWidth && i > lineStart)
                {
                    int cut = (lastSpace >= lineStart) ? lastSpace : i;
                    string piece = text.Substring(lineStart, cut - lineStart).TrimEnd(' ');
                    if (piece.Length > 0) result.Add(piece);
                    int nextStart = (lastSpace >= lineStart) ? lastSpace + 1 : i;
                    lineStart = nextStart;
                    lastSpace = -1;
                    width = 0f;
                    for (int k = nextStart; k < i; k++)
                    {
                        if (text[k] == ' ') lastSpace = k;
                        width += widths[k];
                    }
                    i--;   // 重新处理当前字符
                    continue;
                }
                width += w;
            }
            string last = text.Substring(lineStart).TrimEnd(' ');
            if (last.Length > 0 || result.Count == 0) result.Add(last);
            return result;
        }

        // ---------------- 组装 PDF ----------------

        private static byte[] AssemblePdf(List<PageInfo> pages, PdfGlyph glyph, TtfFont font, FontSubset subset, PdfOptions opts)
        {
            MemoryStream pdf = new MemoryStream();
            List<long> offsets = new List<long>();

            byte[] ascii = Encoding.ASCII.GetBytes("%PDF-1.4\n");
            pdf.Write(ascii, 0, ascii.Length);

            // 对象编号分配
            int objCatalog = 1;
            int objPages = 2;
            int objType0 = 3;
            int objCid = 4;
            int objDescriptor = 5;
            int objFontFile = 6;
            int objToUnicode = 7;
            int objPageStart = 8;
            int objContentStart = objPageStart + pages.Count;
            int objInfo = objContentStart + pages.Count;   // Info 对象在全部页/内容流之后
            // 对象总数 = objInfo

            // 1. Catalog
            WriteObjStart(pdf, offsets, objCatalog);
            WriteAscii(pdf, "<< /Type /Catalog /Pages " + objPages + " 0 R >>");
            WriteObjEnd(pdf);

            // 2. Pages
            WriteObjStart(pdf, offsets, objPages);
            StringBuilder kids = new StringBuilder();
            for (int i = 0; i < pages.Count; i++)
            {
                if (i > 0) kids.Append(' ');
                kids.Append((objPageStart + i)).Append(" 0 R");
            }
            WriteAscii(pdf, "<< /Type /Pages /Kids [" + kids + "] /Count " + pages.Count + " >>");
            WriteObjEnd(pdf);

            // 3. Type0 字体
            WriteObjStart(pdf, offsets, objType0);
            WriteAscii(pdf, "<< /Type /Font /Subtype /Type0 /BaseFont /" + FontName + " /Encoding /Identity-H "
                + "/DescendantFonts [" + objCid + " 0 R] /ToUnicode " + objToUnicode + " 0 R >>");
            WriteObjEnd(pdf);

            // 4. CIDFontType2
            WriteObjStart(pdf, offsets, objCid);
            WriteAscii(pdf, "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /" + FontName + " "
                + "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
                + "/FontDescriptor " + objDescriptor + " 0 R /DW 1000 /W " + BuildWArray(subset, font)
                + " /CIDToGIDMap /Identity >>");
            WriteObjEnd(pdf);

            // 5. FontDescriptor
            float upm = font.UnitsPerEm;
            int ascent = (int)(font.Ascent / upm * 1000f);
            int descent = (int)(font.Descent / upm * 1000f);
            int capHeight = (int)(0.7f * 1000f);
            WriteObjStart(pdf, offsets, objDescriptor);
            WriteAscii(pdf, "<< /Type /FontDescriptor /FontName /" + FontName + " /Flags 32 "
                + "/FontBBox [" + font.XMin + " " + font.YMin + " " + font.XMax + " " + font.YMax + "] "
                + "/ItalicAngle 0 /Ascent " + ascent + " /Descent " + descent + " /CapHeight " + capHeight
                + " /StemV 80 /FontFile2 " + objFontFile + " 0 R >>");
            WriteObjEnd(pdf);

            // 6. FontFile2（子集字体二进制流）
            WriteStream(pdf, offsets, objFontFile, subset.FontBytes, "<< /Length " + subset.FontBytes.Length + " >>");

            // 7. ToUnicode
            byte[] touc = Encoding.ASCII.GetBytes(BuildToUnicode(subset));
            WriteStream(pdf, offsets, objToUnicode, touc, "<< /Length " + touc.Length + " >>");

            // 8. 页面对象 + 内容流
            for (int i = 0; i < pages.Count; i++)
            {
                int pageObj = objPageStart + i;
                WriteObjStart(pdf, offsets, pageObj);
                WriteAscii(pdf, "<< /Type /Page /Parent " + objPages + " 0 R /MediaBox [0 0 " + Fmt(PageW) + " " + Fmt(PageH) + "] "
                    + "/Resources << /Font << /F1 " + objType0 + " 0 R >> >> /Contents " + (objContentStart + i) + " 0 R >>");
                WriteObjEnd(pdf);
            }

            for (int i = 0; i < pages.Count; i++)
            {
                byte[] content = ConcatContent(pages[i]);
                WriteStream(pdf, offsets, objContentStart + i, content, "<< /Length " + content.Length + " >>");
            }

            // Info
            WriteObjStart(pdf, offsets, objInfo);
            WriteAscii(pdf, "<< /Title (" + Sanitize(opts.Title) + ") /Producer (PinyinApp) /CreationDate (D:20260101000000) >>");
            WriteObjEnd(pdf);

            // xref
            long xrefPos = pdf.Position;
            WriteAscii(pdf, "xref\n0 " + (objInfo + 1) + "\n");
            WriteAscii(pdf, "0000000000 65535 f \n");
            for (int i = 0; i < offsets.Count; i++)
            {
                WriteAscii(pdf, offsets[i].ToString("D10") + " 00000 n \n");
            }
            WriteAscii(pdf, "trailer\n<< /Size " + (objInfo + 1) + " /Root " + objCatalog + " 0 R /Info " + objInfo + " 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n");

            return pdf.ToArray();
        }

        private static byte[] ConcatContent(PageInfo p)
        {
            MemoryStream ms = new MemoryStream();
            foreach (byte[] b in p.ContentStreams) ms.Write(b, 0, b.Length);
            if (p.ContentBytes != null) ms.Write(p.ContentBytes, 0, p.ContentBytes.Length);
            return ms.ToArray();
        }

        private static string BuildWArray(FontSubset subset, TtfFont font)
        {
            StringBuilder sb = new StringBuilder("[ ");
            foreach (KeyValuePair<uint, ushort> kv in subset.UnicodeToNewGid)
            {
                ushort oldGid = font.GetGlyph(kv.Key);
                float adv = font.GetAdvance(oldGid);
                int w = (int)Math.Round(adv / font.UnitsPerEm * 1000f);
                sb.Append('<').Append(kv.Value.ToString("X4")).Append("> [").Append(w).Append("] ");
            }
            sb.Append("]");
            return sb.ToString();
        }

        private static string BuildToUnicode(FontSubset subset)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n");
            sb.Append("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n");
            sb.Append("/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n");
            sb.Append("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");

            List<uint> codes = new List<uint>(subset.UnicodeToNewGid.Keys);
            codes.Sort();
            sb.Append(codes.Count).Append(" beginbfchar\n");
            foreach (uint u in codes)
            {
                ushort gid = subset.UnicodeToNewGid[u];
                string hex;
                if (u <= 0xFFFF) hex = u.ToString("X4");
                else
                {
                    // 代理对
                    uint v = u - 0x10000;
                    uint hi = 0xD800 + (v >> 10);
                    uint lo = 0xDC00 + (v & 0x3FF);
                    hex = hi.ToString("X4") + lo.ToString("X4");
                }
                sb.Append('<').Append(gid.ToString("X4")).Append("> <").Append(hex).Append(">\n");
            }
            sb.Append("endbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
            return sb.ToString();
        }

        private static string Sanitize(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
        }

        private static void WriteObjStart(MemoryStream pdf, List<long> offsets, int num)
        {
            offsets.Add(pdf.Position);
            WriteAscii(pdf, num + " 0 obj\n");
        }

        private static void WriteObjEnd(MemoryStream pdf)
        {
            WriteAscii(pdf, "\nendobj\n");
        }

        private static void WriteStream(MemoryStream pdf, List<long> offsets, int num, byte[] data, string dict)
        {
            offsets.Add(pdf.Position);
            WriteAscii(pdf, num + " 0 obj\n" + dict + "\nstream\n");
            pdf.Write(data, 0, data.Length);
            WriteAscii(pdf, "\nendstream\nendobj\n");
        }

        private static void WriteAscii(MemoryStream pdf, string s)
        {
            byte[] b = Encoding.ASCII.GetBytes(s);
            pdf.Write(b, 0, b.Length);
        }
    }
}
