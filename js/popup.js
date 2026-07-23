// Logic for the extension popup (index.html).

document.addEventListener("DOMContentLoaded", function () {
    var extName = chrome.i18n.getMessage("extName");
    document.title = extName;
    document.getElementById("app-title").textContent = extName;
    document.getElementById("label-speed").textContent = chrome.i18n.getMessage("speedLabel");
    document.getElementById("label-resolution").textContent = chrome.i18n.getMessage("resolutionLabel");
    document.getElementById("btsend").textContent = chrome.i18n.getMessage("saveButton");
    document.getElementById("footer-heart").textContent = chrome.i18n.getMessage("footerHeart");
    document.getElementById("footer-support-label").textContent = chrome.i18n.getMessage("footerSupportLabel");
    document.getElementById("footer-follow-label").textContent = chrome.i18n.getMessage("footerFollowLabel");
    document.getElementById("footer-credit-label").textContent = chrome.i18n.getMessage("footerCredit");

    var speedSelect = document.getElementById("rumble_speed");
    var resolutionSelect = document.getElementById("rumble_resolution");
    var savedMessage = document.getElementById("saved-message");
    var savedMessageTimeoutId = null;

    function resolutionOptionLabel(value) {
        switch (value) {
            case "auto": return chrome.i18n.getMessage("resolutionAuto");
            case "highest": return chrome.i18n.getMessage("resolutionHighest");
            case "lowest": return chrome.i18n.getMessage("resolutionLowest");
            default: return value + "p";
        }
    }

    rumbleGetSettings(function (settings) {
        RUMBLE_SPEED_OPTIONS.forEach(function (value) {
            var option = document.createElement("option");
            option.value = String(value);
            option.textContent = value + "x";
            if (value === settings.speed) option.selected = true;
            speedSelect.appendChild(option);
        });

        RUMBLE_RESOLUTION_OPTIONS.forEach(function (value) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = resolutionOptionLabel(value);
            if (value === settings.resolution) option.selected = true;
            resolutionSelect.appendChild(option);
        });
    });

    document.getElementById("btsend").addEventListener("click", function () {
        var settings = {
            speed: parseFloat(speedSelect.value),
            resolution: resolutionSelect.value
        };

        rumbleSaveSettings(settings, function () {
            savedMessage.textContent = chrome.i18n.getMessage("savedMessage");
            savedMessage.classList.add("visible");

            clearTimeout(savedMessageTimeoutId);
            savedMessageTimeoutId = setTimeout(function () {
                savedMessage.classList.remove("visible");
            }, 1800);
        });
    });

    var btcCopyButton = document.getElementById("btc-copy");
    var btcCopiedMessage = document.getElementById("btc-copied");
    var btcCopiedTimeoutId = null;

    if (btcCopyButton) {
        btcCopyButton.title = chrome.i18n.getMessage("btcCopyTitle");
        btcCopyButton.addEventListener("click", function () {
            var address = document.getElementById("btc-address").textContent.trim();

            navigator.clipboard.writeText(address).then(function () {
                btcCopiedMessage.textContent = chrome.i18n.getMessage("btcCopied");
                btcCopiedMessage.classList.add("visible");

                clearTimeout(btcCopiedTimeoutId);
                btcCopiedTimeoutId = setTimeout(function () {
                    btcCopiedMessage.classList.remove("visible");
                }, 1800);
            });
        });
    }
});
