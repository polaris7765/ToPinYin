using System;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

/// <summary>命令行一键构建 macOS 应用。</summary>
public static class BuildScript
{
    public static void BuildMac()
    {
        PlayerSettings.productName = "中文拼音助手";
        PlayerSettings.companyName = "PinyinApp";
        PlayerSettings.defaultScreenWidth = 540;   // 竖屏窗口：UI 按 1080x1920 设计，0.5 倍显示
        PlayerSettings.defaultScreenHeight = 960;
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.runInBackground = true;

        BuildPlayerOptions opts = new BuildPlayerOptions();
        opts.scenes = new[] { "Assets/Scenes/Main.unity" };
        opts.target = BuildTarget.StandaloneOSX;
        opts.locationPathName = "Builds/中文拼音助手.app";
        opts.options = BuildOptions.None;

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != BuildResult.Succeeded)
        {
            throw new Exception("Build failed: " + report.summary.result);
        }
        Debug.Log("BUILD_OK size=" + report.summary.totalSize + " path=" + opts.locationPathName);
    }
}
