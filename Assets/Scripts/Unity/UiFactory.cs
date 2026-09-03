using System;
using UnityEngine;
using UnityEngine.UI;

namespace PinyinApp.Unity
{
    /// <summary>
    /// UI 工厂：程序化创建 Canvas / 卡片 / 文本 / 按钮 / 输入框 / 滚动区，
    /// 内置圆角精灵生成（9-slice），整体现代简约风格。
    /// </summary>
    public static class UiFactory
    {
        // 调色板
        public static readonly Color Primary = Hex("#3B6EF6");
        public static readonly Color PrimaryDark = Hex("#2C55C9");
        public static readonly Color PrimaryLight = Hex("#E8EEFD");
        public static readonly Color Accent = Hex("#10B3A3");
        public static readonly Color Bg = Hex("#F3F5FA");
        public static readonly Color Card = new Color(1f, 1f, 1f, 0.98f);
        public static readonly Color TextDark = Hex("#22304A");
        public static readonly Color TextGray = Hex("#8A94A6");
        public static readonly Color TextLight = Hex("#B9C2D0");
        public static readonly Color Danger = Hex("#E5484D");
        public static readonly Color InputBg = Hex("#F2F4F8");

        public static Color Hex(string hex)
        {
            Color c;
            ColorUtility.TryParseHtmlString(hex, out c);
            return c;
        }

        /// <summary>创建全局 Canvas（Screen Space Overlay + CanvasScaler），并确保存在 EventSystem。</summary>
        public static Canvas CreateCanvas(string name, Vector2 refResolution)
        {
            EnsureEventSystem();
            GameObject go = new GameObject(name, typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            Canvas canvas = go.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 100;
            CanvasScaler scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = refResolution;
            scaler.matchWidthOrHeight = 0.5f;
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            return canvas;
        }

        /// <summary>确保场景中存在 EventSystem（输入必需）。</summary>
        public static void EnsureEventSystem()
        {
            if (UnityEngine.Object.FindObjectOfType<UnityEngine.EventSystems.EventSystem>() != null) return;
            new GameObject("EventSystem", typeof(UnityEngine.EventSystems.EventSystem),
                typeof(UnityEngine.EventSystems.StandaloneInputModule));
        }

        public static RectTransform CreateUI(string name, Transform parent)
        {
            GameObject go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return go.GetComponent<RectTransform>();
        }

        /// <summary>撑满父级（带边距）。</summary>
        public static void Stretch(RectTransform rt, float l, float t, float r, float b)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(l, b);
            rt.offsetMax = new Vector2(-r, -t);
            rt.pivot = new Vector2(0.5f, 0.5f);
        }

        /// <summary>绝对定位（基于锚点）。</summary>
        public static void Place(RectTransform rt, Vector2 anchor, Vector2 pivot, Vector2 anchoredPos, Vector2 size)
        {
            rt.anchorMin = anchor;
            rt.anchorMax = anchor;
            rt.pivot = pivot;
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
        }

        public static Image CreateImage(Transform parent, Sprite sprite, Color color)
        {
            RectTransform rt = CreateUI("Image", parent);
            Image img = rt.gameObject.AddComponent<Image>();
            img.sprite = sprite;
            img.color = color;
            if (sprite != null && sprite.border != Vector4.zero) img.type = Image.Type.Sliced;
            return img;
        }

        public static Text CreateText(Transform parent, string content, int fontSize, Color color, Font font, TextAnchor align = TextAnchor.MiddleLeft, bool bold = false)
        {
            RectTransform rt = CreateUI("Text", parent);
            Text t = rt.gameObject.AddComponent<Text>();
            t.font = font;
            t.text = content;
            t.fontSize = fontSize;
            t.color = color;
            t.alignment = align;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.supportRichText = false;
            t.raycastTarget = false;
            if (bold) t.fontStyle = FontStyle.Bold;
            return t;
        }

