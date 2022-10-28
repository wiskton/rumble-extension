chrome.storage.local.get(['key'], function (result) {
    $(".video-footer-buttons").append('<span class="rumbles-count">Velocity ' + result.key + '</span>');
});

jQuery("video").on('play', function () {
    chrome.storage.local.get(['key'], function (result) {
        const video = document.querySelector("video");
        video.playbackRate = result.key;
    });
});