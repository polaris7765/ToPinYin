using System.Collections.Generic;
using PinyinApp.Core;
using UnityEngine;
using UnityEngine.UI;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 输出区组件：把拼音转换结果渲染成可滚动的流式布局。
    /// 支持三种显示方式：
    ///   Annotated  —— 每个汉字配拼音（拼音在上，汉字在下），经典注音排版；
    ///   Inline     —— 行内对照，如 你(nǐ) 好(hǎo)；
    ///   PinyinOnly —— 仅拼音。
    /// </summary>
    public class AnnotatedOutput : MonoBehaviour
    {
        public enum DisplayMode { Annotated, Inline, PinyinOnly }

        private ScrollRect _scroll;
        private RectTransform _content;
        private Font _font;

        private const float CharSize = 30f;
        private const float PinyinSize = 18f;
        private const float PlainSize = 24f;
        private const float UnitGap = 8f;
        private const float LineGap = 16f;
        private const float ParaGap = 22f;
        private const float PadX = 14f;
        private const float PadTop = 12f;

        private static readonly Color CharColor = UiFactory.TextDark;
        private static readonly Color PinyinColor = UiFactory.Primary;
        private static readonly Color PlainColor = UiFactory.TextDark;

        public void Setup(ScrollRect scroll, RectTransform content)
        {
            _scroll = scroll;
            _content = content;
        }

        public void Clear()
        {
            if (_content == null) return;
            for (int i = _content.childCount - 1; i >= 0; i--)
            {
                Destroy(_content.GetChild(i).gameObject);
            }
        }

        public void Show(PinyinResult result, ToneStyle tone, bool uAsV, DisplayMode mode)
        {
            if (_content == null) return;
            if (_font == null) _font = UiFonts.Get((int)CharSize);
            Clear();

            RectTransform viewport = _scroll != null ? _scroll.viewport : null;
            float viewW = (viewport != null && viewport.rect.width > 10f) ? viewport.rect.width : 500f;
            float maxW = Mathf.Max(120f, viewW - PadX * 2f);

            float x = PadX, y = PadTop, lineH = 0f;
            float cursorBottom = 0f;

            for (int li = 0; li < result.Lines.Count; li++)
            {
                PinyinLine line = result.Lines[li];
                if (li > 0)
                {
                    // 段落换行
                    y += lineH + ParaGap;
                    x = PadX;
                    lineH = 0f;
                }
                if (line.Tokens.Count == 0)
                {
                    // 空行：留出行高
                    y += 30f;
                    lineH = 0f;
                    continue;
                }

                foreach (PinyinToken token in line.Tokens)
                {
                    if (!token.IsCJK)
                    {
                        AddInline(token.Source, ref x, ref y, ref lineH, maxW);
                    }
                    else
                    {
                        foreach (CharPinyin cp in token.Items)
                        {
                            if (mode == DisplayMode.Annotated)
                            {
                                string py = PinyinEngine.Render(cp.Pinyin, tone, uAsV);
                                AddGroup(cp.Char, py, ref x, ref y, ref lineH, maxW);
                            }
                            else if (mode == DisplayMode.Inline)
                            {
                                string py = PinyinEngine.Render(cp.Pinyin, tone, uAsV);
                                string s = cp.Pinyin.Length == 0 ? cp.Char.ToString() : cp.Char + "(" + py + ")";
                                AddInline(s, ref x, ref y, ref lineH, maxW);
                            }
                            else // PinyinOnly
                            {
                                string py = PinyinEngine.Render(cp.Pinyin, tone, uAsV);
                                if (py.Length == 0) py = "·";
                                AddInline(py, ref x, ref y, ref lineH, maxW, true);
                            }
                        }
                    }
                }
                cursorBottom = Mathf.Max(cursorBottom, y + lineH);
            }

            // 设置内容高度
            float totalH = cursorBottom + PadTop + 4f;
            _content.sizeDelta = new Vector2(viewW, totalH);
        }

        // ---------- 布局原语 ----------

        private void AddInline(string text, ref float x, ref float y, ref float lineH, float maxW, bool pinyinStyle = false)
        {
            if (string.IsNullOrEmpty(text)) return;
            float w = MeasureText(text, pinyinStyle ? PinyinSize : PlainSize);
            float h = (pinyinStyle ? PinyinSize : PlainSize) + 8f;
            if (x + w > maxW + 0.1f && x > PadX + 0.1f)
            {
                x = PadX;
                y += lineH + LineGap;
                lineH = 0f;
            }
            Text t = CreateText(_content, text, pinyinStyle ? PinyinSize : PlainSize,
                pinyinStyle ? PinyinColor : PlainColor);
            Place(t.rectTransform, x, y, w, h);
            x += w + UnitGap;
            lineH = Mathf.Max(lineH, h);
        }

        private void AddGroup(char c, string pinyin, ref float x, ref float y, ref float lineH, float maxW)
        {
            float pyW = MeasureText(pinyin, PinyinSize);
            float charW = MeasureText(c.ToString(), CharSize);
            float w = Mathf.Max(pyW, charW) + 2f;
            float h = PinyinSize + 2f + CharSize + 2f;

            if (x + w > maxW + 0.1f && x > PadX + 0.1f)
            {
                x = PadX;
                y += lineH + LineGap;
                lineH = 0f;
            }

            RectTransform group = UiFactory.CreateUI("Unit", _content);
            UiFactory.Place(group, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(x, -y), new Vector2(w, h));

            // 拼音（上）
            Text py = CreateText(group, pinyin, PinyinSize, PinyinColor, TextAnchor.MiddleCenter);
            UiFactory.Place(py.rectTransform, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), Vector2.zero, new Vector2(w, PinyinSize + 2f));

            // 汉字（下）
            Text ch = CreateText(group, c.ToString(), CharSize, CharColor, TextAnchor.MiddleCenter);
            UiFactory.Place(ch.rectTransform, new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), Vector2.zero, new Vector2(w, CharSize + 2f));

            x += w + UnitGap;
            lineH = Mathf.Max(lineH, h);
        }

        private Text CreateText(Transform parent, string content, float size, Color color, TextAnchor align = TextAnchor.MiddleLeft)
        {
            RectTransform rt = UiFactory.CreateUI("T", parent);
            Text t = rt.gameObject.AddComponent<Text>();
            t.font = _font;
            t.text = content;
            t.fontSize = Mathf.RoundToInt(size);
            t.color = color;
            t.alignment = align;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.supportRichText = false;
            t.raycastTarget = false;
            return t;
        }

        private void Place(RectTransform rt, float x, float y, float w, float h)
        {
            rt.anchorMin = new Vector2(0f, 1f);
            rt.anchorMax = new Vector2(0f, 1f);
            rt.pivot = new Vector2(0f, 1f);
            rt.anchoredPosition = new Vector2(x, -y);
            rt.sizeDelta = new Vector2(w, h);
        }

        private float MeasureText(string s, float size)
        {
            Text probe = CreateText(_content, s, size, Color.clear);
            float w = probe.preferredWidth;
            Destroy(probe.gameObject);
            return w;
        }
    }
}
