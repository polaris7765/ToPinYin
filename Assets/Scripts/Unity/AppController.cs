using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using PinyinApp.Core;
using UnityEngine;
using UnityEngine.UI;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 「中文拼音助手」App 主控制器。
    /// 输入中文 → 输出带声调拼音（多音字词库消歧），支持导出 Word / PDF / 文本。
    /// 竖屏 1080x1920 布局；优先复用场景中已有的 Canvas（场景骨架由 SceneBuilder 生成）。
    /// </summary>
    public class AppController : MonoBehaviour
    {
        private PinyinEngine _engine;
        private PinyinResult _result;

        // UI 引用
        private InputField _input;
        private Text _charCount;
        private AnnotatedOutput _output;
        private Text _status;
        private UiFactory.SegmentRef[] _toneSegs;
        private UiFactory.SegmentRef[] _modeSegs;
        private Image _uAsvBg;
        private Text _uAsvLabel;
        private Button _btnConvert;
        private Button _btnClear;
        private Button _btnWord;
        private Button _btnPdf;
        private Button _btnTxt;
        private Button _btnCopy;
        private Button _btnOpenDir;
        private Button _uvButton;

        // 自适应布局尺寸（参考单位，宽固定 1080，高按屏幕比例推算，并扣除安全区）
        private float _w = 1080f;
        private float _h = 1920f;
        private string _lastExportPath;

        // 选项
        private ToneStyle _tone = ToneStyle.Symbol;
        private AnnotatedOutput.DisplayMode _mode = AnnotatedOutput.DisplayMode.Annotated;
        private bool _uAsV = true;

        private string _exportDir;
        private Sprite _cardSprite, _btnSprite, _segSprite, _shadowSprite;

        private const string APP_NAME = "中文拼音助手";
        private const string APP_SUB = "中文 → 拼音（带声调）· 支持导出 Word / PDF";
        private static readonly Vector2 RefRes = new Vector2(1080f, 1920f);

        public static void Bootstrap()
        {
            if (FindObjectOfType<AppController>() == null)
            {
                GameObject go = new GameObject("中文拼音助手");
                go.AddComponent<AppController>();
            }
        }

        private void Start()
        {
            BuildUi();                          // 始终按当前屏幕尺寸重建，保证自适应
            WireEvents();
            ApplyRuntimeFonts();
            _lastScreen = new Vector2Int(Screen.width, Screen.height);
            StartCoroutine(LoadData());
        }

        private Vector2Int _lastScreen;
        private float _rebuildTimer;

        private void Update()
        {
            // 屏幕尺寸 / 方向变化时重建布局（防抖 0.25s）
            if (_lastScreen.x != Screen.width || _lastScreen.y != Screen.height)
            {
                _rebuildTimer += Time.unscaledDeltaTime;
                if (_rebuildTimer >= 0.25f)
                {
                    _lastScreen = new Vector2Int(Screen.width, Screen.height);
                    _rebuildTimer = 0f;
                    Rebuild();
                }
            }
            else _rebuildTimer = 0f;
        }

        /// <summary>重建 UI 并恢复当前状态。</summary>
        private void Rebuild()
        {
            string text = _input != null ? _input.text : "";
            BuildUi();
            WireEvents();
            ApplyRuntimeFonts();
            if (_input != null) _input.text = text;
            _btnConvert.interactable = _engine != null;
            RefreshSegments(_toneSegs, _tone == ToneStyle.Symbol ? 0 : (_tone == ToneStyle.Number ? 1 : 2));
            RefreshSegments(_modeSegs, (int)_mode);
            if (_uAsvBg != null) _uAsvBg.color = _uAsV ? UiFactory.Primary : UiFactory.InputBg;
            if (_uAsvLabel != null) _uAsvLabel.color = _uAsV ? Color.white : UiFactory.TextGray;
            StartCoroutine(DelayedRefreshOutput());
        }

        private IEnumerator DelayedRefreshOutput()
        {
            yield return null;                  // 等待一帧，让 Viewport 完成布局
            yield return new WaitForEndOfFrame();
            RefreshOutput();
        }

        // ================= 数据加载 =================

        private IEnumerator LoadData()
        {
            Status("正在加载拼音库…");
            var r1 = Resources.LoadAsync<TextAsset>("Data/pinyin");
            var r2 = Resources.LoadAsync<TextAsset>("Data/phrase_pinyin");
            var r3 = Resources.LoadAsync<TextAsset>("Data/zdic_cibs");
            yield return r1;
            yield return r2;
            yield return r3;

            _engine = new PinyinEngine();
            if (r1.asset != null) _engine.LoadCharData(((TextAsset)r1.asset).text);
            int words = 0;
            if (r2.asset != null) words += _engine.LoadWordData(((TextAsset)r2.asset).text);
            if (r3.asset != null) words += _engine.LoadWordData(((TextAsset)r3.asset).text);
            Status("拼音库就绪 · 词条 " + words + " · 请输入中文后点击「转换」");
            _btnConvert.interactable = true;
            _input.ActivateInputField();

            // 自测模式：-demo 启动时自动填词、转换并导出 Word/PDF
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "-demo") >= 0)
            {
                RunDemo();
            }
        }

        /// <summary>自动演示：填示例 → 转换 → 导出 Word/PDF（用于构建产物自测）。</summary>
        private void RunDemo()
        {
            try
            {
                _input.text = "你好，世界！这是中文拼音转换应用。\n银行 长大 音乐 重要 快乐 行走 干净 方便 重庆 校长 长度。";
                OnConvert();
                OnExportDocx();
                OnExportPdf();
            }
            catch (Exception e)
            {
                Status("自测出错：" + e.Message);
            }
        }

        // ================= UI 构建（竖屏 1080x1920） =================

        private void BuildUi()
        {
            // 复用场景中已有的 Canvas（SceneBuilder 已生成），否则新建
            Canvas canvas = FindObjectOfType<Canvas>();
            if (canvas == null) canvas = UiFactory.CreateCanvas("Canvas", RefRes);
            CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
            if (scaler == null) scaler = canvas.gameObject.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = RefRes;
            // 以宽度为基准缩放：任何屏幕宽度都恰好等于 1080 参考单位，横向永不溢出
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0f;
            UiFactory.EnsureEventSystem();

            RectTransform root = (RectTransform)canvas.transform;
            // 清空已有子节点，避免重复构建
            for (int i = root.childCount - 1; i >= 0; i--)
            {
                if (Application.isPlaying) Destroy(root.GetChild(i).gameObject);
                else DestroyImmediate(root.GetChild(i).gameObject);
            }

            Image bg = UiFactory.CreateImage(root, null, UiFactory.Bg);
            UiFactory.Stretch(bg.rectTransform, 0, 0, 0, 0);

            // 安全区容器（刘海 / 圆角 / 手势条）
            RectTransform safe = UiFactory.CreateUI("SafeArea", root);
            UiFactory.Stretch(safe, 0, 0, 0, 0);
            safe.gameObject.AddComponent<SafeAreaFitter>().Apply();

            Vector2 size = SafeAreaFitter.SafeSizeInReference(RefRes.x);
            _w = size.x;
            _h = size.y;

            const float pad = 24f;
            float headerH = Mathf.Clamp(_h * 0.085f, 120f, 160f);
            BuildHeader(safe, headerH);

            float gap = 14f;
            float avail = _h - headerH - gap * 2f - pad;      // 两张卡片可用总高
            float inputH = Mathf.Clamp(avail * 0.48f, 420f, 660f);
            float outputH = Mathf.Max(320f, avail - inputH);

            float cardW = _w - pad * 2f;
            BuildInputCard(safe, new Vector2(pad, -(headerH + gap)), new Vector2(cardW, inputH));
            BuildOutputCard(safe, new Vector2(pad, -(headerH + gap + inputH + gap)), new Vector2(cardW, outputH));
        }

        private void BuildHeader(Transform root, float headerH)
        {
            RectTransform header = UiFactory.CreateUI("Header", root);
            // 顶部横向拉伸，宽度自适应
            header.anchorMin = new Vector2(0f, 1f);
            header.anchorMax = new Vector2(1f, 1f);
            header.pivot = new Vector2(0.5f, 1f);
            header.offsetMin = new Vector2(0f, -headerH);
            header.offsetMax = Vector2.zero;
            Image hb = header.gameObject.AddComponent<Image>();
            hb.color = UiFactory.Primary;

            float iconSize = Mathf.Min(56f, headerH * 0.4f);

            // 应用图标
            RectTransform icon = UiFactory.CreateUI("Icon", header);
            UiFactory.Place(icon, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(28, -26), new Vector2(iconSize, iconSize));
            Image iconBg = icon.gameObject.AddComponent<Image>();
            iconBg.sprite = _segSprite ?? (_segSprite = UiFactory.RoundedRectFill(48, 48, 12, Color.white));
            iconBg.type = Image.Type.Sliced;
            Text iconT = UiFactory.CreateText(icon, "拼", 30, UiFactory.Primary, S(30), TextAnchor.MiddleCenter, true);
            UiFactory.Stretch(iconT.rectTransform, 0, 0, 0, 0);

            float textX = 28f + iconSize + 24f;
            float textW = _w - textX - 24f;

            // 标题
            Text title = UiFactory.CreateText(header, APP_NAME, 34, Color.white, S(34), TextAnchor.MiddleLeft, true);
            UiFactory.Place(title.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(textX, -22), new Vector2(textW, 44));

            // 副标题（宽度不足时自动换行截断）
            Text sub = UiFactory.CreateText(header, APP_SUB, 18, new Color(1f, 1f, 1f, 0.85f), S(18), TextAnchor.MiddleLeft);
            UiFactory.Place(sub.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(textX, -74), new Vector2(textW, 30));
            sub.horizontalOverflow = HorizontalWrapMode.Wrap;
        }

        private void BuildInputCard(Transform root, Vector2 pos, Vector2 size)
        {
            RectTransform card = CreateCard(root, "InputCard", pos, size);
            float cw = size.x;
            float innerW = cw - 48f;

            Text title = UiFactory.CreateText(card, "输入中文", 24, UiFactory.TextDark, S(24), TextAnchor.MiddleLeft, true);
            UiFactory.Place(title.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(24, -20), new Vector2(240, 36));

            _charCount = UiFactory.CreateText(card, "0 字", 18, UiFactory.TextGray, S(18), TextAnchor.MiddleRight);
            UiFactory.Place(_charCount.rectTransform, new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-24, -20), new Vector2(300, 32));

            // 自底向上排布：按钮 → ü 开关 → 显示 → 声调
            const float btnH = 52f, rowH = 42f, uvH = 38f;
            float btnBottom = 20f;
            float uvBottom = btnBottom + btnH + 14f;
            float modeBottom = uvBottom + uvH + 12f;
            float toneBottom = modeBottom + rowH + 12f;
            float inputTop = 64f;
            float inputH = Mathf.Max(120f, size.y - inputTop - (toneBottom + rowH + 14f));

            // 输入框
            _input = UiFactory.CreateInputField(card, S(22), 22, "请输入中文，例如：你好，世界！\n支持多行输入、多音字智能消歧。", true);
            UiFactory.Place(_input.GetComponent<RectTransform>(), new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(24, -inputTop), new Vector2(innerW, inputH));

            const float labelW = 76f;
            float segAreaX = 24f + labelW;
            float segW = (innerW - labelW - 20f) / 3f;

            // 声调风格
            Text toneLabel = UiFactory.CreateText(card, "声调", 20, UiFactory.TextDark, S(20), TextAnchor.MiddleLeft);
            PlaceBottom(toneLabel.rectTransform, 24f, toneBottom, labelW, rowH);
            _toneSegs = CreateSegmentRow(card, segAreaX, toneBottom, new string[] { "带声调 ā", "数字 a1", "无声调" }, segW, rowH, 18, OnToneChanged);

            // 显示方式
            Text modeLabel = UiFactory.CreateText(card, "显示", 20, UiFactory.TextDark, S(20), TextAnchor.MiddleLeft);
            PlaceBottom(modeLabel.rectTransform, 24f, modeBottom, labelW, rowH);
            _modeSegs = CreateSegmentRow(card, segAreaX, modeBottom, new string[] { "逐字标注", "行内对照", "仅拼音" }, segW, rowH, 18, OnModeChanged);

            // ü→v 开关
            RectTransform toggle = UiFactory.CreateUI("UVToggle", card);
            PlaceBottom(toggle, 24f, uvBottom, Mathf.Min(300f, innerW), uvH);
            _uAsvBg = toggle.gameObject.AddComponent<Image>();
            _uAsvBg.sprite = _segSprite;
            _uAsvBg.type = Image.Type.Sliced;
            _uAsvBg.color = _uAsV ? UiFactory.Primary : UiFactory.InputBg;
            _uvButton = toggle.gameObject.AddComponent<Button>();
            _uvButton.targetGraphic = _uAsvBg;
            _uvButton.transition = Selectable.Transition.None;
            _uAsvLabel = UiFactory.CreateText(toggle, "ü 用 v 表示", 18, _uAsV ? Color.white : UiFactory.TextGray, S(18), TextAnchor.MiddleLeft);
            UiFactory.Stretch(_uAsvLabel.rectTransform, 12, 0, 0, 0);

            // 主按钮
            float halfW = (innerW - 16f) / 2f;
            _btnConvert = UiFactory.CreateButton(card, "转 换", 24, UiFactory.Primary, Color.white, S(24), _btnSprite ?? (_btnSprite = UiFactory.RoundedRectFill(32, 32, 10, Color.white)), OnConvert);
            PlaceBottom(_btnConvert.GetComponent<RectTransform>(), 24f, btnBottom, halfW, btnH);
            _btnConvert.interactable = false;

            _btnClear = UiFactory.CreateButton(card, "清 空", 24, UiFactory.InputBg, UiFactory.TextGray, S(24), _btnSprite, OnClear);
            PlaceBottom(_btnClear.GetComponent<RectTransform>(), 24f + halfW + 16f, btnBottom, halfW, btnH);
        }

        private void BuildOutputCard(Transform root, Vector2 pos, Vector2 size)
        {
            RectTransform card = CreateCard(root, "OutputCard", pos, size);
            float innerW = size.x - 48f;

            Text title = UiFactory.CreateText(card, "转换结果", 24, UiFactory.TextDark, S(24), TextAnchor.MiddleLeft, true);
            UiFactory.Place(title.rectTransform, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(24, -20), new Vector2(240, 36));

            const float statusH = 56f, btnH = 50f;
            float statusBottom = 12f;
            float btnBottom = statusBottom + statusH + 8f;
            float scrollTop = 64f;
            float scrollH = Mathf.Max(120f, size.y - scrollTop - (btnBottom + btnH + 12f));

            // 输出滚动区
            RectTransform content;
            ScrollRect sr = UiFactory.CreateScrollRect(card, out content);
            UiFactory.Place(sr.GetComponent<RectTransform>(), new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(24, -scrollTop), new Vector2(innerW, scrollH));

            GameObject outGo = new GameObject("AnnotatedOutput");
            outGo.transform.SetParent(card, false);
            _output = outGo.AddComponent<AnnotatedOutput>();
            _output.Setup(sr, content);

            // 底部操作按钮：移动端不显示「打开目录」
            bool mobile = NativeFileOpener.IsMobile;
            int count = mobile ? 4 : 5;
            float bgap = 10f;
            float bw = (innerW - bgap * (count - 1)) / count;
            float bx = 24f;

            _btnCopy = UiFactory.CreateButton(card, "复制结果", 19, UiFactory.Primary, Color.white, S(19), _btnSprite, OnCopy);
            PlaceBottom(_btnCopy.GetComponent<RectTransform>(), bx, btnBottom, bw, btnH); bx += bw + bgap;

            _btnWord = UiFactory.CreateButton(card, "导出 Word", 19, UiFactory.PrimaryLight, UiFactory.Primary, S(19), _btnSprite, OnExportDocx);
            PlaceBottom(_btnWord.GetComponent<RectTransform>(), bx, btnBottom, bw, btnH); bx += bw + bgap;

            _btnPdf = UiFactory.CreateButton(card, "导出 PDF", 19, UiFactory.PrimaryLight, UiFactory.Primary, S(19), _btnSprite, OnExportPdf);
            PlaceBottom(_btnPdf.GetComponent<RectTransform>(), bx, btnBottom, bw, btnH); bx += bw + bgap;

            _btnTxt = UiFactory.CreateButton(card, "导出文本", 19, UiFactory.PrimaryLight, UiFactory.Primary, S(19), _btnSprite, OnExportTxt);
            PlaceBottom(_btnTxt.GetComponent<RectTransform>(), bx, btnBottom, bw, btnH); bx += bw + bgap;

            if (!mobile)
            {
                _btnOpenDir = UiFactory.CreateButton(card, "打开目录", 19, UiFactory.InputBg, UiFactory.TextGray, S(19), _btnSprite, OnOpenFolder);
                PlaceBottom(_btnOpenDir.GetComponent<RectTransform>(), bx, btnBottom, bw, btnH);
            }

            // 状态栏
            _status = UiFactory.CreateText(card, "正在初始化…", 16, UiFactory.TextGray, S(16), TextAnchor.UpperLeft);
            PlaceBottom(_status.rectTransform, 24f, statusBottom, innerW, statusH);
            _status.horizontalOverflow = HorizontalWrapMode.Wrap;
            _status.verticalOverflow = VerticalWrapMode.Truncate;

            RefreshSegments(_toneSegs, 0);
            RefreshSegments(_modeSegs, 0);
        }

        /// <summary>以父级左下角为基准放置（便于底部对齐的自适应布局）。</summary>
        private static void PlaceBottom(RectTransform rt, float x, float bottom, float w, float h)
        {
            UiFactory.Place(rt, new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(x, bottom), new Vector2(w, h));
        }

        private RectTransform CreateCard(Transform parent, string name, Vector2 pos, Vector2 size)
        {
            // 阴影
            RectTransform shadow = UiFactory.CreateUI(name + "Shadow", parent);
            UiFactory.Place(shadow, new Vector2(0f, 1f), new Vector2(0f, 1f), pos + new Vector2(0f, -4f), size);
            Image sh = shadow.gameObject.AddComponent<Image>();
            sh.sprite = _shadowSprite ?? (_shadowSprite = UiFactory.RoundedRectFill(48, 48, 12, new Color(0.08f, 0.11f, 0.17f, 0.07f)));
            sh.type = Image.Type.Sliced;

            // 卡片主体
            RectTransform card = UiFactory.CreateUI(name, parent);
            UiFactory.Place(card, new Vector2(0f, 1f), new Vector2(0f, 1f), pos, size);
            Image img = card.gameObject.AddComponent<Image>();
            img.sprite = _cardSprite ?? (_cardSprite = UiFactory.RoundedRect(48, 48, 12, UiFactory.Card, UiFactory.Hex("#E3E8F2"), 1));
            img.type = Image.Type.Sliced;
            return card;
        }

        private UiFactory.SegmentRef[] CreateSegmentRow(Transform parent, float x, float bottom, string[] labels, float btnW, float btnH, int fontSize, Action<int> onChanged)
        {
            var refs = new UiFactory.SegmentRef[labels.Length];
            for (int i = 0; i < labels.Length; i++)
            {
                int idx = i;
                float bx = x + i * (btnW + 10f);
                Button b = UiFactory.CreateSegmentButton(parent, labels[i], fontSize, S(fontSize),
                    _segSprite ?? (_segSprite = UiFactory.RoundedRectFill(48, 48, 10, Color.white)),
                    () => onChanged(idx), null);
                PlaceBottom(b.GetComponent<RectTransform>(), bx, bottom, btnW, btnH);
                refs[i] = b.GetComponent<UiFactory.SegmentRef>();
            }
            return refs;
        }

        private static void RefreshSegments(UiFactory.SegmentRef[] refs, int active)
        {
            if (refs == null) return;
            for (int i = 0; i < refs.Length; i++)
            {
                if (refs[i] != null) refs[i].SetActive(i == active);
            }
        }

        // ================= 事件绑定（幂等） =================

        private void WireEvents()
        {
            if (_input != null) { _input.onValueChanged.RemoveAllListeners(); _input.onValueChanged.AddListener(OnInputChanged); }
            if (_btnConvert != null) { _btnConvert.onClick.RemoveAllListeners(); _btnConvert.onClick.AddListener(OnConvert); }
            if (_btnClear != null) { _btnClear.onClick.RemoveAllListeners(); _btnClear.onClick.AddListener(OnClear); }
            if (_btnWord != null) { _btnWord.onClick.RemoveAllListeners(); _btnWord.onClick.AddListener(OnExportDocx); }
            if (_btnPdf != null) { _btnPdf.onClick.RemoveAllListeners(); _btnPdf.onClick.AddListener(OnExportPdf); }
            if (_btnTxt != null) { _btnTxt.onClick.RemoveAllListeners(); _btnTxt.onClick.AddListener(OnExportTxt); }
            if (_btnCopy != null) { _btnCopy.onClick.RemoveAllListeners(); _btnCopy.onClick.AddListener(OnCopy); }
            if (_btnOpenDir != null) { _btnOpenDir.onClick.RemoveAllListeners(); _btnOpenDir.onClick.AddListener(OnOpenFolder); }
            if (_uvButton != null) { _uvButton.onClick.RemoveAllListeners(); _uvButton.onClick.AddListener(ToggleUV); }
            WireSegments(_toneSegs, OnToneChanged);
            WireSegments(_modeSegs, OnModeChanged);
        }

        private static void WireSegments(UiFactory.SegmentRef[] segs, Action<int> cb)
        {
            if (segs == null) return;
            for (int i = 0; i < segs.Length; i++)
            {
                if (segs[i] == null || segs[i].Btn == null) continue;
                int idx = i;
                segs[i].Btn.onClick.RemoveAllListeners();
                segs[i].Btn.onClick.AddListener(() => cb(idx));
            }
        }

        /// <summary>运行时统一修正字体（烘焙进场景的字体引用可能失效）。</summary>
        private void ApplyRuntimeFonts()
        {
            Canvas canvas = FindObjectOfType<Canvas>();
            if (canvas == null) return;
            foreach (Text t in canvas.GetComponentsInChildren<Text>(true))
            {
                if (t.fontSize > 0) t.font = UiFonts.Get(t.fontSize);
            }
        }

        // ================= 事件 =================

        private void OnInputChanged(string s)
        {
            if (_charCount != null) _charCount.text = s.Length + " 字";
        }

        private void OnToneChanged(int idx)
        {
            _tone = idx == 0 ? ToneStyle.Symbol : (idx == 1 ? ToneStyle.Number : ToneStyle.None);
            RefreshSegments(_toneSegs, idx);
            if (_result != null) RefreshOutput();
        }

        private void OnModeChanged(int idx)
        {
            _mode = (AnnotatedOutput.DisplayMode)idx;
            RefreshSegments(_modeSegs, idx);
            if (_result != null) RefreshOutput();
        }

        private void ToggleUV()
        {
            _uAsV = !_uAsV;
            _uAsvBg.color = _uAsV ? UiFactory.Primary : UiFactory.InputBg;
            _uAsvLabel.color = _uAsV ? Color.white : UiFactory.TextGray;
            if (_result != null) RefreshOutput();
        }

        private void OnConvert()
        {
            if (_engine == null) { Status("拼音库仍在加载，请稍候…"); return; }
            string text = _input.text;
            if (string.IsNullOrWhiteSpace(text)) { Status("请先输入中文内容。"); return; }
            try
            {
                _result = _engine.Convert(text);
                RefreshOutput();
                _charCount.text = _result.CjkCharCount + " 汉字 · " + _result.TotalCharCount + " 字";
                Status("转换完成：" + _result.CjkCharCount + " 个汉字。可点击下方按钮导出。");
            }
            catch (Exception e)
            {
                Status("转换出错：" + e.Message);
            }
        }

        private void OnClear()
        {
            _input.text = "";
            _result = null;
            _output.Clear();
            _charCount.text = "0 字";
            Status("已清空。");
            _input.ActivateInputField();
        }

        private void RefreshOutput()
        {
            if (_result != null) _output.Show(_result, _tone, _uAsV, _mode);
        }

        private void Status(string s)
        {
            if (_status != null) _status.text = s;
        }

        // ================= 导出 / 复制 =================

        /// <summary>复制转换结果到系统剪贴板。</summary>
        private void OnCopy()
        {
            if (!EnsureResult()) return;
            try
            {
                string body = PinyinEngine.RenderParenthesis(_result, _tone, _uAsV);
                GUIUtility.systemCopyBuffer = body;
                Status("已复制转换结果到剪贴板（" + body.Length + " 字符）。");
            }
            catch (Exception e) { Status("复制失败：" + e.Message); }
        }

        private void OnExportDocx()
        {
            if (!EnsureResult()) return;
            try
            {
                DocxOptions o = new DocxOptions { ToneStyle = _tone, UAsV = _uAsV, Timestamp = NowStr() };
                byte[] bytes = DocxBuilder.Build(_result, o);
                string path = SaveFile("拼音对照_" + Stamp() + ".docx", bytes);
                AfterExport("Word", path);
            }
            catch (Exception e) { Status("导出 Word 失败：" + e.Message); }
        }

        private void OnExportPdf()
        {
            if (!EnsureResult()) return;
            try
            {
                string fontPath = Path.Combine(Application.streamingAssetsPath, "NotoSansSC.ttf");
                if (!File.Exists(fontPath)) { Status("未找到内置字体：" + fontPath); return; }
                byte[] fontBytes = File.ReadAllBytes(fontPath);
                PdfOptions o = new PdfOptions { ToneStyle = _tone, UAsV = _uAsV, Timestamp = NowStr() };
                byte[] bytes = PdfBuilder.Build(_result, o, fontBytes);
                string path = SaveFile("拼音对照_" + Stamp() + ".pdf", bytes);
                AfterExport("PDF", path);
            }
            catch (Exception e) { Status("导出 PDF 失败：" + e.Message); }
        }

        private void OnExportTxt()
        {
            if (!EnsureResult()) return;
            try
            {
                string body = PinyinEngine.RenderParenthesis(_result, _tone, _uAsV);
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(body);
                string path = SaveFile("拼音对照_" + Stamp() + ".txt", bytes);
                AfterExport("文本", path);
            }
            catch (Exception e) { Status("导出文本失败：" + e.Message); }
        }

        /// <summary>导出完成：移动端自动跳转到可打开该文档的应用。</summary>
        private void AfterExport(string kind, string path)
        {
            _lastExportPath = path;
            if (NativeFileOpener.IsMobile)
            {
                bool ok = NativeFileOpener.OpenFile(path);
                Status(ok
                    ? "已导出 " + kind + "，正在用其它应用打开：\n" + Path.GetFileName(path)
                    : "已导出 " + kind + "：\n" + path + "\n（未找到可打开该格式的应用）");
            }
            else
            {
                Status("已导出 " + kind + "：\n" + path);
            }
        }

        private bool EnsureResult()
        {
            if (_result == null || _result.TotalCharCount == 0)
            {
                Status("请先输入中文并点击「转换」。");
                return false;
            }
            return true;
        }

        private string SaveFile(string filename, byte[] bytes)
        {
            string dir = EnsureExportDir();
            string path = Path.Combine(dir, filename);
            File.WriteAllBytes(path, bytes);
            return path;
        }

        private string EnsureExportDir()
        {
            if (_exportDir != null) return _exportDir;
            string dir = null;
            if (!NativeFileOpener.IsMobile)
            {
                try
                {
                    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                    if (!string.IsNullOrEmpty(desktop) && Directory.Exists(desktop))
                    {
                        dir = Path.Combine(desktop, "中文拼音助手导出");
                        Directory.CreateDirectory(dir);
                    }
                }
                catch { dir = null; }
            }
            if (dir == null)
            {
                // 移动端使用沙盒目录（Android 可被 FileProvider/Intent 读取，iOS 可被文档控制器读取）
                dir = Path.Combine(Application.persistentDataPath, "PinyinExport");
                Directory.CreateDirectory(dir);
            }
            _exportDir = dir;
            return dir;
        }

        private void OnOpenFolder()
        {
            if (NativeFileOpener.IsMobile)
            {
                // 移动端无“目录”概念：直接打开最近导出的文件
                if (!string.IsNullOrEmpty(_lastExportPath)) NativeFileOpener.OpenFile(_lastExportPath);
                return;
            }
            NativeFileOpener.OpenFolder(EnsureExportDir());
        }

        // ================= 工具 =================

        private static Font S(int size)
        {
            return UiFonts.Get(size);
        }

        private static string NowStr()
        {
            return DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        }

        private static string Stamp()
        {
            return DateTime.Now.ToString("yyyyMMdd_HHmmss");
        }
    }

    /// <summary>场景启动引导：无需手动搭建场景对象。</summary>
    public static class AppBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Init()
        {
            AppController.Bootstrap();
        }
    }
}
