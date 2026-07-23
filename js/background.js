// chrome.downloads is only reachable from extension pages/background, not
// from the content script injected into rumble.com, so inject.js relays
// download requests here.

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
