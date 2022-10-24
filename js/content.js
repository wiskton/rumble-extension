$(document).ready(function () {

    $("#btsend").click(function () {
        const speed = $("#rumble_speed").val();

        chrome.storage.local.set({ key: speed }, function () {
        });

        chrome.storage.local.get(['key'], function (result) {
        });
    });

});