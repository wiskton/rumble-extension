$(document).ready(function () {

    $.each([1, 1.25, 1.50, 1.75, 2, 2.25, 2.50, 2.75, 3], function (index, value) {
        chrome.storage.local.get(['key'], function (result) {
            $("#rumble_speed").append('<option value="' + value + '" ' + ((value == result.key) ? 'selected' : '') + ' >' + value + '</option>');
        });
    });
    
    // $.each(["1080p", "720p", "480p", "320p", "240p", "144p"], function (index, value) {
    //     chrome.storage.local.get(['resolution'], function (result) {
    //         $("#rumble_resolution").append('<option value="' + value + '" ' + ((value == result.resolution) ? 'selected' : '') + ' >' + value + '</option>');
    //     });
    // });

    $("#btsend").click(function () {
        const speed = $("#rumble_speed").val();
        //const resolution = $("#rumble_resolution").val();

        chrome.storage.local.set({ key: speed }, function () {
        });

        chrome.storage.local.get(['key'], function (result) {
        });

        // chrome.storage.local.set({ resolution: resolution }, function () {
        // });

        // chrome.storage.local.get(['resolution'], function (result) {
        // });

        alert("Speedy saved");
    });

});