using System.Collections;
using System.IO;
using System.Reflection;
using PinyinApp.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// 批量截图自测：进入播放模式，等待拼音库加载，填入示例文本并触发转换，
/// 截取 Game 视图三种状态（初始 UI / 逐字标注 / 行内对照），随后退出。
/// 注意：必须在命令行使用 -executeMethod UiScreenshot.Run 且【不加 -quit】，
/// 由脚本在完成后调用 EditorApplication.Exit(0)。
/// </summary>
public static class UiScreenshot
{
    private static double _startTime;
    private const double MaxSeconds = 150.0;

    public static void Run()
    {
        _startTime = EditorApplication.timeSinceStartup;
        EditorApplication.update += Watchdog;
        EditorApplication.playModeStateChanged += OnPlayStateChanged;
        EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
        EditorApplication.isPlaying = true;
    }

    private static void Watchdog()
    {
        if (EditorApplication.timeSinceStartup - _startTime > MaxSeconds)
        {
            Debug.LogError("SHOT_TIMEOUT");
            EditorApplication.update -= Watchdog;
            EditorApplication.Exit(1);
        }
    }

    private static void OnPlayStateChanged(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.EnteredPlayMode)
        {
            new GameObject("ShotRunner").AddComponent<ShotRunner>();
        }
        else if (state == PlayModeStateChange.EnteredEditMode)
        {
            EditorApplication.update -= Watchdog;
            EditorApplication.playModeStateChanged -= OnPlayStateChanged;
            Debug.Log("SHOT_DONE");
            EditorApplication.Exit(0);
        }
    }

    private class ShotRunner : MonoBehaviour
    {
        private IEnumerator Start()
        {
            string outDir = Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Tools", "Test");
            Directory.CreateDirectory(outDir);
            yield return null;
            yield return null;

            // 等待拼音库加载完成（最多 8 秒）
            float wait = 0f;
            AppController app = null;
            while (wait < 8f)
            {
                app = FindObjectOfType<AppController>();
                if (app != null && IsReady(app)) break;
                wait += 0.2f;
                yield return new WaitForSeconds(0.2f);
            }
            yield return new WaitForSeconds(0.5f);

            // 状态 1：初始 UI
            ScreenCapture.CaptureScreenshot(Path.Combine(outDir, "ui_1_initial.png"), 2);
            yield return null;

            // 填入示例并转换
            if (app != null)
            {
                FieldInfo fi = typeof(AppController).GetField("_input", BindingFlags.NonPublic | BindingFlags.Instance);
                InputField input = (InputField)fi.GetValue(app);
                if (input != null)
                {
                    input.text = "你好，世界！这是中文拼音转换应用。\n银行 长大 音乐 重要 快乐 行走。";
                }
                MethodInfo mi = typeof(AppController).GetMethod("OnConvert", BindingFlags.NonPublic | BindingFlags.Instance);
                mi.Invoke(app, null);
            }

            yield return new WaitForSeconds(0.8f);

            // 状态 2：逐字标注结果
            ScreenCapture.CaptureScreenshot(Path.Combine(outDir, "ui_2_annotated.png"), 2);
            yield return new WaitForSeconds(0.2f);

            // 切换为行内对照并截屏
            if (app != null)
            {
                MethodInfo mi = typeof(AppController).GetMethod("OnModeChanged", BindingFlags.NonPublic | BindingFlags.Instance);
                mi.Invoke(app, new object[] { 1 });
            }
            yield return new WaitForSeconds(0.5f);
            ScreenCapture.CaptureScreenshot(Path.Combine(outDir, "ui_3_inline.png"), 2);
            yield return new WaitForSeconds(0.2f);

            EditorApplication.isPlaying = false;
        }

        private static bool IsReady(AppController app)
        {
            FieldInfo fi = typeof(AppController).GetField("_btnConvert", BindingFlags.NonPublic | BindingFlags.Instance);
            Button b = (Button)fi.GetValue(app);
            return b != null && b.interactable;
        }
    }
}
