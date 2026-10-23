// Logic for the extension popup (index.html).

document.addEventListener("DOMContentLoaded", function () {
    var extName = chrome.i18n.getMessage("extName");
    document.title = extName;
    document.getElementById("app-title").textContent = extName;
    document.getElementById("label-playback-feature").textContent = chrome.i18n.getMessage("playbackFeatureLabel");
    document.getElementById("label-speed").textContent = chrome.i18n.getMessage("speedLabel");
    document.getElementById("label-volume").textContent = chrome.i18n.getMessage("volumeLabel");
    document.getElementById("label-resolution").textContent = chrome.i18n.getMessage("resolutionLabel");
    document.getElementById("label-player-mode").textContent = chrome.i18n.getMessage("playerModeLabel");
    document.getElementById("btsend").textContent = chrome.i18n.getMessage("saveButton");
    document.getElementById("footer-heart").textContent = chrome.i18n.getMessage("footerHeart");
    document.getElementById("footer-support-label").textContent = chrome.i18n.getMessage("footerSupportLabel");
    document.getElementById("footer-follow-label").textContent = chrome.i18n.getMessage("footerFollowLabel");
    document.getElementById("footer-credit-label").textContent = chrome.i18n.getMessage("footerCredit");

    var playbackEnabledToggle = document.getElementById("rumble_playback_enabled");
    var speedSlider = document.getElementById("rumble_speed");
    var speedValueInput = document.getElementById("rumble_speed_value");
    var volumeSlider = document.getElementById("rumble_volume");
    var volumeValueInput = document.getElementById("rumble_volume_value");
    var resolutionSelect = document.getElementById("rumble_resolution");
    var playerModeSelect = document.getElementById("rumble_player_mode");
    var savedMessage = document.getElementById("saved-message");
    var savedMessageTimeoutId = null;

    playbackEnabledToggle.setAttribute("aria-label", chrome.i18n.getMessage("playbackFeatureLabel"));

    function resolutionOptionLabel(value) {
        switch (value) {
            case "auto": return chrome.i18n.getMessage("resolutionAuto");
            case "highest": return chrome.i18n.getMessage("resolutionHighest");
            case "lowest": return chrome.i18n.getMessage("resolutionLowest");
            default: return value + "p";
        }
    }

    function playerModeOptionLabel(value) {
        switch (value) {
            case "standard": return chrome.i18n.getMessage("playerModeStandard");
            case "theater": return chrome.i18n.getMessage("playerModeTheater");
            case "fullscreen": return chrome.i18n.getMessage("playerModeFullscreen");
            default: return value;
        }
    }

    // Keeps a range input and its numeric readout in sync in both
    // directions (dragging the slider updates the number, typing in the
    // number moves the slider), shared by the speed and volume controls.
    function bindSliderPair(slider, numberInput, min, max) {
        slider.addEventListener("input", function () {
            numberInput.value = slider.value;
        });
        numberInput.addEventListener("input", function () {
            var value = parseFloat(numberInput.value);
            if (!isNaN(value)) {
                slider.value = Math.min(max, Math.max(min, value));
            }
        });
    }

    function setPairValue(slider, numberInput, value, fallback, min, max) {
        var num = Number(value);
        if (isNaN(num)) num = fallback;
        num = Math.min(max, Math.max(min, num));
        slider.value = num;
        numberInput.value = num;
    }

    function parsePairValue(numberInput, fallback, min, max) {
        var num = parseFloat(numberInput.value);
        if (isNaN(num)) num = fallback;
        return Math.min(max, Math.max(min, num));
    }

    function updatePlaybackDisabledState() {
        var enabled = playbackEnabledToggle.checked;
        [speedSlider, speedValueInput, volumeSlider, volumeValueInput].forEach(function (el) {
            el.disabled = !enabled;
        });
        document.querySelectorAll(".playback-control").forEach(function (el) {
            el.classList.toggle("is-disabled", !enabled);
        });
    }

    playbackEnabledToggle.addEventListener("change", updatePlaybackDisabledState);
    bindSliderPair(speedSlider, speedValueInput, 0, 10);
    bindSliderPair(volumeSlider, volumeValueInput, 0, 300);

    rumbleGetSettings(function (settings) {
        playbackEnabledToggle.checked = settings.playbackEnabled !== false;
        setPairValue(speedSlider, speedValueInput, settings.speed, 1, 0, 10);
        setPairValue(volumeSlider, volumeValueInput, settings.volume, 100, 0, 300);
        updatePlaybackDisabledState();

        RUMBLE_RESOLUTION_OPTIONS.forEach(function (value) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = resolutionOptionLabel(value);
            if (value === settings.resolution) option.selected = true;
            resolutionSelect.appendChild(option);
        });

        RUMBLE_PLAYER_MODE_OPTIONS.forEach(function (value) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = playerModeOptionLabel(value);
            if (value === settings.playerMode) option.selected = true;
            playerModeSelect.appendChild(option);
        });
    });

    document.getElementById("btsend").addEventListener("click", function () {
        var settings = {
            speed: parsePairValue(speedValueInput, 1, 0, 10),
            volume: parsePairValue(volumeValueInput, 100, 0, 300),
            playbackEnabled: playbackEnabledToggle.checked,
            resolution: resolutionSelect.value,
            playerMode: playerModeSelect.value
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
