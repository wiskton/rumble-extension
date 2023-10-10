chrome.storage.local.get(['key'], function (result) {
    $(".video-footer-buttons").append('<span class="rumbles-count">Velocity ' + result.key + '</span>');
});

// chrome.storage.local.get(['resolution'], function (result) {
//     $(".resolution-footer-buttons").append('<span class="rumbles-count">Resolution ' + result.key + '</span>');
// });

jQuery("video").on('play', function () {

    // chrome.storage.local.get(['resolution'], function (result) {
    //     const video = document.querySelector("video");
        
    //     video.on('resolutionchange', function(event, data){
    //         var video_id = data.id;
    //         var resolution = result.key;
    //     });
    // });
    
    chrome.storage.local.get(['key'], function (result) {
        const video = document.querySelector("video");
        video.playbackRate = result.key;        
    });

});