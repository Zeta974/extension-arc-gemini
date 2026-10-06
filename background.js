const STORE = chrome.storage.session || chrome.storage.local;
const ACTIVE_KEY = "activeSession";
const SETTINGS_KEY = "geminiScreenSettings";

async function getSession() {
  const data = await STORE.get(ACTIVE_KEY);
  return data[ACTIVE_KEY] || null;
}
async function setSession(session) { await STORE.set({ [ACTIVE_KEY]: session }); }
async function clearSession() { await STORE.remove(ACTIVE_KEY); }
function safeUrl(url) { return /^https?:\/\//i.test(url || ""); }
function isPdfUrl(url) {
  const value = String(url || "");
  return /\.pdf(?:[?#]|$)/i.test(value) || /^chrome-extension:\/\/[^/]+\/(?:index|viewer)\.html(?:[?#]|$)/i.test(value);
}
function newSession(tab, extra = {}) {
  return { sessionId: `${Date.now().toString(36)}-${crypto.randomUUID()}`, ownerTabId: tab.id, ownerWindowId: tab.windowId, createdAt: Date.now(), ...extra };
}

async function sendToTab(tabId, message, frameId = 0) {
  try { return await chrome.tabs.sendMessage(tabId, message, { frameId }); }
  catch (error) { return { ok: false, error: error?.message || "Impossible de contacter la page." }; }
}

async function ensureContent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || !safeUrl(tab.url)) return false;
  } catch (_) { return false; }
  const ping = await sendToTab(tabId, { type: "PING" });
  if (ping?.ok) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ["vendor/katex/katex.min.js", "content.js"] });
    return true;
  } catch (error) {
    console.warn("[Gemini Screen] injection failed", error);
    return false;
  }
}

async function waitForContent(tabId, attempts = 30, delayMs = 100) {
  for (let i = 0; i < attempts; i++) {
    const ping = await sendToTab(tabId, { type: "PING" });
    if (ping?.ok) return true;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function setActionPopupForTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.action.setPopup({
      tabId: tab.id,
      popup: isPdfUrl(tab.url) ? "pdf.html" : ""
    });
  } catch (error) {
    console.warn("[Gemini Screen] action popup update failed", error);
  }
}

async function openPdfUi(pdfTab, session) {
  // A popup window created with windows.create() is rendered as a full Arc page
  // in some Chromium-based browsers. Use the extension action popup instead: it
  // is anchored to the toolbar and remains a compact, browser-native popup.
  await chrome.action.setPopup({ tabId: pdfTab.id, popup: "pdf.html" });
  session.kind = "pdf";
  session.uiMode = "action-popup";
  session.uiWindowId = pdfTab.windowId;
  await setSession(session);
  try {
    await chrome.action.openPopup({ windowId: pdfTab.windowId });
  } catch (error) {
    console.warn("[Gemini Screen] action popup open failed", error);
    throw new Error("Arc n’a pas pu ouvrir le mini-popup Gemini pour ce PDF. Clique sur l’icône Gemini Screen dans la barre d’outils.");
  }
  return session;
}

function isPdfPopupSender(sender) {
  return sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL("pdf.html");
}

function senderAllowedForSession(sender, session) {
  if (sender?.tab?.id === session.ownerTabId || sender?.tab?.id === session.uiTabId) return true;
  return session.kind === "pdf" && isPdfPopupSender(sender);
}

async function warmInjectTab(tabId) { return ensureContent(tabId); }
async function warmInjectExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.allSettled(tabs.map(tab => tab.id ? warmInjectTab(tab.id) : false));
  } catch (error) {
    console.warn("[Gemini Screen] warm injection failed", error);
  }
}

let openQueue = Promise.resolve();
function serialized(task) {
  const next = openQueue.then(task);
  openQueue = next.catch(() => {});
  return next;
}

let lastKeyboardToggle = { tabId: null, at: 0 };
function duplicateKeyboardEvent(tabId) {
  const now = Date.now();
  const duplicate = lastKeyboardToggle.tabId === tabId && now - lastKeyboardToggle.at < 700;
  lastKeyboardToggle = { tabId, at: now };
  return duplicate;
}

async function activeTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  if (!win?.id) throw new Error("Fenêtre Arc introuvable.");
  const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tabs[0]?.id) throw new Error("Onglet Arc actif introuvable.");
  return tabs[0];
}