        /// <summary>创建按钮（带按下/悬停反馈）。</summary>
        public static Button CreateButton(Transform parent, string label, int fontSize, Color bg, Color fg, Font font, Sprite sprite, Action onClick)
        {
            RectTransform rt = CreateUI("Button", parent);
            Image img = rt.gameObject.AddComponent<Image>();
            img.sprite = sprite;
            img.type = Image.Type.Sliced;
            img.color = Color.white;

            Button btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = img;
            ColorBlock cb = btn.colors;
            cb.normalColor = bg;
            cb.highlightedColor = Color.Lerp(bg, Color.white, 0.15f);
            cb.pressedColor = Color.Lerp(bg, Color.black, 0.18f);
            cb.selectedColor = bg;
            cb.fadeDuration = 0.08f;
            btn.colors = cb;

            if (!string.IsNullOrEmpty(label))
            {
                RectTransform lr = CreateUI("Label", rt);
                Stretch(lr, 0, 0, 0, 0);
                Text t = lr.gameObject.AddComponent<Text>();
                t.font = font;
                t.text = label;
                t.fontSize = fontSize;
                t.color = fg;
                t.alignment = TextAnchor.MiddleCenter;
                t.supportRichText = false;
            }

            if (onClick != null) btn.onClick.AddListener(() => onClick());
            return btn;
        }

        /// <summary>创建一个"段选"按钮（多选一，高亮当前项）。返回的 Button 已绑定切换高亮。</summary>
        public static Button CreateSegmentButton(Transform parent, string label, int fontSize, Font font, Sprite sprite,
            Action onSelect, Func<bool> isSelected)
        {
            RectTransform rt = CreateUI("Seg", parent);
            Image img = rt.gameObject.AddComponent<Image>();
            img.sprite = sprite;
            img.type = Image.Type.Sliced;
            img.color = Color.white;

            Button btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = img;
            btn.transition = Selectable.Transition.None;   // 高亮由 RefreshSegment 统一管理

            RectTransform lr = CreateUI("Label", rt);
            Stretch(lr, 0, 0, 0, 0);
            Text t = lr.gameObject.AddComponent<Text>();
            t.font = font;
            t.text = label;
            t.fontSize = fontSize;
            t.color = TextGray;
            t.alignment = TextAnchor.MiddleCenter;
            t.supportRichText = false;

            btn.onClick.AddListener(() => onSelect());
            SegmentRef sr = btn.gameObject.AddComponent<SegmentRef>();
            sr.Label = t;
            sr.Bg = img;
            sr.Btn = btn;
            return btn;
        }

        /// <summary>段选辅助：记录每个段的 Text 与 Image 供高亮刷新，Btn 供重新绑定点击。</summary>
        public class SegmentRef : MonoBehaviour
        {
            public Text Label;
            public Image Bg;
            public Button Btn;
            public void SetActive(bool active)
            {
                if (Bg != null) Bg.color = active ? Primary : Color.white;
                if (Label != null) Label.color = active ? Color.white : TextGray;
            }
        }

        public static InputField CreateInputField(Transform parent, Font font, int fontSize, string placeholder, bool multiline)
        {
            RectTransform rt = CreateUI("InputField", parent);
            Image img = rt.gameObject.AddComponent<Image>();
            img.color = InputBg;
            img.raycastTarget = true;

            InputField field = rt.gameObject.AddComponent<InputField>();
            field.targetGraphic = img;

            // 文本
            RectTransform tr = CreateUI("Text", rt);
            Stretch(tr, 12, 6, 12, 6);
            Text text = tr.gameObject.AddComponent<Text>();
            text.font = font;
            text.fontSize = fontSize;
            text.color = TextDark;
            text.alignment = multiline ? TextAnchor.UpperLeft : TextAnchor.MiddleLeft;
            text.supportRichText = false;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;

            // 占位符
            RectTransform pr = CreateUI("Placeholder", rt);
            Stretch(pr, 12, 6, 12, 6);
            Text ph = pr.gameObject.AddComponent<Text>();
            ph.font = font;
            ph.fontSize = fontSize;
            ph.color = TextLight;
            ph.alignment = multiline ? TextAnchor.UpperLeft : TextAnchor.MiddleLeft;
            ph.supportRichText = false;
            ph.horizontalOverflow = HorizontalWrapMode.Wrap;
            ph.verticalOverflow = VerticalWrapMode.Truncate;
            ph.text = placeholder;
            ph.raycastTarget = false;

            field.textComponent = text;
            field.placeholder = ph;
            field.lineType = multiline ? InputField.LineType.MultiLineNewline : InputField.LineType.SingleLine;
            field.characterLimit = 0;
            field.caretBlinkRate = 0.85f;
            field.selectionColor = new Color(0.23f, 0.43f, 0.96f, 0.4f);
            return field;
        }

