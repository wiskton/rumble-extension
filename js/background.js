// chrome.downloads and the toolbar badge are only reachable from extension
// pages/background, not from the content script injected into rumble.com,
// so inject.js relays download requests here, and the current speed is
// also mirrored onto the toolbar icon from here.

if (typeof importScripts === "function") {
    // Chrome's MV3 service worker doesn't get common.js for free the way
    // Firefox's MV2 background page does (see manifest-firefox.json's
    // "background.scripts" list) - it has to be imported explicitly here.
    importScripts("common.js");
}

// chrome.action (MV3) vs. chrome.browserAction (MV2/Firefox).
var rumbleToolbarAction = chrome.action || chrome.browserAction;

function updateSpeedBadge(settings) {
    if (!rumbleToolbarAction || !rumbleToolbarAction.setBadgeText) return;

    var enabled = settings && settings.playbackEnabled !== false;
    if (!enabled) {
        // Kept as literal "OFF" rather than a translated string - toolbar
        // badges have very little room, and some locales' equivalent word
        // wouldn't fit.
        rumbleToolbarAction.setBadgeText({ text: "OFF" });
        if (rumbleToolbarAction.setBadgeBackgroundColor) {
            rumbleToolbarAction.setBadgeBackgroundColor({ color: "#6b7280" });
        }
        return;
    }

    var speed = Number(settings.speed);
    rumbleToolbarAction.setBadgeText({ text: speed ? speed + "x" : "" });
    if (rumbleToolbarAction.setBadgeBackgroundColor) {
        rumbleToolbarAction.setBadgeBackgroundColor({ color: "#22c55e" });
    }
}

rumbleGetSettings(updateSpeedBadge);

if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        rumbleGetSettings(updateSpeedBadge);
    });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "rumbleDownloadVideo") return;

    chrome.downloads.download(
        { url: message.url, filename: message.filename, saveAs: false },
        function (downloadId) {
            var error = chrome.runtime.lastError;
            if (error || !downloadId) {
                sendResponse({ ok: false, error: error ? error.message : "unknown_error" });
            } else {
                sendResponse({ ok: true, downloadId: downloadId });
            }
        }
    );

    return true; // keep the message channel open for the async sendResponse
});