async function openForTab(tab, { toggleSameTab = true } = {}) {
  if (!tab?.id || !tab.windowId) throw new Error("Onglet Arc introuvable.");
  const current = await getSession();

  if (current?.ownerTabId === tab.id) {
    if (current.kind === "pdf") {
      if (!toggleSameTab) {
        await openPdfUi(tab, current);
        return current;
      }
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "PDF_POPUP_TOGGLE_CLOSE",
          sessionId: current.sessionId
        });
        if (reply?.ok && reply.closed) {
          await clearSession();
          return { ...current, closed: true };
        }
      } catch (_) {}
      await openPdfUi(tab, current);
      return current;
    }
    if (!(await ensureContent(tab.id))) throw new Error("Impossible d’activer l’extension sur cette page.");
    const reply = await sendToTab(tab.id, {
      type: toggleSameTab ? "TOGGLE_OVERLAY" : "SHOW_OVERLAY",
      sessionId: current.sessionId
    });
    if (!reply?.ok) throw new Error(reply?.error || "Impossible d’afficher le chat.");
    return current;
  }

  if (current) {
    const oldUiTabId = current.uiTabId || current.ownerTabId;
    if (oldUiTabId) await sendToTab(oldUiTabId, { type: "CLOSE_OVERLAY", sessionId: current.sessionId });
    // PDF UI is an action popup; it closes itself when focus leaves it.
    // There is no separate browser window to remove.

  }

  if (isPdfUrl(tab.url)) {
    const session = newSession(tab, { kind: "pdf" });
    await openPdfUi(tab, session);
    return session;
  }

  const session = newSession(tab, { kind: "web", uiTabId: tab.id, uiWindowId: tab.windowId });
  await setSession(session);
  const injected = await ensureContent(tab.id);
  if (!injected) {
    await clearSession();
    throw new Error("Arc ne permet pas l’injection sur cette page. Essaie une page web normale.");
  }
  const shown = await sendToTab(tab.id, { type: "SHOW_OVERLAY", sessionId: session.sessionId });
  if (!shown?.ok) {
    await clearSession();
    throw new Error(shown?.error || "Impossible d’ouvrir le chat.");
  }
  return session;
}

// Prewarm existing/current web tabs without any top-level await. This is important:
// the service worker must finish registering listeners even if prewarming fails.
chrome.runtime.onInstalled.addListener(() => {
  void clearSession().then(async () => {
    await warmInjectExistingTabs();
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.map(tab => setActionPopupForTab(tab)));
  });
});
chrome.runtime.onStartup.addListener(() => {
  void warmInjectExistingTabs();
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => setActionPopupForTab(tab))));
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(async tab => {
    await setActionPopupForTab(tab);
    if (!isPdfUrl(tab?.url)) await warmInjectTab(tabId);
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete" || typeof changeInfo.url === "string") {
    void setActionPopupForTab(tab);
  }
  if ((changeInfo.status === "loading" || changeInfo.status === "complete") && safeUrl(tab?.url) && !isPdfUrl(tab?.url)) {
    void warmInjectTab(tabId);
  }
});

chrome.action.onClicked.addListener(tab => {
  void serialized(async () => {
    try { await openForTab(tab); }
    catch (error) { console.error("[Gemini Screen] action click error", error); }
  });
});

chrome.commands.onCommand.addListener(command => {
  if (command !== "toggle-gemini") return;
  void serialized(async () => {
    try {
      const tab = await activeTab();
      if (duplicateKeyboardEvent(tab.id)) return;
      await openForTab(tab);
    } catch (error) { console.error("[Gemini Screen] command error", error); }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message?.type) return { ok: false, error: "Message invalide." };

    if (message.type === "OPEN_FOR_TAB") {
      const tab = sender?.tab?.id ? sender.tab : await activeTab();
      if (message.source === "page-keyboard" && duplicateKeyboardEvent(tab.id)) {
        return { ok: true, duplicate: true, session: await getSession() };
      }
      const session = await serialized(() => openForTab(tab));
      return { ok: true, session };
    }

    if (message.type === "PDF_POPUP_READY") {
      const tab = await activeTab();
      if (!isPdfUrl(tab?.url)) return { ok: false, error: "Le popup PDF n’est pas associé à un PDF actif." };
      let session = await getSession();
      if (!session || session.ownerTabId !== tab.id || session.kind !== "pdf") {
        session = newSession(tab, { kind: "pdf", uiMode: "action-popup", uiWindowId: tab.windowId });
        await setSession(session);
      }
      await chrome.action.setPopup({ tabId: tab.id, popup: "pdf.html" });
      return { ok: true, sessionId: session.sessionId };
    }

    if (message.type === "GET_OPTIONS") {
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      return { ok: true, settings: data[SETTINGS_KEY] || { apiKey: "", model: "gemini-3.5-flash-lite" } };
    }
    if (message.type === "OPEN_SETTINGS_PAGE") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
      return { ok: true };
    }
    if (message.type === "CAPTURE_TAB") {
      const session = await getSession();
      if (!session || session.sessionId !== message.sessionId) return { ok: false, error: "Session expirée. Appuie à nouveau sur Ctrl+Y." };
      try {
        const tab = await chrome.tabs.get(session.ownerTabId);
        if (!tab?.id) throw new Error("Onglet fermé.");
        const dataUrl = await chrome.tabs.captureVisibleTab(session.ownerWindowId, { format: "jpeg", quality: 78 });
        return { ok: true, dataUrl };
      } catch (error) {
        console.error("[Gemini Screen] capture error", error);
        return { ok: false, error: "La capture de cet onglet n’est pas disponible." };
      }
    }
    if (message.type === "TRANSCRIBE_AUDIO") {
      const session = await getSession();
      if (!session || session.sessionId !== message.sessionId || !senderAllowedForSession(sender, session)) return { ok: false, error: "Session expirée." };
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = data[SETTINGS_KEY] || {};
      if (!settings.apiKey) return { ok: false, error: "Clé API Gemini absente. Ouvre ⚙ pour la renseigner." };
      try {
        return { ok: true, text: await transcribeAudio({ apiKey: settings.apiKey, base64Audio: message.base64Audio, mimeType: message.mimeType }) };
      } catch (error) {
        console.error("[Gemini Screen] transcription error", error);
        return { ok: false, error: error?.message || "Transcription vocale impossible." };
      }
    }
    if (message.type === "STREAM_GEMINI") {
      const session = await getSession();
      if (!session || session.sessionId !== message.sessionId || !senderAllowedForSession(sender, session)) return { ok: false, error: "Session expirée." };
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = data[SETTINGS_KEY] || {};
      const apiKey = settings.apiKey || "";
      const model = message.model || settings.model || "gemini-3.5-flash-lite";
      if (!apiKey) return { ok: false, error: "Clé API Gemini absente. Ouvre les paramètres de l’extension." };
      const requestId = message.requestId || crypto.randomUUID();
      const uiTabId = session.uiTabId || session.ownerTabId;
      const popupTarget = session.kind === "pdf" && session.uiMode === "action-popup";
      streamGemini({ tabId: uiTabId, requestId, apiKey, model, contents: message.contents, popupTarget }).catch(async error => {
        const payload = { type: "GEMINI_STREAM_ERROR", requestId, error: error?.message || "Erreur Gemini inconnue." };
        if (popupTarget) { try { await chrome.runtime.sendMessage(payload); } catch (_) {} }
        else await sendToTab(uiTabId, payload);
      });
      return { ok: true, requestId };
    }
    if (message.type === "CLOSE_SESSION") {
      const session = await getSession();
      if (session?.sessionId === message.sessionId) await clearSession();
      return { ok: true };
    }
    return { ok: false, error: "Commande inconnue." };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || "Erreur inconnue." }));
  return true;
});

