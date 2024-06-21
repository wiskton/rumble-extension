$(document).ready(function () {

    $.each([0.80, 0.85, 0.90, 1, 1.25, 1.50, 1.75, 2, 2.25, 2.50, 2.75, 3], function (index, value) {
        chrome.storage.local.get(['key'], function (result) {
            $("#rumble_speed").append('<option value="' + value + '" ' + ((value == result.key) ? 'selected' : '') + ' >' + value + '</option>');
        });
    });
    

    $("#btsend").click(function () {
        const speed = $("#rumble_speed").val();

        chrome.storage.local.set({ key: speed }, function () {
        });

        chrome.storage.local.get(['key'], function (result) {
        });

        alert("Speedy saved");
    });

});