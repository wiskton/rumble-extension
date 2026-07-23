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

    // --- Download button -------------------------------------------------
    // Rumble has no "download" action of its own. Rather than guessing at
    // markup, this button is built using the exact classes Rumble itself
    // uses for its action-row buttons (".round-button.media-by-actions-button",
    // taken from inspecting the real "Comentários" button), so it matches
    // the site's current look without any custom CSS here. It's inserted
    // right after the channel's Follow button (".js-media-subscribe" - a
    // functional JS-hook class, which tends to be far more stable across
    // redesigns than styling class names).
    //
    // content scripts have no access to chrome.downloads directly, so the
    // actual download is requested from the background script.

    var FOLLOW_BUTTON_SELECTOR = ".js-media-subscribe";
    // Shorts uses a completely different component (a vertical action rail
    // of <span class="rum-shorts__screen__action">, each wrapping a custom
    // <rum-icon name="...">) instead of the watch page's Follow/action-row
    // buttons. The rum-icon's "name" attribute is what actually identifies
    // which action a given item is - "data-vote" looked promising at first
    // but turned out to be shared by both Like and Dislike (both read
    // data-vote="false" until the viewer actually votes), which duplicated
    // the download button. "shorts__comments" is unique to Comments.
    var SHORTS_COMMENTS_ICON_SELECTOR = 'rum-icon[name="shorts__comments"]';
    var SHORTS_ACTION_CLASS = "rum-shorts__screen__action";
    var DOWNLOAD_BUTTON_CLASS = "rumble-ext-download-btn";

    // On a normal watch page there is exactly one Follow button and one
    // <video> on the whole page. On the Shorts feed, though, many cards
    // (each with their own action rail and <video>) are mounted at once,
    // so every download button needs to be tied to *its own* card's video,
    // not just "whatever <video> is on the page". downloadButtonAnchors
    // maps each inserted button to the original page element it was
    // anchored next to (Follow button / Like action); findCardScope then
    // walks up from that anchor to the nearest ancestor containing a
    // <video> - the smallest card-like wrapper around it. The scope is
    // resolved fresh every time (not cached) because Shorts cards can
    // mount their <video> lazily, after the button itself was inserted.
    var downloadButtonAnchors = new WeakMap();

    function findCardScope(anchorEl) {
        var el = anchorEl.parentElement;
        for (var i = 0; i < 20 && el; i++) {
            if (el.querySelector("video")) return el;
            el = el.parentElement;
        }
        return document;
    }

    function resolveDownloadScope(button) {
        var anchor = downloadButtonAnchors.get(button);
        return anchor ? findCardScope(anchor) : document;
    }

    function buildDownloadButton() {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "round-button media-by-actions-button " + DOWNLOAD_BUTTON_CLASS;

        var label = chrome.i18n.getMessage("downloadButton") || "Download";
        button.title = label;

        var svgNS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        var path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", "M8 2V10M8 10L11 7M8 10L5 7M3 13H13");
        svg.appendChild(path);

        button.appendChild(svg);
        button.appendChild(document.createTextNode(label));
        button.addEventListener("click", handleDownloadClick, true);
        return button;
    }

    // Icon-only counterpart for the Shorts action rail - a <button> would
    // not match that rail's layout, so this mirrors the shape of a
    // ".rum-shorts__screen__action" item (span + inline SVG) instead. Size
    // and centering are set explicitly since the original relies on a
    // build-hashed class for that, which can't be reused here. A square
    // 24x24 viewBox (matching the explicit width/height) keeps the icon
    // from being stretched, unlike the mismatched 16x17 one used earlier.
    function buildShortsDownloadAction() {
        var action = document.createElement("span");
        action.className = "rum-shorts__screen__action " + DOWNLOAD_BUTTON_CLASS;
        action.setAttribute("role", "button");
        action.tabIndex = 0;
        action.style.cursor = "pointer";
        action.style.display = "flex";
        action.style.alignItems = "center";
        action.style.justifyContent = "center";
        action.style.width = "36px";
        action.style.height = "36px";
        action.style.borderRadius = "50%";
        action.style.background = "#22c55e"; // same accent green used in the popup UI
        action.style.color = "#fff";
        action.style.margin = "4px 0";
        action.title = chrome.i18n.getMessage("downloadButton") || "Download";

        var svgNS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.style.color = "currentColor";
        var path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", "M12 3V15M12 15L8 11M12 15L16 11M4 21H20");
        svg.appendChild(path);
        action.appendChild(svg);

        action.addEventListener("click", handleDownloadClick, true);
        return action;
    }

    // Single source of truth for "is there an actual file behind this
    // <video> to download": live streams report an Infinity (or, before
    // metadata loads, NaN) duration, and both live streams and archived
    // replays of a live are served as blob: (MediaSource/HLS), which
    // points at a MediaSource object rather than a real file. A regular
    // VOD has a finite duration and a plain, direct currentSrc.
    function isDownloadableVideo(video) {
        if (!video || !isFinite(video.duration)) return false;
        var src = video.currentSrc || video.src || "";
        return src !== "" && src.indexOf("blob:") !== 0;
    }

    function currentVideoDownloadUrl(scope) {
        var video = (scope || document).querySelector("video");
        return isDownloadableVideo(video) ? (video.currentSrc || video.src) : "";
    }

    // Hidden entirely (not just disabled) whenever there's nothing
    // downloadable, so it never shows up on lives or live replays -
    // checked per-button, against that button's own card scope.
    function updateAllDownloadButtonsState() {
        var buttons = document.querySelectorAll("." + DOWNLOAD_BUTTON_CLASS);
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var scope = resolveDownloadScope(button);
            var downloadable = isDownloadableVideo(scope.querySelector("video"));
            button.style.display = downloadable ? "" : "none";
            button.disabled = !downloadable;
        }
    }

    function sanitizeFilename(name) {
        var cleaned = (name || "").replace(/\s*-\s*Rumble\s*$/i, "").trim();
        cleaned = cleaned.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150);
        return cleaned || "rumble-video";
    }

    function guessExtension(url) {
        var match = /\.([a-z0-9]{2,4})(?:\?|#|$)/i.exec(url || "");
        return match ? match[1] : "mp4";
    }

    function handleDownloadClick(event) {
        event.preventDefault();
        event.stopPropagation();

        var button = event.currentTarget;
        if (button.disabled || button.dataset.rumbleDownloading === "1") return;

        var scope = resolveDownloadScope(button);
        var url = currentVideoDownloadUrl(scope);
        if (!url) {
            debugLog("download: no direct video URL available");
            window.alert(chrome.i18n.getMessage("downloadUnavailable"));
            return;
        }

        var filename = sanitizeFilename(document.title) + "." + guessExtension(url);
        button.dataset.rumbleDownloading = "1";
        button.style.opacity = "0.6";

        chrome.runtime.sendMessage({ type: "rumbleDownloadVideo", url: url, filename: filename }, function (response) {
            button.dataset.rumbleDownloading = "0";
            button.style.opacity = "";
            if (chrome.runtime.lastError || !response || !response.ok) {
                debugLog("download failed", chrome.runtime.lastError, response);
                window.alert(chrome.i18n.getMessage("downloadFailed"));
            }
        });
    }

    function insertDownloadButtons() {
        var followBtns = document.querySelectorAll(FOLLOW_BUTTON_SELECTOR);
        for (var i = 0; i < followBtns.length; i++) {
            var followBtn = followBtns[i];
            if (followBtn.dataset.rumbleDownloadAttached === "1" || !followBtn.parentNode) continue;

            followBtn.dataset.rumbleDownloadAttached = "1";
            var button = buildDownloadButton();
            downloadButtonAnchors.set(button, followBtn);
            followBtn.parentNode.insertBefore(button, followBtn.nextSibling);
        }

        var commentIcons = document.querySelectorAll(SHORTS_COMMENTS_ICON_SELECTOR);
        for (var j = 0; j < commentIcons.length; j++) {
            var commentsAction = commentIcons[j].closest("." + SHORTS_ACTION_CLASS);
            if (!commentsAction || commentsAction.dataset.rumbleDownloadAttached === "1" || !commentsAction.parentNode) continue;

            commentsAction.dataset.rumbleDownloadAttached = "1";
            var shortsAction = buildShortsDownloadAction();
            downloadButtonAnchors.set(shortsAction, commentsAction);
            commentsAction.parentNode.insertBefore(shortsAction, commentsAction);
        }

        updateAllDownloadButtonsState();
    }

    function handleVideoReady(video) {
        applySpeed(video);
        insertOrUpdateBadge();
        insertDownloadButtons();

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
            updateAllDownloadButtonsState();
        }
    }, true);

    var syncWithPage = rumbleDebounce(function () {
        insertOrUpdateBadge();
        insertDownloadButtons();
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
                insertDownloadButtons();
            });
        });
    }

    rumbleGetSettings(function (settings) {
        currentSettings = settings;
        insertOrUpdateBadge();
        insertDownloadButtons();
        var video = document.querySelector("video");
        if (video) applySpeed(video);
    });
})();
