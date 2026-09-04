using UnityEngine;
using UnityEngine.UI;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 段选辅助：记录每个段的 Text 与 Image 供高亮刷新，Btn 供重新绑定点击。
    /// （独立文件 + 顶层类型，保证可随场景序列化。）
    /// </summary>
    public class SegmentRef : MonoBehaviour
    {
        public Text Label;
        public Image Bg;
        public Button Btn;

        public void SetActive(bool active)
        {
            if (Bg != null) Bg.color = active ? UiFactory.Primary : Color.white;
            if (Label != null) Label.color = active ? Color.white : UiFactory.TextGray;
        }
    }
}

