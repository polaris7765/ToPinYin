using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

/// <summary>
/// 编辑器工具：重建主场景骨架（Camera + EventSystem + Canvas 1080x1920 + App）。
/// App 的 UI 在运行时构建到该 Canvas 下（AppController.BuildUi 复用场景 Canvas）。
/// 菜单 Tools/中文拼音助手/重建主场景，或命令行 -executeMethod SceneCreator.Create。
/// </summary>
public static class SceneCreator
{
    [MenuItem("Tools/中文拼音助手/重建主场景")]
    public static void Create()
    {
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // 1. 主相机（纯色背景，与 App 背景一致）
        GameObject camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        Camera cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = PinyinApp.Unity.UiFactory.Bg;
        cam.orthographic = true;
        camGo.AddComponent<AudioListener>();

        // 2. 事件系统（输入必需）
        GameObject esGo = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));

        // 3. Canvas（1080x1920 竖屏，App 运行时把 UI 构建到其下）
        GameObject canvasGo = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        Canvas canvas = canvasGo.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 100;
        CanvasScaler scaler = canvasGo.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1080f, 1920f);
        scaler.matchWidthOrHeight = 0.5f;

        // 4. App 控制器
        GameObject app = new GameObject("App");
        app.AddComponent<PinyinApp.Unity.AppController>();

        if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
            AssetDatabase.CreateFolder("Assets", "Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
        EditorBuildSettings.scenes = new[]
        {
            new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true)
        };
        Debug.Log("[中文拼音助手] 主场景骨架已重建：Main Camera / EventSystem / Canvas(1080x1920) / App");
    }
}
