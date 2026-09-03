using System.Collections.Generic;
using UnityEngine;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 中文字体缓存：优先匹配系统字体（苹方/黑体等），兜底 Unity 内置字体。
    /// 所有 UI 文本统一走这里，保证运行时字体正确。
    /// </summary>
    public static class UiFonts
    {
        private static readonly Dictionary<int, Font> Cache = new Dictionary<int, Font>();

        public static Font Get(int size)
        {
            Font f;
            if (!Cache.TryGetValue(size, out f))
            {
                f = CreateCjkFont(size);
                Cache[size] = f;
            }
            return f;
        }

        private static Font CreateCjkFont(int size)
        {
            string[] preferred =
            {
                "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
                "Heiti SC", "STHeiti", "SimHei", "SimSun", "Arial Unicode MS"
            };
            try
            {
                string[] installed = Font.GetOSInstalledFontNames();
                var set = new HashSet<string>(installed, System.StringComparer.OrdinalIgnoreCase);
                foreach (string p in preferred)
                {
                    if (set.Contains(p))
                        return Font.CreateDynamicFontFromOSFont(p, size);
                }
            }
            catch { }
            return Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }
    }
}
