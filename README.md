# Gemini Screen

A small Gemini vision chat for Arc and Chromium browsers. It can analyze the visible screen with screenshots, keep text context during the current chat, stream Gemini responses, and transcribe short voice dictation.

**Current version: 1.7.1**

## Features

- Floating Gemini panel on normal webpages
- **One keyboard shortcut only on Windows: `Ctrl + Y`**
- Toolbar-button access
- Automatic screenshot when a chat opens
- Multiple captures, pending/sent states, and capture reuse
- Text chat history for the current conversation
- Gemini streaming responses
- Markdown/code rendering
- Voice dictation with automatic silence detection
- Local settings for the Gemini API key and model
- PDF support by capturing the currently visible PDF page
- Single active Gemini session at a time

## Requirements

- Arc, Chrome, or another Chromium-based browser supporting Manifest V3
- Windows for the documented keyboard shortcut
- A Gemini API key

> **Security:** never commit your Gemini API key to GitHub. The extension stores the key in the browser extension's local storage.

## 1. Get a Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Open the API key section and choose **Create API key**.
4. Select or create the Google Cloud project requested by AI Studio.
5. Copy the generated API key.

Google's current documentation: [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key).

### Keep the key private

Never place the key in `manifest.json`, JavaScript source files, screenshots, Git commits, or GitHub issues. If you accidentally publish it, revoke/replace the exposed key.

## 2. Install the extension on Windows / Arc

1. Download or clone this repository.
2. Extract it if you downloaded a ZIP.
3. Open Arc's extensions page (`arc://extensions`) or the equivalent Chromium extensions page.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the folder that contains `manifest.json`.
7. Pin **Gemini Screen** to the toolbar if you want quick access.

### Updating the extension

1. Replace the old project files with the new files.
2. Return to the extensions page.
3. Click **Reload** for Gemini Screen.
4. After a manifest/shortcut change, fully remove the old unpacked copy and load the new folder again if the browser still shows the old shortcut.

## 3. Configure Gemini Screen

1. Click the Gemini Screen toolbar icon.
2. Open **Settings** with the gear button.
3. Paste your Gemini API key.
4. Leave the default model or enter another currently supported Gemini model.
5. Click **Save**.

The API key is stored with Chrome extension storage on the local browser profile.

## 4. Use the extension

### Normal webpages

Press **Ctrl + Y**. The floating Gemini panel appears on the left side of the page. Press the same shortcut again to toggle the panel. The toolbar icon provides the same open/toggle behavior.

There is exactly **one shortcut: Ctrl + Y**. The extension also listens for Ctrl + Y directly on regular web pages because Arc for Windows can fail to dispatch extension commands in some configurations. The browser command remains registered for pages where content scripts cannot run, such as browser-controlled PDF viewers.

### Screenshots

A screenshot of the visible page is captured when the conversation opens. You can capture more screens from **↻ Refaire**. Captures stay in the current extension session; only captures marked for the next message are attached to that Gemini request.

### Voice dictation

Click the microphone button and speak. Recording stops automatically after a period of silence after speech, or at the maximum recording duration. Gemini transcribes the audio and the extension sends the resulting text as a normal message.

### PDFs

Chromium's built-in PDF viewer is a browser-controlled page and does not allow the normal webpage overlay to be injected into it. Gemini Screen therefore uses a dedicated **compact extension popup** for PDF chats while keeping the PDF itself as the capture source.

Use **Ctrl + Y** or click the Gemini Screen toolbar icon while the PDF is open. The popup uses the same Gemini interface and captures the **currently visible PDF page**. Scroll to the page you want to analyze, then use **↻ Refaire** when you need a fresh capture.

The PDF is not converted into extracted text by this extension; Gemini receives the visible screenshot(s) that you attach.

## 5. GitHub deployment

The repository can be uploaded directly to GitHub. Keep the extension source files at the repository root so `manifest.json` is immediately visible.

Expected structure:

```text
Gemini-Screen/
├── manifest.json
├── background.js
├── content.js
├── pdf.html
├── settings.html
├── settings.js
├── README.md
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Upload with Git

```bash
git init
git add .
git commit -m "Gemini Screen 1.7.1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Replace `YOUR_USERNAME/YOUR_REPOSITORY` with your repository path.

GitHub is source hosting; it does not automatically install an unpacked extension in Arc. Clone/download the repository and use **Load unpacked** as described above.

## Keyboard shortcut

| Action | Windows |
|---|---|
| Open / close Gemini Screen | **Ctrl + Y** |

There is exactly **one extension command** in the manifest. Chromium can still report the shortcut as unavailable if another extension or browser feature owns it. In that case, change the assigned key from the browser's extension shortcut settings; do not add another command to the manifest.

## Settings

The settings page contains:

- Gemini API key
- Gemini model

The extension's default model is defined in the source and can be replaced in Settings. Model availability depends on the Gemini API.

## Architecture

- `manifest.json` — Manifest V3 configuration and the single `Ctrl+Y` command
- `background.js` — session management, webpage injection, PDF routing, screenshot capture, Gemini API calls, and streaming
- `content.js` — floating webpage UI, PDF popup UI, screenshots, chat history, and voice input
- `pdf.html` — compact extension action popup used while a PDF is active
- `settings.html` / `settings.js` — local Gemini configuration
- `icons/` — extension icons

## Privacy and data flow

When used, the extension can send the following to Google's Gemini API:

- Chat messages
- Screenshots attached to messages
- Audio recordings used for voice transcription

Previous screenshots are not automatically resent with later requests. The text chat history is kept for context, while images are attached only when selected for the current request.

Do not use the extension with information you are not permitted to send to the Gemini API. Review Google's current API terms and privacy documentation before production use.

## Troubleshooting

### Ctrl + Y does not work

1. Open the browser's extension shortcut settings.
2. Under **Open / close Gemini Screen**, assign **Ctrl + Y**.
3. Leave **Activate the extension** empty.
4. Reload Gemini Screen after changing the shortcut.

On regular HTTP/HTTPS pages, the extension also detects Ctrl + Y directly in the page, so it does not depend entirely on Arc's extension-command handling. Browser-controlled pages such as PDF viewers cannot receive the page-level listener.
4. Reload the extension.
5. If you changed the manifest from an older version, remove the old unpacked copy and load the new folder again.

### A normal webpage does not show the overlay

Some browser-controlled/restricted pages do not permit content-script injection. The toolbar button can be used as an alternative on supported pages. PDFs have separate handling described above.

### PDF analysis shows the wrong page

The extension analyzes the visible portion of the PDF. Scroll the PDF to the desired page and press **↻ Refaire** before sending the question.

### Gemini does not answer

Check the API key in Settings, confirm that the selected model is currently available, and inspect the extension's service-worker console for the Gemini API error.

## License

Add the license you choose before publishing the repository.

## Documentation

- [Gemini API documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini API key documentation](https://ai.google.dev/gemini-api/docs/api-key)
- [Chrome Extensions documentation](https://developer.chrome.com/docs/extensions/)
