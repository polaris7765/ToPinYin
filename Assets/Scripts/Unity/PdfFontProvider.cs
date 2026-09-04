using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace PinyinApp.Unity
{
    /// <summary>
    /// PDF 导出所需的中文字体加载器。
    /// Android 上 StreamingAssets 位于 APK 内（jar:file://...），无法用 File API 读取，
    /// 必须走 UnityWebRequest；iOS / 桌面 / 编辑器直接读文件。
    /// 加载结果会缓存，供 PdfBuilder 复用。
    /// </summary>
    public static class PdfFontProvider
    {
        public const string FontFileName = "NotoSansSC.ttf";

        /// <summary>加载状态。</summary>
        public enum State { NotLoaded, Loading, Ready, Failed }

        public static State Status { get; private set; }
        public static byte[] FontBytes { get; private set; }
        public static string LastError { get; private set; }

        /// <summary>当前平台是否可能支持导出 PDF（失败后为 false，用于隐藏按钮）。</summary>
        public static bool MaybeSupported { get { return Status != State.Failed; } }

        /// <summary>是否已就绪，可立即导出。</summary>
        public static bool IsReady { get { return Status == State.Ready && FontBytes != null && FontBytes.Length > 0; } }

        /// <summary>加载字体（幂等）。完成后回调，参数表示是否成功。</summary>
        public static IEnumerator Load(Action<bool> onDone)
        {
            if (Status == State.Ready) { if (onDone != null) onDone(true); yield break; }
            if (Status == State.Loading)
            {
                while (Status == State.Loading) yield return null;
                if (onDone != null) onDone(Status == State.Ready);
                yield break;
            }

            Status = State.Loading;
            LastError = null;
            string path = Path.Combine(Application.streamingAssetsPath, FontFileName);

            // Android 的 StreamingAssets 打包在 APK 内（jar:file://...!/assets），
            // 只能通过 UnityWebRequest 读取；其它平台先尝试直接读文件。
            bool needWebRequest = Application.platform == RuntimePlatform.Android
                                  || path.Contains("://") || path.Contains(":///");

            if (!needWebRequest)
            {
                try
                {
                    if (File.Exists(path))
                    {
                        FontBytes = File.ReadAllBytes(path);
                        Status = FontBytes.Length > 0 ? State.Ready : State.Failed;
                        if (Status == State.Failed) LastError = "字体文件为空";
                    }
                    else
                    {
                        needWebRequest = true;      // 回退到 UnityWebRequest（file:// 亦可）
                    }
                }
                catch (Exception e)
                {
                    LastError = e.Message;
                    needWebRequest = true;
                }
            }

            if (needWebRequest)
            {
                string url = (path.Contains("://") || path.Contains(":///")) ? path : "file://" + path;
                using (UnityWebRequest req = UnityWebRequest.Get(url))
                {
                    yield return req.SendWebRequest();
#if UNITY_2020_1_OR_NEWER
                    bool ok = req.result == UnityWebRequest.Result.Success;
#else
                    bool ok = !req.isNetworkError && !req.isHttpError;
#endif
                    if (ok && req.downloadHandler != null && req.downloadHandler.data != null && req.downloadHandler.data.Length > 0)
                    {
                        FontBytes = req.downloadHandler.data;
                        Status = State.Ready;
                        LastError = null;
                    }
                    else
                    {
                        LastError = string.IsNullOrEmpty(req.error) ? ("未读取到字体：" + url) : (req.error + " @ " + url);
                        Status = State.Failed;
                    }
                }
            }

            if (Status == State.Failed) Debug.LogWarning("PDF 字体加载失败：" + LastError);
            if (onDone != null) onDone(Status == State.Ready);
        }
    }
}

