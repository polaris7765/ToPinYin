using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace PinyinApp.Core
{
    /// <summary>单个汉字的拼音信息。</summary>
    public class CharPinyin
    {
        public char Char;
        public string Pinyin;   // 带声调符号，如 "nǐ"
        public int Tone;        // 1-4，0 表示轻声
        public bool IsCJK;

        public override string ToString()
        {
            return Char + "(" + Pinyin + ")";
        }
    }

    /// <summary>一行文本切分后的一个片段（一段连续汉字，或一段非汉字）。</summary>
    public class PinyinToken
    {
        public string Source;
        public bool IsCJK;
        public List<CharPinyin> Items;   // 仅 CJK 片段填充

        public PinyinToken(string source, bool isCjk)
        {
            Source = source;
            IsCJK = isCjk;
            Items = new List<CharPinyin>();
        }
    }

    /// <summary>输入中的一行。</summary>
    public class PinyinLine
    {
        public string Source;
        public List<PinyinToken> Tokens = new List<PinyinToken>();
    }

    /// <summary>整个输入文本的转换结果。</summary>
    public class PinyinResult
    {
        public List<PinyinLine> Lines = new List<PinyinLine>();
        public int CjkCharCount;
        public int TotalCharCount;

        /// <summary>按顺序收集所有汉字的拼音信息（跨行）。</summary>
        public List<CharPinyin> AllChars()
        {
            List<CharPinyin> list = new List<CharPinyin>();
            foreach (PinyinLine line in Lines)
            {
                foreach (PinyinToken t in line.Tokens)
                {
                    if (t.IsCJK) list.AddRange(t.Items);
                }
            }
            return list;
        }
    }

    /// <summary>
    /// 中文 → 带声调拼音引擎。
    /// 纯 C#，不依赖 UnityEngine。
    /// 词库优先进行最大匹配分词，未命中词语的汉字取单字默认读音（常见读音）。
    /// </summary>
    public class PinyinEngine
    {
        private Dictionary<uint, string[]> _charReadings; // Unicode -> 读音列表（第一个为默认读音）
        private readonly TrieNode _root = new TrieNode();
        private int _maxWordLen;

        private class TrieNode
        {
            public Dictionary<char, TrieNode> Children = new Dictionary<char, TrieNode>();
            public string[] Readings;   // 该词每个汉字对应的带声调拼音
            public bool IsWord;
        }

        /// <summary>加载单字拼音数据（pinyin.txt，格式 "U+XXXX: pinyin[,pinyin...]  # 字"）。</summary>
        public bool LoadCharData(string content)
        {
            _charReadings = new Dictionary<uint, string[]>();
            if (string.IsNullOrEmpty(content)) return false;
            foreach (string rawLine in content.Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                if (!line.StartsWith("U+", StringComparison.Ordinal)) continue;
                int colon = line.IndexOf(':');
                if (colon < 2) continue;
                string hex = line.Substring(2, colon - 2).Trim();
                uint code;
                if (!uint.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) continue;
                string pinyins = line.Substring(colon + 1);
                int hash = pinyins.IndexOf('#');
                if (hash >= 0) pinyins = pinyins.Substring(0, hash);
                string[] readings = pinyins.Split(',');
                List<string> list = new List<string>();
                foreach (string r in readings)
                {
                    string rr = r.Trim();
                    if (rr.Length > 0) list.Add(rr);
                }
                if (list.Count > 0) _charReadings[code] = list.ToArray();
            }
            return _charReadings.Count > 0;
        }

        /// <summary>
        /// 加载词级拼音数据用于多音字消歧。
        /// 兼容两种格式：
        ///   "词语: pinyin1 pinyin2 ..."（phrase-pinyin-data）
        ///   "词语<TAB/空格>pinyin1 pinyin2 ..."（zdic 等）
        /// 返回加载的词条数。
        /// </summary>
        public int LoadWordData(string content)
        {
            int count = 0;
            if (string.IsNullOrEmpty(content)) return 0;
            foreach (string rawLine in content.Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line[0] == '#') continue;

                string word;
                string pinyinPart;

                int colon = line.IndexOf(':');
                if (colon > 0)
                {
                    word = line.Substring(0, colon).Trim();
                    pinyinPart = line.Substring(colon + 1).Trim();
                }
                else
                {
                    int sep = IndexOfWhitespace(line);
                    if (sep <= 0) continue;
                    word = line.Substring(0, sep).Trim();
                    pinyinPart = line.Substring(sep).Trim();
                }

                if (word.Length < 2) continue; // 只用双字及以上词条消歧
                string[] syls = pinyinPart.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (syls.Length != word.Length) continue;
                AddWord(word, syls);
                if (word.Length > _maxWordLen) _maxWordLen = word.Length;
                count++;
            }
            return count;
        }

        private static int IndexOfWhitespace(string s)
        {
            for (int i = 0; i < s.Length; i++)
            {
                if (char.IsWhiteSpace(s[i])) return i;
            }
            return -1;
        }

        private void AddWord(string word, string[] syls)
        {
            TrieNode node = _root;
            for (int i = 0; i < word.Length; i++)
            {
                TrieNode next;
                if (!node.Children.TryGetValue(word[i], out next))
                {
                    next = new TrieNode();
                    node.Children[word[i]] = next;
                }
                node = next;
            }
            node.IsWord = true;
            node.Readings = syls;
        }

        /// <summary>取单个汉字的默认（最常见）读音。</summary>
        public string DefaultPinyin(char c)
        {
            uint code = (uint)c;
            string[] readings;
            if (_charReadings != null && _charReadings.TryGetValue(code, out readings) && readings.Length > 0)
                return readings[0];
            return "";
        }

        /// <summary>该汉字是否有拼音数据。</summary>
        public bool HasPinyin(char c)
        {
            uint code = (uint)c;
            return _charReadings != null && _charReadings.ContainsKey(code);
        }

        /// <summary>判断是否为 CJK 汉字。</summary>
        public static bool IsCjk(char c)
        {
            uint u = (uint)c;
            if (u >= 0x4E00 && u <= 0x9FFF) return true;        // CJK 统一表意文字
            if (u >= 0x3400 && u <= 0x4DBF) return true;        // 扩展 A
            if (u >= 0xF900 && u <= 0xFAFF) return true;        // 兼容表意文字
            if (u >= 0x20000 && u <= 0x2A6DF) return true;      // 扩展 B
            if (u >= 0x2A700 && u <= 0x2EBEF) return true;      // 扩展 C-F
            return false;
        }

        /// <summary>转换整段文本。</summary>
        public PinyinResult Convert(string text)
        {
            PinyinResult result = new PinyinResult();
            if (string.IsNullOrEmpty(text)) return result;

            string normalized = text.Replace("\r\n", "\n").Replace('\r', '\n');
            string[] rawLines = normalized.Split('\n');
            foreach (string rawLine in rawLines)
            {
                PinyinLine line = new PinyinLine { Source = rawLine };
                ConvertLine(rawLine, line);
                result.Lines.Add(line);
                result.TotalCharCount += rawLine.Length;
            }

            for (int i = 0; i < normalized.Length; i++)
            {
                if (IsCjk(normalized[i])) result.CjkCharCount++;
            }
            return result;
        }

        private void ConvertLine(string lineText, PinyinLine line)
        {
            int i = 0;
            int n = lineText.Length;
            while (i < n)
            {
                if (IsCjk(lineText[i]))
                {
                    int start = i;
                    while (i < n && IsCjk(lineText[i])) i++;
                    string run = lineText.Substring(start, i - start);
                    PinyinToken token = new PinyinToken(run, true);
                    SegmentCjk(run, token.Items);
                    line.Tokens.Add(token);
                }
                else
                {
                    int start = i;
                    while (i < n && !IsCjk(lineText[i])) i++;
                    line.Tokens.Add(new PinyinToken(lineText.Substring(start, i - start), false));
                }
            }
        }

        /// <summary>对一段连续汉字进行最大匹配分词并逐字注音。</summary>
        private void SegmentCjk(string run, List<CharPinyin> output)
        {
            int i = 0;
            int n = run.Length;
            while (i < n)
            {
                TrieNode node = _root;
                int j = i;
                int bestEnd = -1;
                string[] bestReadings = null;

                while (j < n)
                {
                    TrieNode next;
                    if (!node.Children.TryGetValue(run[j], out next)) break;
                    node = next;
                    j++;
                    if (node.IsWord)
                    {
                        bestEnd = j;
                        bestReadings = node.Readings;
                    }
                }

                if (bestEnd > i && bestReadings != null)
                {
                    for (int k = i; k < bestEnd; k++)
                    {
                        output.Add(MakeCharPinyin(run[k], bestReadings[k - i]));
                    }
                    i = bestEnd;
                }
                else
                {
                    output.Add(MakeCharPinyin(run[i], DefaultPinyin(run[i])));
                    i++;
                }
            }
        }

        private static CharPinyin MakeCharPinyin(char c, string pinyin)
        {
            CharPinyin cp = new CharPinyin();
            cp.Char = c;
            cp.IsCJK = true;
            cp.Pinyin = pinyin ?? "";
            cp.Tone = ToneUtil.DetectTone(cp.Pinyin);
            return cp;
        }

        // ---------------- 渲染辅助 ----------------

        /// <summary>渲染单个拼音到指定风格。</summary>
        public static string Render(string pinyin, ToneStyle style, bool uAsV)
        {
            return ToneUtil.ConvertStyle(pinyin, style, uAsV);
        }

        /// <summary>整段结果渲染为"原文 + 拼音"（拼音只渲染拼音部分）。</summary>
        public static string RenderResult(PinyinResult result, ToneStyle style, bool uAsV, bool includeSource, string syllableSep)
        {
            StringBuilder sb = new StringBuilder();
            for (int li = 0; li < result.Lines.Count; li++)
            {
                PinyinLine line = result.Lines[li];
                if (li > 0) sb.Append('\n');

                StringBuilder source = new StringBuilder();
                StringBuilder pinyin = new StringBuilder();
                foreach (PinyinToken t in line.Tokens)
                {
                    if (!t.IsCJK)
                    {
                        source.Append(t.Source);
                        pinyin.Append(t.Source);
                    }
                    else
                    {
                        source.Append(t.Source);
                        for (int k = 0; k < t.Items.Count; k++)
                        {
                            if (k > 0) pinyin.Append(syllableSep);
                            pinyin.Append(Render(t.Items[k].Pinyin, style, uAsV));
                        }
                    }
                }
                if (includeSource)
                {
                    sb.Append(source);
                    if (source.Length > 0 && pinyin.Length > 0) sb.Append("  ");
                    sb.Append(pinyin);
                }
                else
                {
                    sb.Append(pinyin);
                }
            }
            return sb.ToString();
        }

        /// <summary>渲染"拼音在上"排版中某行的拼音行：按词/音节分组、空格分隔、省略标点。</summary>
        public static string RenderLinePinyinAbove(PinyinLine line, ToneStyle style, bool uAsV)
        {
            StringBuilder sb = new StringBuilder();
            bool first = true;
            foreach (PinyinToken t in line.Tokens)
            {
                if (!t.IsCJK) continue;
                for (int k = 0; k < t.Items.Count; k++)
                {
                    string py = Render(t.Items[k].Pinyin, style, uAsV);
                    if (py.Length == 0) continue;
                    if (!first) sb.Append(' ');
                    sb.Append(py);
                    first = false;
                }
            }
            return sb.ToString();
        }

        /// <summary>渲染为"汉字(拼音)"逐字对照形式。</summary>
        public static string RenderParenthesis(PinyinResult result, ToneStyle style, bool uAsV)
        {
            StringBuilder sb = new StringBuilder();
            for (int li = 0; li < result.Lines.Count; li++)
            {
                PinyinLine line = result.Lines[li];
                if (li > 0) sb.Append('\n');
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
                            CharPinyin cp = t.Items[k];
                            sb.Append(cp.Char);
                            sb.Append('(');
                            sb.Append(Render(cp.Pinyin, style, uAsV));
                            sb.Append(')');
                        }
                    }
                }
            }
            return sb.ToString();
        }
    }
}
