using System;
using System.Collections.Generic;
using System.Text;

namespace PinyinApp.Core
{
    /// <summary>声调输出风格。</summary>
    public enum ToneStyle
    {
        Symbol = 0,   // 带声调符号 ā á ǎ à
        Number = 1,   // 数字声调 a1 a2 a3 a4
        None = 2      // 不带声调
    }

    /// <summary>
    /// 声调符号与数字之间的转换工具。
    /// 纯 C#，不依赖 UnityEngine，可单独测试。
    /// </summary>
    public static class ToneUtil
    {
        private struct MarkedChar
        {
            public char Base;
            public int Tone;
        }

        private static readonly Dictionary<char, MarkedChar> Marked = new Dictionary<char, MarkedChar>();

        static ToneUtil()
        {
            Add('ā', 'a', 1); Add('á', 'a', 2); Add('ǎ', 'a', 3); Add('à', 'a', 4);
            Add('ē', 'e', 1); Add('é', 'e', 2); Add('ě', 'e', 3); Add('è', 'e', 4);
            Add('ī', 'i', 1); Add('í', 'i', 2); Add('ǐ', 'i', 3); Add('ì', 'i', 4);
            Add('ō', 'o', 1); Add('ó', 'o', 2); Add('ǒ', 'o', 3); Add('ò', 'o', 4);
            Add('ū', 'u', 1); Add('ú', 'u', 2); Add('ǔ', 'u', 3); Add('ù', 'u', 4);
            // ü 及其四声
            Add('ǖ', 'ü', 1); Add('ǘ', 'ü', 2); Add('ǚ', 'ü', 3); Add('ǜ', 'ü', 4);
            // 罕见的鼻音/唇音声调
            Add('ń', 'n', 2); Add('ň', 'n', 3); Add('ǹ', 'n', 4);
            Add('ḿ', 'm', 2);
            Add('ế', 'ê', 3); Add('ề', 'ê', 4);
        }

        private static void Add(char marked, char baseChar, int tone)
        {
            Marked[marked] = new MarkedChar { Base = baseChar, Tone = tone };
        }

        public static bool IsMarked(char c)
        {
            return Marked.ContainsKey(c);
        }

        /// <summary>从带声调拼音串中检测声调（1-4），无标记返回 0（轻声）。</summary>
        public static int DetectTone(string pinyin)
        {
            if (string.IsNullOrEmpty(pinyin)) return 0;
            for (int i = 0; i < pinyin.Length; i++)
            {
                MarkedChar mc;
                if (Marked.TryGetValue(pinyin[i], out mc)) return mc.Tone;
            }
            return 0;
        }

        /// <summary>
        /// 将带声调拼音转换为指定风格。
        /// uAsV：数字/无声调模式下，将 ü 写成 v（输入法惯例）。
        /// </summary>
        public static string ConvertStyle(string pinyin, ToneStyle style, bool uAsV)
        {
            if (string.IsNullOrEmpty(pinyin)) return pinyin;
            if (style == ToneStyle.Symbol) return pinyin;

            StringBuilder sb = new StringBuilder(pinyin.Length + 1);
            int tone = 0;
            for (int i = 0; i < pinyin.Length; i++)
            {
                char c = pinyin[i];
                MarkedChar mc;
                if (Marked.TryGetValue(c, out mc))
                {
                    sb.Append(mc.Base);
                    if (tone == 0) tone = mc.Tone;
                }
                else
                {
                    sb.Append(c);
                }
            }
            if (uAsV)
            {
                for (int i = 0; i < sb.Length; i++)
                {
                    if (sb[i] == 'ü') sb[i] = 'v';
                }
            }
            if (style == ToneStyle.Number && tone > 0)
            {
                sb.Append(tone.ToString());
            }
            return sb.ToString();
        }
    }
}
