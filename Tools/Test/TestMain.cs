using System;
using System.IO;
using System.Text;
using PinyinApp.Core;

/// <summary>
/// 独立测试台：不依赖 Unity，直接用 mono 编译运行核心逻辑。
/// 用法：TestMain.exe <项目根目录>
/// </summary>
public static class TestMain
{
    public static int Main(string[] args)
    {
        string baseDir = args.Length > 0 ? args[0]
            : "/Users/macbookpro/Doubao/chats/2026-09-02/new-chat/PinyinApp";
        string dataDir = Path.Combine(baseDir, "Assets/Resources/Data");
        string fontPath = Path.Combine(baseDir, "Assets/StreamingAssets/NotoSansSC.ttf");
        string outDir = Path.Combine(baseDir, "Tools/Test/out");
        Directory.CreateDirectory(outDir);

        // ---- 1. 拼音引擎 ----
        PinyinEngine engine = new PinyinEngine();
        bool ok1 = engine.LoadCharData(File.ReadAllText(Path.Combine(dataDir, "pinyin.txt")));
        int w1 = engine.LoadWordData(File.ReadAllText(Path.Combine(dataDir, "phrase_pinyin.txt")));
        int w2 = 0;
        string zdic = Path.Combine(dataDir, "zdic_cibs.txt");
        if (File.Exists(zdic) && new FileInfo(zdic).Length > 100) w2 = engine.LoadWordData(File.ReadAllText(zdic));
        Console.WriteLine("[1] 单字数据加载: " + ok1 + "，词条数: " + (w1 + w2));

        string[] tests = {
            "你好，世界！",
            "银行 长大 音乐 重要 快乐 行走 长度",
            "我的书在桌子上。",
            "李白乘舟将欲行，忽闻岸上踏歌声。",
            "普通话测试：zhōng guó 123 abc"
        };
        foreach (string t in tests)
        {
            var r = engine.Convert(t);
            Console.WriteLine("--- 输入: " + t);
            Console.WriteLine("  拼音: " + PinyinEngine.RenderResult(r, ToneStyle.Symbol, false, false, " "));
            Console.WriteLine("  逐字: " + PinyinEngine.RenderParenthesis(r, ToneStyle.Symbol, false));
            Console.WriteLine("  数字: " + PinyinEngine.RenderResult(r, ToneStyle.Number, true, false, " "));
        }

        // ---- 2. 综合长文本 ----
        PinyinResult big = engine.Convert(
            "你好，世界！这是中文拼音转换应用，可以导出 Word 和 PDF 文档。" +
            "银行、长大、音乐、重要、快乐、行走。\n" +
            "多音字消歧示例：重庆 长安 朝阳 校长 干净 方便。");
        Console.WriteLine("[2] 长文本汉字数: " + big.CjkCharCount + "，总字数: " + big.TotalCharCount + "，行数: " + big.Lines.Count);

        // ---- 3. DOCX ----
        DocxOptions dopts = new DocxOptions { ToneStyle = ToneStyle.Symbol, Timestamp = "2026-09-02 12:00:00" };
        byte[] docx = DocxBuilder.Build(big, dopts);
        string docxPath = Path.Combine(outDir, "test.docx");
        File.WriteAllBytes(docxPath, docx);
        Console.WriteLine("[3] DOCX 生成: " + docx.Length + " bytes");
        using (var zip = new System.IO.Compression.ZipArchive(
            new MemoryStream(docx), System.IO.Compression.ZipArchiveMode.Read))
        {
            bool hasDoc = false;
            foreach (var e in zip.Entries) if (e.FullName == "word/document.xml") hasDoc = true;
            Console.WriteLine("    DOCX 校验: 含 document.xml = " + hasDoc + "，部件数 = " + zip.Entries.Count);
        }

        // ---- 4. PDF ----
        byte[] fontBytes = File.ReadAllBytes(fontPath);
        PdfOptions popts = new PdfOptions { ToneStyle = ToneStyle.Symbol, Timestamp = "2026-09-02 12:00:00" };
        byte[] pdf = PdfBuilder.Build(big, popts, fontBytes);
        string pdfPath = Path.Combine(outDir, "test.pdf");
        File.WriteAllBytes(pdfPath, pdf);
        Console.WriteLine("[4] PDF 生成: " + pdf.Length + " bytes（源字体 " + fontBytes.Length + "）");
        string head = Encoding.ASCII.GetString(pdf, 0, Math.Min(8, pdf.Length));
        string tail = Encoding.ASCII.GetString(pdf, Math.Max(0, pdf.Length - 16), Math.Min(16, pdf.Length));
        Console.WriteLine("    PDF 头: " + head.Trim() + "，结尾含 %%EOF: " + tail.Contains("%%EOF"));

        // ---- 5. 字体覆盖检查 ----
        TtfFont f = new TtfFont();
        f.Parse(fontBytes);
        Console.WriteLine("[5] 字体 unitsPerEm=" + f.UnitsPerEm + " numGlyphs=" + f.NumGlyphs);
        char[] marks = { 'ā', 'á', 'ǎ', 'à', 'ū', 'ǘ', 'ü', 'n', 'h', ' ', '你' };
        foreach (char m in marks)
            Console.WriteLine("    字体覆盖 '" + m + "' (U+" + ((int)m).ToString("X4") + "): " + f.HasGlyph((uint)m));

        // ---- 6. 子集化自检 ----
        var subset = f.BuildSubset(new uint[] { 0x4F60, 0x597D, 0x6D4B, 0x8BD5, 0x20, 0x61, 0x0301 });
        Console.WriteLine("[6] 子集化: 新字形数=" + subset.NewNumGlyphs + "，子集大小=" + subset.FontBytes.Length + " bytes");
        var sub2 = new TtfFont();
        bool subParse = sub2.Parse(subset.FontBytes);
        Console.WriteLine("    子集可再解析: " + subParse + "，numGlyphs=" + (subParse ? sub2.NumGlyphs : -1));

        // ---- 7. 带声调字符子集化（PDF 实际用） ----
        var subset2 = f.BuildSubset(new uint[] { 0x4F60, 0x597D, 0x1CE, 0x1D0, 0x20 });
        Console.WriteLine("[7] 含声调字符子集: " + subset2.NewNumGlyphs + " glyphs，覆盖'ǎ'(U+01CE)="
            + (subParse ? new TtfFont().Parse(subset2.FontBytes) : false));

        File.WriteAllText(Path.Combine(outDir, "result.txt"),
            PinyinEngine.RenderParenthesis(big, ToneStyle.Symbol, false), new UTF8Encoding(false));
        Console.WriteLine("ALL DONE");
        return 0;
    }
}
