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
        PinyinApp.Unity.AppController controller = app.AddComponent<PinyinApp.Unity.AppController>();

        // 5. 在编辑器里直接生成全部 UI（运行时不再重建）
        //    程序化生成的精灵需要落盘成资源，否则无法随场景序列化。
        PinyinApp.Unity.UiFactory.SpritePostProcess = PersistSprite;
        try
        {
            controller.BuildUiInEditor();
        }
        finally
        {
            PinyinApp.Unity.UiFactory.SpritePostProcess = null;
        }
        EditorUtility.SetDirty(controller);
        EditorSceneManager.MarkSceneDirty(scene);

        if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
            AssetDatabase.CreateFolder("Assets", "Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
        EditorBuildSettings.scenes = new[]
        {
            new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true)
        };
        Debug.Log("[中文拼音助手] 主场景已重建，并在编辑器中生成了全部 UI（运行时不再重建）。");
    }

    private const string SpriteFolder = "Assets/Generated/UiSprites";

    /// <summary>把运行时生成的圆角精灵保存为工程资源，保证场景能序列化引用。</summary>
    private static Sprite PersistSprite(Sprite sprite, string key)
    {
        if (sprite == null) return null;
        EnsureFolder(SpriteFolder);
        string path = SpriteFolder + "/" + key + ".asset";

        Sprite existing = LoadSprite(path);
        if (existing != null) return existing;

        Texture2D tex = sprite.texture;
        tex.name = key + "_tex";
        sprite.name = key;
        AssetDatabase.CreateAsset(tex, path);
        AssetDatabase.AddObjectToAsset(sprite, tex);
        AssetDatabase.SaveAssets();
        AssetDatabase.ImportAsset(path);
        return LoadSprite(path) ?? sprite;
    }

    private static Sprite LoadSprite(string path)
    {
        Object[] all = AssetDatabase.LoadAllAssetsAtPath(path);
        if (all == null) return null;
        foreach (Object o in all)
        {
            Sprite s = o as Sprite;
            if (s != null) return s;
        }
        return null;
    }

    private static void EnsureFolder(string folder)
    {
        if (AssetDatabase.IsValidFolder(folder)) return;
        string[] parts = folder.Split('/');
        string cur = parts[0];                       // "Assets"
        for (int i = 1; i < parts.Length; i++)
        {
            string next = cur + "/" + parts[i];
            if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(cur, parts[i]);
            cur = next;
        }
    }
}
