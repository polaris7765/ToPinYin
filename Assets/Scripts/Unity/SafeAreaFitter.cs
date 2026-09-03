using UnityEngine;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 安全区适配：把自身 RectTransform 收缩到 Screen.safeArea（刘海屏 / 灵动岛 / 手势条）。
    /// 屏幕方向或分辨率变化时自动重算。
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    public class SafeAreaFitter : MonoBehaviour
    {
        private RectTransform _rt;
        private Rect _last;
        private ScreenOrientation _lastOrientation;
        private Vector2Int _lastRes;

        private void Awake()
        {
            _rt = GetComponent<RectTransform>();
            Apply();
        }

        private void Update()
        {
            if (Screen.safeArea != _last
                || Screen.orientation != _lastOrientation
                || _lastRes.x != Screen.width || _lastRes.y != Screen.height)
            {
                Apply();
            }
        }

        public void Apply()
        {
            if (_rt == null) _rt = GetComponent<RectTransform>();
            Rect safe = Screen.safeArea;
            _last = safe;
            _lastOrientation = Screen.orientation;
            _lastRes = new Vector2Int(Screen.width, Screen.height);

            float w = Mathf.Max(1, Screen.width);
            float h = Mathf.Max(1, Screen.height);
            Vector2 min = new Vector2(safe.xMin / w, safe.yMin / h);
            Vector2 max = new Vector2(safe.xMax / w, safe.yMax / h);
            if (float.IsNaN(min.x) || float.IsNaN(max.x)) return;

            _rt.anchorMin = min;
            _rt.anchorMax = max;
            _rt.offsetMin = Vector2.zero;
            _rt.offsetMax = Vector2.zero;
            _rt.pivot = new Vector2(0.5f, 0.5f);
        }

        /// <summary>安全区在“参考分辨率”坐标系下的尺寸（参考宽度固定为 refWidth）。</summary>
        public static Vector2 SafeSizeInReference(float refWidth)
        {
            float sw = Mathf.Max(1, Screen.width);
            float sh = Mathf.Max(1, Screen.height);
            float f = refWidth / sw;                 // 屏幕像素 → 参考单位
            Rect safe = Screen.safeArea;
            float w = safe.width * f;
            float h = safe.height * f;
            if (w < 1f || h < 1f) { w = refWidth; h = refWidth * sh / sw; }
            return new Vector2(w, h);
        }
    }
}