        /// <summary>创建 ScrollRect 结构（Viewport + Content），返回 ScrollRect。</summary>
        public static ScrollRect CreateScrollRect(Transform parent, out RectTransform contentOut)
        {
            // Viewport
            RectTransform vp = CreateUI("Viewport", parent);
            Image vpImg = vp.gameObject.AddComponent<Image>();
            vpImg.color = new Color(0.97f, 0.98f, 1f, 1f);

            RectTransform content = CreateUI("Content", vp);
            content.anchorMin = new Vector2(0f, 1f);
            content.anchorMax = new Vector2(0f, 1f);
            content.pivot = new Vector2(0f, 1f);

            ScrollRect sr = vp.gameObject.AddComponent<ScrollRect>();
            sr.viewport = vp;
            sr.content = content;
            sr.horizontal = false;
            sr.vertical = true;
            sr.movementType = ScrollRect.MovementType.Clamped;
            sr.scrollSensitivity = 30f;
            sr.inertia = true;
            sr.decelerationRate = 0.135f;

            contentOut = content;
            return sr;
        }

        // ---------------- 圆角精灵 ----------------

        /// <summary>生成圆角矩形精灵（9-slice，含边框）。</summary>
        public static Sprite RoundedRect(int w, int h, int radius, Color fill, Color border, int borderW)
        {
            return MakeRounded(w, h, radius, fill, border, borderW);
        }

        /// <summary>生成圆角矩形精灵（无边框，纯填充）。</summary>
        public static Sprite RoundedRectFill(int w, int h, int radius, Color fill)
        {
            return MakeRounded(w, h, radius, fill, Color.clear, 0);
        }

        private static Sprite MakeRounded(int w, int h, int radius, Color fill, Color border, int borderW)
        {
            Texture2D tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            float cx = w / 2f, cy = h / 2f, hw = w / 2f, hh = h / 2f;
            float r = Mathf.Max(1, radius);
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    float d = RoundedSdf(x + 0.5f, y + 0.5f, cx, cy, hw, hh, r);
                    Color c;
                    if (d < -borderW) c = fill;                 // 内部
                    else if (d < 0) c = border;                 // 边框带
                    else c = new Color(fill.r, fill.g, fill.b, 0f);
                    // 外缘抗锯齿
                    if (d >= 0f && d < 1.5f)
                    {
                        c = Color.Lerp(border == Color.clear ? fill : border, new Color(fill.r, fill.g, fill.b, 0f),
                            Mathf.Clamp01(d / 1.5f));
                    }
                    tex.SetPixel(x, y, c);
                }
            }
            tex.Apply();
            Vector4 b = new Vector4(r, r, r, r);
            return Sprite.Create(tex, new Rect(0, 0, w, h), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, b);
        }

        private static float RoundedSdf(float px, float py, float cx, float cy, float hw, float hh, float r)
        {
            float qx = Mathf.Abs(px - cx) - (hw - r);
            float qy = Mathf.Abs(py - cy) - (hh - r);
            float ax = Mathf.Max(qx, 0f), ay = Mathf.Max(qy, 0f);
            float outside = Mathf.Sqrt(ax * ax + ay * ay) - r;
            float inside = Mathf.Min(Mathf.Max(qx, qy), 0f);
            return inside + outside;
        }
    }
}
