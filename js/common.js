// Shared constants and helpers used by both the popup (popup.js) and the
// content script injected into Rumble pages (inject.js).

var RUMBLE_STORAGE_KEY = "rumbleSettings";
var RUMBLE_LEGACY_STORAGE_KEY = "key"; // used by versions <= 0.2.4 (speed only)

var RUMBLE_DEFAULT_SETTINGS = {
    speed: 1,
    resolution: "auto"
};

var RUMBLE_SPEED_OPTIONS = [0.5, 0.75, 0.8, 0.85, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

// "auto"/"highest"/"lowest" are relative to whatever qualities Rumble
// actually offers for a given video; the numeric entries are common target
// heights that get matched to the closest quality the player exposes.
var RUMBLE_RESOLUTION_OPTIONS = ["auto", "highest", "1080", "720", "480", "360", "240", "lowest"];

// Wraps chrome.storage.local.get and migrates the legacy single-value
// "key" entry (just a speed number) to the new settings object.
function rumbleGetSettings(callback) {
    chrome.storage.local.get([RUMBLE_STORAGE_KEY, RUMBLE_LEGACY_STORAGE_KEY], function (result) {
        var settings = {};
        for (var prop in RUMBLE_DEFAULT_SETTINGS) {
            settings[prop] = RUMBLE_DEFAULT_SETTINGS[prop];
        }

        if (result && result[RUMBLE_STORAGE_KEY]) {
            for (var key in result[RUMBLE_STORAGE_KEY]) {
                settings[key] = result[RUMBLE_STORAGE_KEY][key];
            }
        } else if (result && result[RUMBLE_LEGACY_STORAGE_KEY] !== undefined) {
            var legacySpeed = parseFloat(result[RUMBLE_LEGACY_STORAGE_KEY]);
            if (!isNaN(legacySpeed) && legacySpeed > 0) {
                settings.speed = legacySpeed;
            }
        }

        callback(settings);
    });
}

function rumbleSaveSettings(settings, callback) {
    var toSave = {};
    toSave[RUMBLE_STORAGE_KEY] = settings;
    chrome.storage.local.set(toSave, function () {
        chrome.storage.local.remove(RUMBLE_LEGACY_STORAGE_KEY, function () {
            if (callback) callback();
        });
    });
}

function rumbleDebounce(fn, waitMs) {
    var timeoutId = null;
    return function () {
        var args = arguments;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(function () {
            fn.apply(null, args);
        }, waitMs);
    };
}