async function transcribeAudio({ apiKey, base64Audio, mimeType }) {
  if (!base64Audio || typeof base64Audio !== "string") throw new Error("Format audio invalide.");
  const normalizedMime = String(mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
  const allowed = new Set(["audio/wav","audio/mp3","audio/aiff","audio/aac","audio/ogg","audio/flac","audio/mpeg","audio/m4a","audio/l16","audio/opus","audio/alaw","audio/mulaw","audio/webm"]);
  if (!allowed.has(normalizedMime)) throw new Error(`Format audio non pris en charge (${normalizedMime || "inconnu"}).`);
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [
        { text: "Transcris exactement la parole dans cet audio. Réponds uniquement avec le texte prononcé, sans commentaire, sans guillemets et sans reformulation. Conserve le français et les termes techniques." },
        { inline_data: { mime_type: normalizedMime, data: base64Audio } }
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512 }
    })
  });
  if (!response.ok) { let message = "La transcription Gemini a échoué."; try { message = (await response.json())?.error?.message || message; } catch (_) {} throw new Error(message); }
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini n’a renvoyé aucune transcription.");
  return text;
}

async function streamGemini({ tabId, requestId, apiKey, model, contents, popupTarget = false }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: "Tu es l’assistant visuel rapide d’une extension Arc. Réponds en français sauf si l’utilisateur utilise principalement une autre langue. Va droit au but. Analyse les images jointes au dernier message. Les anciennes captures ne sont pas renvoyées automatiquement : ne prétends pas revoir leurs pixels si elles ne sont pas jointes. L’historique texte du chat courant est conservé pour le contexte. N’invente jamais ce qui n’est pas lisible ou déductible de l’image. Pour les maths, utilise LaTeX : $...$ en ligne, $$...$$ en bloc." }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    })
  });
  if (!response.ok) { let message = "Erreur Gemini."; try { message = (await response.json())?.error?.message || message; } catch (_) {} throw new Error(message); }
  if (!response.body) throw new Error("Gemini n’a pas renvoyé de flux de réponse.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let fullText = "";
  const emit = (type, payload) => {
    const message = { type, requestId, ...payload };
    return popupTarget ? chrome.runtime.sendMessage(message).catch(() => undefined) : sendToTab(tabId, message);
  };
  const parseBlock = block => { for (const line of block.split("\n")) { if (!line.startsWith("data:")) continue; const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue; try { const json = JSON.parse(raw); const chunk = json?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || ""; if (chunk) { fullText += chunk; void emit("GEMINI_STREAM_CHUNK", { text: fullText }); } } catch (_) {} } };
  while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done }); const blocks = buffer.split(/\n\n/); buffer = blocks.pop() || ""; blocks.forEach(parseBlock); if (done) break; }
  if (buffer.trim()) parseBlock(buffer);
  await emit("GEMINI_STREAM_DONE", { text: fullText.trim() });
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const session = await getSession();
  if (!session) return;
  if (session.ownerTabId === tabId) {
    await clearSession();
    return;
  }
  if (session.uiTabId === tabId) await clearSession();
});
