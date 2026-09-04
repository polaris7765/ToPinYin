using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 挂在多行 <see cref="InputField"/>（作为 ScrollRect 的 Content）上，
    /// 负责把竖向拖拽 / 滚轮转发给外层 ScrollRect，并在输入时把光标滚动到可见区域。
    /// 高度由 ContentSizeFitter(Vertical = PreferredSize) 自动撑开。
    /// </summary>
    public class InputFieldScroller : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler, IScrollHandler
    {
        [SerializeField] private InputField _field;
        [SerializeField] private ScrollRect _scroll;
        private RectTransform _viewport;
        private RectTransform _content;
        [SerializeField] private Text _text;
        private LayoutElement _layout;

        private int _lastCaret = -1;
        private bool _dragScrolling;
        private float _lastMin = -1f;
        private float _lastPreferred = -1f;

        /// <summary>文本相对 Content 的上下内边距（与 UiFactory 中的 Stretch 保持一致）。</summary>
        private const float TextPaddingY = 12f;

        public void Setup(InputField field, ScrollRect scroll, Text text)
        {
            _field = field;
            _scroll = scroll;
            _text = text;
            _content = (RectTransform)transform;
            _viewport = scroll != null ? scroll.viewport : null;
            _layout = GetComponent<LayoutElement>();
            if (_layout == null) _layout = gameObject.AddComponent<LayoutElement>();
            _layout.preferredHeight = -1f;      // 首帧由 LateUpdate 依据文本高度设置
        }

        /// <summary>场景中已烘焙好引用时（编辑器构建 UI），运行时补齐非序列化字段。</summary>
        private void Awake()
        {
            _content = (RectTransform)transform;
            if (_viewport == null && _scroll != null) _viewport = _scroll.viewport;
            if (_layout == null)
            {
                _layout = GetComponent<LayoutElement>();
                if (_layout == null) _layout = gameObject.AddComponent<LayoutElement>();
            }
        }

        private void LateUpdate()
        {
            if (_field == null || _content == null || _text == null || _viewport == null) return;

            // 只约束最小高度（不小于视口）
            float minH = _viewport.rect.height;
            bool dirty = false;
            if (!Mathf.Approximately(minH, _lastMin))
            {
                _lastMin = minH;
                _layout.minHeight = minH;
                dirty = true;
            }

            // InputField 自身不提供 preferredHeight，必须按文本实际高度撑开 Content，
            // 否则内容永远等于视口高度，滚动条不会出现（移动端尤其明显）。
            float textH = _text.preferredHeight + TextPaddingY;
            float want = Mathf.Max(minH, textH);
            if (!Mathf.Approximately(want, _lastPreferred))
            {
                _lastPreferred = want;
                _layout.preferredHeight = want;
                dirty = true;
            }
            if (dirty) LayoutRebuilder.MarkLayoutForRebuild(_content);

            // 滚动条：内容超出视口时才显示
            if (_scroll != null && _scroll.verticalScrollbar != null)
            {
                bool need = _content.rect.height > minH + 1f;
                GameObject sbGo = _scroll.verticalScrollbar.gameObject;
                if (sbGo.activeSelf != need) sbGo.SetActive(need);
            }

            if (!_field.isFocused) return;
            if (_field.caretPosition == _lastCaret) return;
            _lastCaret = _field.caretPosition;
            ScrollCaretIntoView();
        }

        /// <summary>把光标所在行滚动到可见区域内。</summary>
        private void ScrollCaretIntoView()
        {
            float viewH = _viewport.rect.height;
            float contentH = _content.rect.height;
            if (contentH <= viewH + 0.5f) return;

            TextGenerator gen = _text.cachedTextGenerator;
            if (gen == null || gen.lineCount == 0) return;

            float scale = 1f;
            Canvas canvas = _text.canvas;
            if (canvas != null && canvas.scaleFactor > 0f) scale = canvas.scaleFactor;

            int caret = Mathf.Clamp(_field.caretPosition, 0, _text.text.Length);
            int line = gen.lineCount - 1;
            for (int i = 0; i < gen.lineCount; i++)
            {
                int start = gen.lines[i].startCharIdx;
                int end = i + 1 < gen.lineCount ? gen.lines[i + 1].startCharIdx : _text.text.Length + 1;
                if (caret >= start && caret < end) { line = i; break; }
            }

            float lineH = gen.lines[line].height / scale;
            float top = -gen.lines[line].topY / scale;     // 距 Content 顶部的距离
            float bottom = top + lineH;

            float offset = _content.anchoredPosition.y;    // 已滚动量（>=0 表示内容上移）
            if (top < offset) offset = top;
            else if (bottom > offset + viewH) offset = bottom - viewH;

            offset = Mathf.Clamp(offset, 0f, contentH - viewH);
            _content.anchoredPosition = new Vector2(_content.anchoredPosition.x, offset);
        }

        // ---------- 拖拽 / 滚轮转发到 ScrollRect ----------

        public void OnBeginDrag(PointerEventData e)
        {
            _dragScrolling = _scroll != null && Mathf.Abs(e.delta.y) >= Mathf.Abs(e.delta.x);
            if (_dragScrolling) _scroll.OnBeginDrag(e);
        }

        public void OnDrag(PointerEventData e)
        {
            if (_dragScrolling) _scroll.OnDrag(e);
        }

        public void OnEndDrag(PointerEventData e)
        {
            if (_dragScrolling) _scroll.OnEndDrag(e);
            _dragScrolling = false;
        }

        public void OnScroll(PointerEventData e)
        {
            if (_scroll != null) _scroll.OnScroll(e);
        }
    }
}
