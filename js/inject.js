// Content script injected into rumble.com pages.
// Applies the saved playback speed and (best effort) video resolution,
// and keeps the small "speed" badge under the player up to date.
//
// Rumble is a single-page app: navigating between videos does not reload
// this script, so everything here is written to keep working across
// client-side navigation (MutationObserver + delegated events) instead of
// running once at page load like the original version did.

(function () {
    "use strict";

    var currentSettings = RUMBLE_DEFAULT_SETTINGS;

    function formatBadgeText(settings) {
        return chrome.i18n.getMessage("badgePrefix") + ": " + settings.speed + "x";
    }

    function insertOrUpdateBadge() {
        var container = document.querySelector(".video-footer-buttons");
        if (!container) return;

        var badge = container.querySelector(".rumbles-count");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "rumbles-count";
            container.appendChild(badge);
        }
        badge.textContent = formatBadgeText(currentSettings);
    }

    function applySpeed(video) {
        if (!video) return;
        var speed = Number(currentSettings.speed);
        video.playbackRate = (!speed || isNaN(speed) || speed <= 0) ? 1 : speed;
    }

    // --- Driving Rumble's own settings menu --------------------------------
    // The extension always sets video.playbackRate directly first (fast and
    // reliable). On top of that, it also clicks the matching row in Rumble's
    // own Speed/Quality menu, so the player's own UI (checkmark, current
    // value shown) stays in sync, and so the resolution actually changes
    // (that one Rumble does not expose through the <video> element at all,
    // it has to be done through its menu).
    //
    // Inspecting Rumble's actual player showed every Speed/Quality row
    // always exists in the DOM (plain unstyled <li> elements with no class
    // or id at all) - opening the menu only toggles inline `display` styles
    // on them, it doesn't create/destroy anything. Dispatched (synthetic)
    // click events reach an element's listeners regardless of whether it is
    // currently visible, so the rows can be clicked directly by matching
    // their text - there is no need to ever find or open the settings/gear
    // button itself. Everything here fails silently if it can't find a
    // matching row - the direct playbackRate assignment above still
    // guarantees the speed itself always works either way.

    // Toggle this to see step-by-step logs of the native-menu automation in
    // the page's DevTools console (prefixed "[Rumble Accelerator]") - useful
    // for figuring out exactly where it fails on Rumble's actual markup.
    var DEBUG = false;

    function debugLog() {
        if (!DEBUG) return;
        var args = ["[Rumble Accelerator]"].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
    }

    // Rumble's controls may only listen for pointer/mouse-down style events
    // rather than a plain "click", so a full press-and-release sequence is
    // dispatched instead of relying on el.click() alone.
    function simulateClick(el) {
        if (!el) return;
        var rect = el.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };

        ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
            var evt;
            try {
                evt = type.indexOf("pointer") === 0 ? new PointerEvent(type, base) : new MouseEvent(type, base);
            } catch (e) {
                evt = new MouseEvent(type, base);
            }
            el.dispatchEvent(evt);
        });
    }

    // Rumble prefixes the currently selected row with a checkmark icon
    // rendered as its own <span>/<svg> (no text), so no visible-text
    // stripping is actually needed, but trimming is kept defensively.
    function normalizeMenuText(raw) {
        return (raw || "").trim();
    }

    function extractMenuCandidates(pattern) {
        var scope = document.getElementById("videoPlayer") || document;
        var nodes = scope.querySelectorAll("li");
        var results = [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var text = normalizeMenuText(el.textContent);
            if (el.children.length <= 3 && pattern.test(text)) {
                results.push({ el: el, text: text });
            }
        }
        return results;
    }

    var SPEED_ITEM_PATTERN = /^(normal|\d+(?:[.,]\d+)?\s*[x×])$/i;

    // Rumble's quality menu lists rows like "auto", "1280x720, 2.1 mbps" or
    // "640x360, 220 kbps" - not "720p" as one might expect, so entries are
    // matched by that WIDTHxHEIGHT, BITRATE UNIT shape (confirmed by
    // inspecting the actual menu) instead of a "###p" pattern.
    var QUALITY_ITEM_PATTERN = /^(auto|automátic[oa]|\d+\s*[x×]\s*\d+\s*,\s*[\d.,]+\s*[km]bps)$/i;
    var QUALITY_RESOLUTION_PATTERN = /^\d+\s*[x×]\s*(\d+)\s*,\s*([\d.,]+)\s*([km]bps)$/i;

    function parseSpeedText(text) {
        if (/^normal$/i.test(text)) return 1;
        return parseFloat(text.replace(",", ".").replace(/[x×]/gi, ""));
    }

    function parseQualityCandidate(text) {
        if (/^(auto|automátic[oa])$/i.test(text)) {
            return { isAuto: true, height: -1, bitrateKbps: 0 };
        }
        var match = text.match(QUALITY_RESOLUTION_PATTERN);
        if (!match) return null;
        var height = parseInt(match[1], 10);
        var rate = parseFloat(match[2].replace(",", "."));
        var bitrateKbps = /^k/i.test(match[3]) ? rate : rate * 1000;
        return { isAuto: false, height: height, bitrateKbps: bitrateKbps };
    }

    function pickClosestSpeedElement(candidates, preference) {
        if (!candidates.length) return null;
        var target = Number(preference);
        if (isNaN(target)) return null;

        var best = candidates[0];
        var bestDiff = Math.abs(parseSpeedText(best.text) - target);
        for (var i = 1; i < candidates.length; i++) {
            var diff = Math.abs(parseSpeedText(candidates[i].text) - target);
            if (diff < bestDiff) {
                best = candidates[i];
                bestDiff = diff;
            }
        }
        return bestDiff < 0.5 ? best.el : null;
    }

    function pickTargetQualityElement(candidates, preference) {
        var parsed = [];
        for (var i = 0; i < candidates.length; i++) {
            var info = parseQualityCandidate(candidates[i].text);
            if (info) {
                info.el = candidates[i].el;
                parsed.push(info);
            }
        }
        if (!parsed.length) return null;

        if (preference === "auto") {
            for (var a = 0; a < parsed.length; a++) {
                if (parsed[a].isAuto) return parsed[a].el;
            }
            return null;
        }

        var withHeights = parsed.filter(function (p) { return !p.isAuto; });
        if (!withHeights.length) return null;

        // Same resolution can appear more than once at different bitrates
        // (e.g. two 640x360 rows) - prefer the higher bitrate for a given height.
        withHeights.sort(function (x, y) {
            if (y.height !== x.height) return y.height - x.height;
            return y.bitrateKbps - x.bitrateKbps;
        });

        if (preference === "highest") return withHeights[0].el;
        if (preference === "lowest") return withHeights[withHeights.length - 1].el;

        var target = parseInt(preference, 10);
        if (isNaN(target)) return null;

        var best = withHeights[0];
        var bestDiff = Math.abs(best.height - target);
        for (var j = 1; j < withHeights.length; j++) {
            var diff = Math.abs(withHeights[j].height - target);
            if (diff < bestDiff) {
                best = withHeights[j];
                bestDiff = diff;
            }
        }
        return best.el;
    }

    var MENU_KIND_CONFIG = {
        speed: {
            pattern: SPEED_ITEM_PATTERN,
            pick: pickClosestSpeedElement
        },
        quality: {
            pattern: QUALITY_ITEM_PATTERN,
            pick: pickTargetQualityElement
        }
    };

    function applyViaNativeMenu(kind, preference, attempt, done) {
        attempt = attempt || 0;
        var config = MENU_KIND_CONFIG[kind];
        if (!config || attempt > 6) {
            debugLog(kind, "gave up after", attempt, "attempts");
            done();
            return;
        }

        var candidates = extractMenuCandidates(config.pattern);
        if (!candidates.length) {
            debugLog(kind, "no menu rows found yet (attempt " + attempt + "), retrying...");
            setTimeout(function () { applyViaNativeMenu(kind, preference, attempt + 1, done); }, 500);
            return;
        }

        debugLog(kind, "candidates:", candidates.map(function (c) { return c.text; }));
        var target = config.pick(candidates, preference);
        debugLog(kind, "target picked for preference '" + preference + "':", target ? target.textContent.trim() : "NONE");
        if (target) simulateClick(target);
        done();
    }

    var menuTaskQueue = [];
    var processingMenuTask = false;

    function processNextMenuTask() {
        if (processingMenuTask || !menuTaskQueue.length) return;
        processingMenuTask = true;
        var task = menuTaskQueue.shift();
        applyViaNativeMenu(task.kind, task.preference, 0, function () {
            processingMenuTask = false;
            processNextMenuTask();
        });
    }

    function queueMenuTask(kind, preference) {
        menuTaskQueue.push({ kind: kind, preference: preference });
        processNextMenuTask();
    }

    function settingsSignature(settings) {
        return settings.speed + "|" + settings.resolution;
    }

    function handleVideoReady(video) {
        applySpeed(video);
        insertOrUpdateBadge();

        var srcKey = video.currentSrc || video.src || "";
        var signature = srcKey + "::" + settingsSignature(currentSettings);
        if (video.dataset.rumbleSyncedFor !== signature) {
            video.dataset.rumbleSyncedFor = signature;
            debugLog("queuing sync for settings", currentSettings);
            queueMenuTask("speed", currentSettings.speed);
            if (currentSettings.resolution !== "auto") {
                queueMenuTask("quality", currentSettings.resolution);
            }
        }
    }

    // --- Wiring --------------------------------------------------------

    // 'play' does not bubble, but it does fire during the capture phase, so
    // a single listener on document catches it for any video Rumble adds
    // later on, instead of binding only to the video present at load time.
    document.addEventListener("play", function (event) {
        if (event.target && event.target.tagName === "VIDEO") {
            handleVideoReady(event.target);
        }
    }, true);

    document.addEventListener("loadedmetadata", function (event) {
        if (event.target && event.target.tagName === "VIDEO") {
            applySpeed(event.target);
        }
    }, true);

    var syncWithPage = rumbleDebounce(function () {
        insertOrUpdateBadge();
        var video = document.querySelector("video");
        if (video && !video.paused) {
            handleVideoReady(video);
        }
    }, 400);

    var pageObserver = new MutationObserver(syncWithPage);
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });

    if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== "local") return;
            rumbleGetSettings(function (settings) {
                currentSettings = settings;
                var video = document.querySelector("video");
                if (video) handleVideoReady(video);
                insertOrUpdateBadge();
            });
        });
    }

    rumbleGetSettings(function (settings) {
        currentSettings = settings;
        insertOrUpdateBadge();
        var video = document.querySelector("video");
        if (video) applySpeed(video);
    });
})();
