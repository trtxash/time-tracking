# Patina Web Sync 使用说明

Patina Web Sync 是 Patina 的 Chromium MV3 浏览器扩展，用于将当前活动网页同步到本机 Patina。

## 使用前

- 安装并运行 Patina 桌面端。
- 在 Patina 设置中开启网页同步。
- 记下网页同步的端口和 Token，默认端口是 `12345`。

## 加载扩展

1. 解压扩展包，得到 `patina-chromium-extension-v0.1.0` 文件夹和这份使用说明。
2. 打开扩展管理页：
   - Chrome：`chrome://extensions`
   - Microsoft Edge：`edge://extensions`
3. 开启开发者模式。
4. 选择加载本地扩展的按钮：
   - Chrome：“加载未打包的扩展程序”
   - Microsoft Edge：“加载解压缩的扩展”
5. 选择解压后包含 `manifest.json` 的 `patina-chromium-extension-v0.1.0` 文件夹，不要选择上一级目录。

浏览器加载的是解压后的文件夹，不能直接选择 zip 文件。

## 配置和使用

1. 打开 Patina Web Sync 的选项页。
2. 填写 Patina 设置页中的端口和 Token。
3. 保存设置。
4. 打开一个普通网站页面。
5. 点击扩展弹窗中的“同步当前页”。

## 同步内容

扩展只同步当前活动网页的网址、标题和网站图标。

扩展不会读取网页正文、表单内容、截图、剪贴板或浏览历史库。
