# Patina Web Sync User Guide

Patina Web Sync is the Chromium MV3 browser extension for syncing the active webpage to the local Patina desktop app.

## Before You Start

- Install and run the Patina desktop app.
- Enable Web Sync in Patina Settings.
- Note the Web Sync port and Token. The default port is `12345`.

## Load The Extension

1. Extract the extension package. It creates a `patina-chromium-extension-v0.1.0` folder and these user guides.
2. Open the browser extension page:
   - Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Enable Developer mode.
4. Choose the local extension loading button:
   - Chrome: Load unpacked
   - Microsoft Edge: Load unpacked
5. Select the extracted `patina-chromium-extension-v0.1.0` folder that contains `manifest.json`. Do not select the parent folder.

The browser cannot load the zip file directly through Load unpacked. It loads the extracted folder.

## Configure And Use

1. Open the Patina Web Sync options page.
2. Fill in the port and Token from Patina Settings.
3. Save the settings.
4. Open a regular website page.
5. Click Sync current page in the extension popup.

## Synced Content

The extension syncs only the active webpage's website address, page title, and website icon.

The extension does not read page body content, form values, screenshots, clipboard data, or the browser history database.
