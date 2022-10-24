chrome.storage.local.get(['key'], function (result) {
});

jQuery("video").on('play', function () {
    chrome.storage.local.get(['key'], function (result) {
        const video = document.querySelector("video");
        video.playbackRate = result.key;
    });
});
