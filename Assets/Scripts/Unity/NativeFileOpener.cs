using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace PinyinApp.Unity
{
    /// <summary>
    /// 跨平台“用其它应用打开文件”。
    /// Android：ACTION_VIEW / 系统选择器；iOS：UIDocumentInteractionController（原生插件）；
    /// 桌面 / 编辑器：调用系统默认程序。
    /// </summary>
    public static class NativeFileOpener
    {
        /// <summary>是否为移动端（决定是否隐藏“打开目录”按钮）。</summary>
        public static bool IsMobile
        {
            get
            {
#if UNITY_ANDROID || UNITY_IOS
                return !Application.isEditor;
#else
                return false;
#endif
            }
        }

#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void _PinyinOpenDocument(string path);
#endif

        /// <summary>用系统关联应用打开文件；成功返回 true。</summary>
        public static bool OpenFile(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
            try
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                return OpenAndroid(path);
#elif UNITY_IOS && !UNITY_EDITOR
                _PinyinOpenDocument(path);
                return true;
#else
                OpenDesktop(path);
                return true;
#endif
            }
            catch (Exception e)
            {
                Debug.LogWarning("OpenFile 失败: " + e.Message);
                return false;
            }
        }

        /// <summary>打开文件所在目录（仅桌面 / 编辑器有意义）。</summary>
        public static void OpenFolder(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return;
            try
            {
#if UNITY_EDITOR || UNITY_STANDALONE
                OpenDesktop(dir);
#else
                Application.OpenURL("file://" + dir);
#endif
            }
            catch (Exception e) { Debug.LogWarning("OpenFolder 失败: " + e.Message); }
        }

#if UNITY_EDITOR || UNITY_STANDALONE
        private static void OpenDesktop(string path)
        {
            RuntimePlatform p = Application.platform;
            if (p == RuntimePlatform.OSXEditor || p == RuntimePlatform.OSXPlayer)
                System.Diagnostics.Process.Start("open", "\"" + path + "\"");
            else if (p == RuntimePlatform.WindowsEditor || p == RuntimePlatform.WindowsPlayer)
                System.Diagnostics.Process.Start("explorer.exe", "\"" + path.Replace('/', '\\') + "\"");
            else
                Application.OpenURL("file://" + path);
        }
#else
        private static void OpenDesktop(string path)
        {
            Application.OpenURL("file://" + path);
        }
#endif

#if UNITY_ANDROID && !UNITY_EDITOR
        private static bool OpenAndroid(string path)
        {
            using (AndroidJavaClass player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaObject file = new AndroidJavaObject("java.io.File", path))
            using (AndroidJavaClass provider = new AndroidJavaClass("com.pinyinapp.unity.PinyinFileProvider"))
            using (AndroidJavaObject uri = provider.CallStatic<AndroidJavaObject>("getUriForFile", activity, file))
            using (AndroidJavaObject intent = new AndroidJavaObject("android.content.Intent", "android.intent.action.VIEW"))
            using (AndroidJavaClass intentCls = new AndroidJavaClass("android.content.Intent"))
            using (AndroidJavaClass clipData = new AndroidJavaClass("android.content.ClipData"))
            {
                intent.Call<AndroidJavaObject>("setDataAndType", uri, MimeOf(path));
                intent.Call<AndroidJavaObject>("addFlags", 0x00000001);   // GRANT_READ_URI_PERMISSION
                intent.Call<AndroidJavaObject>("addFlags", 0x10000000);   // NEW_TASK
                using (AndroidJavaObject clip = clipData.CallStatic<AndroidJavaObject>("newRawUri", "导出的文档", uri))
                {
                    intent.Call("setClipData", clip);
                }
                using (AndroidJavaObject chooser = intentCls.CallStatic<AndroidJavaObject>("createChooser", intent, "打开文件"))
                {
                    chooser.Call<AndroidJavaObject>("addFlags", 0x00000001);
                    chooser.Call<AndroidJavaObject>("addFlags", 0x10000000);
                    activity.Call("startActivity", chooser);
                }
            }
            return true;
        }
#endif

        public static string MimeOf(string path)
        {
            string ext = Path.GetExtension(path ?? "").ToLowerInvariant();
            switch (ext)
            {
                case ".pdf": return "application/pdf";
                case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                case ".doc": return "application/msword";
                case ".txt": return "text/plain";
                default: return "*/*";
            }
        }
    }
}

