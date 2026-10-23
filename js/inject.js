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
        var text = chrome.i18n.getMessage("badgePrefix") + ": " + settings.speed + "x";
        var volume = Number(settings.volume);
        if (volume && volume !== 100) {
            text += " · " + volume + "%";
        }
        return text;
    }

    function insertOrUpdateBadge() {
        var container = document.querySelector(".video-footer-buttons");
        if (!container) return;

        var badge = container.querySelector(".rumbles-count");
        if (!currentSettings.playbackEnabled) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "rumbles-count";
            container.appendChild(badge);
        }
        badge.textContent = formatBadgeText(currentSettings);
    }

    function applySpeed(video) {
        if (!video) return;
        if (!currentSettings.playbackEnabled) {
            video.playbackRate = 1;
            return;
        }
        var speed = Number(currentSettings.speed);
        video.playbackRate = (!speed || isNaN(speed) || speed <= 0) ? 1 : speed;
    }

    // --- Volume gain ---------------------------------------------------
    // A plain <video>.volume only ever attenuates (0-1); it cannot boost
    // audio past its original loudness. Going above 100% requires routing
    // the element's audio through a Web Audio GainNode instead. That
    // routing is only set up the first time a given video is actually
    // boosted past 100%, and reused afterwards (createMediaElementSource
    // can only ever be called once per <video>, and doing it unconditionally
    // would also pointlessly detour normal-volume playback through
    // Web Audio for every single video).
    var videoGainNodes = new WeakMap();

    function getOrCreateGainNode(video) {
        var existing = videoGainNodes.get(video);
        if (existing) return existing;

        try {
            var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            var context = new AudioContextCtor();
            var source = context.createMediaElementSource(video);
            var gainNode = context.createGain();
            source.connect(gainNode);
            gainNode.connect(context.destination);

            var nodes = { context: context, gainNode: gainNode };
            videoGainNodes.set(video, nodes);
            return nodes;
        } catch (e) {
            debugLog("volume: could not set up a Web Audio gain node", e);
            return null;
        }
    }

    function applyVolume(video) {
        if (!video) return;
        if (!currentSettings.playbackEnabled) {
            video.volume = 1;
            var neutral = videoGainNodes.get(video);
            if (neutral) neutral.gainNode.gain.value = 1;
            return;
        }

        var percent = Number(currentSettings.volume);
        if (!percent || isNaN(percent) || percent < 0) percent = 100;

        if (percent <= 100) {
            // Plain attenuation - no need to touch Web Audio at all.
            var existing = videoGainNodes.get(video);
            if (existing) existing.gainNode.gain.value = 1;
            video.volume = percent / 100;
            return;
        }

        // Boosting past 100% needs the gain node - native volume caps at 1.
        video.volume = 1;
        var nodes = getOrCreateGainNode(video);
        if (nodes) {
            if (nodes.context.state === "suspended") nodes.context.resume();
            nodes.gainNode.gain.value = percent / 100;
        }
    }

    // --- Driving Rumble's own settings menu --------------------------------
    // The extension always sets video.playbackRate directly first (fast and
    // reliable). On top of that, it also clicks the matching row in Rumble's
    // own Speed/Quality menu, so the player's own UI (checkmark, current
    // value shown) stays in sync, and so the resolution actually changes
    // (that one Rumble does not expose through the <video> element at all,
    // it has to be done through its menu).
    //
    // Inspecting Rumble's actual player (2026-10) showed the Speed/Quality
    // rows do NOT exist until the settings overlay is opened: opening the
    // gear menu creates them (321 <li> elements on a watch page with the
    // menu closed, 337 with it open - the delta is exactly the 16 menu
    // rows), and closing it destroys them again. The old assumption that
    // the rows always exist and opening the menu only toggles `display`
    // no longer holds. The sync therefore briefly opens the settings
    // overlay, clicks the matching rows while the panel is hidden from the
    // user (visibility: hidden on the panel element, its inline styles
    // saved and restored afterwards - dispatched synthetic clicks reach
    // listeners regardless of visibility), and closes it again. Every row
    // carries its own <svg> icon, so row svg-presence is NOT a marker of
    // the selected row; the applied values are read from the section
    // headers instead ("Speed 2×", "Quality 6.1 mbps"), which exist only
    // while the menu is open too. Everything here fails silently if it
    // can't find a matching row or the gear button - the direct
    // playbackRate assignment above still guarantees the speed itself
    // always works either way.

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

    // Menu rows are matched by their text; trimming is kept defensively even
    // though the rows currently carry no extra visible text around the label.
    function normalizeMenuText(raw) {
        return (raw || "").trim();
    }

    // The settings rows live inside whichever container currently holds the
    // player: #videoPlayer normally, #theaterVideoPlayer in theater mode
    // (theater relocates the player across). Search both, falling back to the
    // whole document if neither container exists.
    function menuLiScopes() {
        var scopes = [];
        var vp = document.getElementById("videoPlayer");
        var tp = document.getElementById("theaterVideoPlayer");
        if (vp) scopes.push(vp);
        if (tp) scopes.push(tp);
        if (!scopes.length) scopes.push(document);
        return scopes;
    }

    function extractMenuCandidates(pattern) {
        var scopes = menuLiScopes();
        var seen = new Set();
        var results = [];

        for (var s = 0; s < scopes.length; s++) {
            var nodes = scopes[s].querySelectorAll("li");
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (seen.has(el)) continue;
                seen.add(el);
                var text = normalizeMenuText(el.textContent);
                if (el.children.length <= 3 && pattern.test(text)) {
                    results.push({ el: el, text: text });
                }
            }
        }

        // Fallback: neither player container had a matching row - scan the
        // whole document once before giving up.
        if (!results.length) {
            var all = document.querySelectorAll("li");
            for (var j = 0; j < all.length; j++) {
                var e2 = all[j];
                if (seen.has(e2)) continue;
                seen.add(e2);
                var t2 = normalizeMenuText(e2.textContent);
                if (e2.children.length <= 3 && pattern.test(t2)) {
                    results.push({ el: e2, text: t2 });
                }
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

    // The settings/gear button. The settings area is classed
    // .touched_overlay_item, but the gear itself is a <div> (NOT a <button>)
    // carrying title="Playback settings" - confirmed from production markup.
    // The <button>-based selectors below are kept as fallbacks only.
    var SETTINGS_BUTTON_SELECTORS = [
        'div[title="Playback settings" i]',
        'div[title*="settings" i]',
        '[aria-label*="settings" i]',
        '.touched_overlay_item button',
        '.touched_overlay_item + div button'
    ];

    function findSettingsButton() {
        for (var i = 0; i < SETTINGS_BUTTON_SELECTORS.length; i++) {
            try {
                var el = document.querySelector(SETTINGS_BUTTON_SELECTORS[i]);
                if (el) return el;
            } catch (e) {}
        }
        return null;
    }

    // Rumble wires the settings toggle on the gear's INNER icon-wrapper div,
    // not on the outer div carrying the title attribute - a click dispatched
    // on the outer div never reaches it, because events bubble upward only.
    // So the click is dispatched on the innermost <svg> instead: bubbling then
    // passes through the icon wrapper (where the handler lives) and every
    // ancestor, making it work no matter which level the handler sits at.
    function gearClickTarget(gear) {
        if (!gear) return null;
        try {
            var svg = gear.querySelector("svg");
            if (svg) return svg;
        } catch (e) {}
        return gear.children && gear.children[0] ? gear.children[0] : gear;
    }

    // The settings panel is the gear's child with inline position: absolute.
    // It is empty (display: none) when closed and holds the <li> rows when
    // open, so it can be found and hidden before the gear is ever clicked.
    function findSettingsPanels(gear) {
        var out = [];
        if (!gear || !gear.children) return out;
        for (var i = 0; i < gear.children.length; i++) {
            var child = gear.children[i];
            if (child && child.tagName === "DIV" && child.style && child.style.position === "absolute") {
                out.push(child);
            }
        }
        return out;
    }

    // While the menu is open, its section headers carry the currently applied
    // values: "Speed 2×" / "Speed Normal" and "Quality 6.1 mbps" /
    // "Quality 200 kbps" ("Quality auto" in adaptive mode). Reading them is
    // the only reliable way to know the player's current state, because every
    // row carries its own <svg> icon (so svg-presence is not a marker).
    function findMenuHeader(kind) {
        var re = kind === "speed" ? /^speed\b/i : /^quality\b/i;
        var scopes = menuLiScopes();
        for (var s = 0; s < scopes.length; s++) {
            var nodes = scopes[s].querySelectorAll("li");
            for (var i = 0; i < nodes.length; i++) {
                var text = normalizeMenuText(nodes[i].textContent);
                if (re.test(text) && text.length <= 30) return nodes[i];
            }
        }
        return null;
    }

    function parseHeaderValue(kind, text) {
        var value = text.replace(/^(speed|quality)\b\s*/i, "").trim();
        if (kind === "speed") {
            if (/^normal$/i.test(value)) return 1;
            var s = parseFloat(value.replace(",", ".").replace(/[x×]/gi, ""));
            return isNaN(s) ? null : s;
        }
        if (/^auto$/i.test(value)) return null; // player is in adaptive mode
        var m = value.match(/^([\d.,]+)\s*(mbps|kbps)$/i);
        if (!m) return null;
        var rate = parseFloat(m[1].replace(",", "."));
        return /^m/i.test(m[2]) ? rate * 1000 : rate;
    }

    // "Is the menu already showing what the settings ask for?" Returns
    // true (correct), false (drifted - a click is needed) or null (cannot
    // verify - e.g. the header is missing or unreadable; apply anyway).
    function speedMenuMatches() {
        var header = findMenuHeader("speed");
        if (!header) return null;
        var current = parseHeaderValue("speed", normalizeMenuText(header.textContent));
        if (current === null) return null;
        return Math.abs(current - Number(currentSettings.speed)) < 0.001;
    }

    function qualityMenuMatches(pickedEl) {
        if (currentSettings.resolution === "auto") return true; // not driven at all
        var header = findMenuHeader("quality");
        if (!header) return null;
        var current = parseHeaderValue("quality", normalizeMenuText(header.textContent));
        if (current === null) return null;
        var info = pickedEl ? parseQualityCandidate(normalizeMenuText(pickedEl.textContent)) : null;
        if (!info || info.isAuto) return null;
        return Math.abs(current - info.bitrateKbps) < 1;
    }

    // Clicks the rows matching the current settings, skipping any whose header
    // already shows the requested value - a redundant quality click makes
    // Rumble reload the stream for nothing.
    function clickDesiredRows(speedCandidates, qualityCandidates) {
        if (currentSettings.playbackEnabled !== false && speedCandidates.length) {
            var speedEl = pickClosestSpeedElement(speedCandidates, currentSettings.speed);
            if (speedEl && speedMenuMatches() !== true) simulateClick(speedEl);
        }
        if (currentSettings.resolution !== "auto" && qualityCandidates.length) {
            var qualityEl = pickTargetQualityElement(qualityCandidates, currentSettings.resolution);
            if (qualityEl && qualityMenuMatches(qualityEl) !== true) simulateClick(qualityEl);
        }
    }

    var menuSyncBusy = false;
    // Set once the primary hidden sync has completed (successfully or not);
    // the heal path only corrects quality after that, so opening the menu
    // early never triggers the stream reload the primary sync would cause.
    var menuSyncDone = false;

    // Applies the current settings to Rumble's Speed/Quality menu. The rows
    // only exist while the menu is open, so this opens the settings overlay,
    // waits for the rows (retrying while they mount), clicks the matching
    // rows while the panel is hidden from the user (visibility: hidden on the
    // panel element, its inline styles saved and restored afterwards - the
    // rows are created with display: block but the panel is kept invisible
    // the whole time, and dispatched synthetic clicks reach listeners
    // regardless of visibility), and closes the overlay again. Because a row
    // click can make Rumble close the overlay on its own, the dance reopens
    // it between rows when that happens, so both rows are always applied.
    // If the menu is already open (the user opened it), the rows are corrected
    // directly and left visibly in sync. Fails silently.
    function syncSettingsMenu(video, attempt) {
        attempt = attempt || 0;
        if (menuSyncBusy) return;
        menuSyncBusy = true;

        // Menu already open? Correct it in place - the user is looking at it.
        var speedCandidates = extractMenuCandidates(SPEED_ITEM_PATTERN);
        var qualityCandidates = extractMenuCandidates(QUALITY_ITEM_PATTERN);
        if (speedCandidates.length || qualityCandidates.length) {
            clickDesiredRows(speedCandidates, qualityCandidates);
            menuSyncBusy = false;
            return;
        }

        var gear = findSettingsButton();
        if (!gear) {
            menuSyncBusy = false;
            if (attempt < 8) {
                debugLog("menu: settings button not found yet (attempt " + attempt + "), retrying...");
                setTimeout(function () { syncSettingsMenu(video, attempt + 1); }, 700);
            } else {
                debugLog("menu: settings button not found after retries, giving up");
                menuSyncDone = true;
            }
            return;
        }

        var panels = findSettingsPanels(gear);
        var videoWasPlaying = !!(video && !video.paused);
        // The dance only runs when the menu was closed, so any open overlay is
        // ours - confirmed as soon as its rows appear.
        var openedByUs = false;
        var savedStyles = [];
        var pendingSpeed = currentSettings.playbackEnabled !== false;
        var pendingQuality = currentSettings.resolution !== "auto";
        function hidePanels() {
            for (var i = 0; i < panels.length; i++) {
                savedStyles.push({ el: panels[i], cssText: panels[i].style.cssText });
                panels[i].style.visibility = "hidden";
            }
        }
        function restorePanels() {
            while (savedStyles.length) {
                var rec = savedStyles.pop();
                rec.el.style.cssText = rec.cssText;
            }
        }

        function finish() {
            try {
                // Make sure the menu ends closed - only if we opened it and it
                // is still open.
                if (openedByUs) {
                    var s = extractMenuCandidates(SPEED_ITEM_PATTERN);
                    var q = extractMenuCandidates(QUALITY_ITEM_PATTERN);
                    if (s.length || q.length) simulateClick(gearClickTarget(gear));
                }
            } finally {
                restorePanels();
                if (videoWasPlaying && video && video.paused) {
                    try { video.play(); } catch (e) {}
                }
                // The primary sync had its chance - heal may now correct any
                // drift the user sees with the menu open.
                menuSyncDone = true;
                menuSyncBusy = false;
            }
        }

        try {
            hidePanels();
            simulateClick(gearClickTarget(gear));
        } catch (e) {
            debugLog("menu: failed to open overlay", e);
            restorePanels();
            menuSyncBusy = false;
            return;
        }

        // The rows are built asynchronously after the overlay opens. The speed
        // rows appear immediately, but the quality rows only exist once the
        // video has loaded a rendition (in a fresh page they are simply
        // missing), so each pending kind is retried - not consumed - until its
        // target row actually exists. Bounded to a few seconds either way.
        var openAttempt = 0;
        (function step() {
            setTimeout(function () {
                try {
                    var s = extractMenuCandidates(SPEED_ITEM_PATTERN);
                    var q = extractMenuCandidates(QUALITY_ITEM_PATTERN);

                    if (s.length || q.length) {
                        // Menu is open. Apply the next pending kind whose
                        // target row exists; keep waiting for the other.
                        openedByUs = true;
                        if (pendingSpeed) {
                            var speedEl = pickClosestSpeedElement(s, currentSettings.speed);
                            if (speedEl) {
                                pendingSpeed = false;
                                if (speedMenuMatches() !== true) simulateClick(speedEl);
                            } else {
                                debugLog("menu: speed rows missing unexpectedly");
                                pendingSpeed = false;
                            }
                            setTimeout(step, 300);
                            return;
                        }
                        if (pendingQuality) {
                            var qualityEl = pickTargetQualityElement(q, currentSettings.resolution);
                            if (qualityEl) {
                                pendingQuality = false;
                                if (qualityMenuMatches(qualityEl) !== true) simulateClick(qualityEl);
                                setTimeout(step, 300);
                                return;
                            }
                            // Quality rows not rendered yet (video still
                            // loading) - keep the (hidden) menu open and wait.
                            if (++openAttempt > 10) {
                                debugLog("menu: quality rows never appeared, giving up");
                                finish();
                                return;
                            }
                            setTimeout(step, 500);
                            return;
                        }
                        finish();
                        return;
                    }

                    // No rows at all - the overlay hasn't opened (or a row
                    // click auto-closed it). Reopen while kinds are pending.
                    if (pendingSpeed || pendingQuality) {
                        openAttempt++;
                        if (openAttempt > 6) {
                            debugLog("menu: overlay did not open, giving up");
                            finish();
                            return;
                        }
                        simulateClick(gearClickTarget(gear));
                        debugLog("menu: reopening overlay (attempt " + openAttempt + ")");
                        setTimeout(step, 400);
                        return;
                    }

                    finish();
                } catch (e) {
                    debugLog("menu: unexpected error", e);
                    finish();
                }
            }, 400);
        })();
    }

    // While the user has the menu open, re-apply drifted values in place.
    // Rate-limited: the observer tick runs this roughly every 400ms while the
    // video plays, and repeated quality clicks would reload the stream each
    // time. With the menu closed there is nothing to verify (the rows and the
    // headers do not exist), so this is a no-op then - the hidden sync above
    // is what applies the settings. Quality is only corrected here after the
    // primary sync has already had its chance, so the user opening the menu
    // early never triggers the stream reload the primary sync would cause.
    var lastMenuHealAt = 0;
    function healMenuIfOpen() {
        var now = Date.now();
        if (now - lastMenuHealAt < 1500) return;

        var speedCandidates = extractMenuCandidates(SPEED_ITEM_PATTERN);
        var qualityCandidates = extractMenuCandidates(QUALITY_ITEM_PATTERN);
        if (!speedCandidates.length && !qualityCandidates.length) return; // menu closed

        lastMenuHealAt = now;
        if (currentSettings.playbackEnabled !== false && speedCandidates.length) {
            var speedEl = pickClosestSpeedElement(speedCandidates, currentSettings.speed);
            if (speedEl && speedMenuMatches() !== true) simulateClick(speedEl);
        }
        if (menuSyncDone && currentSettings.resolution !== "auto" && qualityCandidates.length) {
            var qualityEl = pickTargetQualityElement(qualityCandidates, currentSettings.resolution);
            if (qualityEl && qualityMenuMatches(qualityEl) !== true) simulateClick(qualityEl);
        }
    }

    function settingsSignature(settings) {
        return settings.playbackEnabled + "|" + settings.speed + "|" + settings.volume + "|" + settings.resolution + "|" + settings.playerMode;
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

    // --- Player mode (standard / theater / fullscreen) ---------------------
    // Rumble already renders its own buttons for these modes, so this follows
    // the same "find the on-page control and click it" approach used for speed
    // and resolution - nothing is injected into the page. Theater mode is just
    // a CSS class on <body> toggled by Rumble's own button, so it needs no
    // user gesture; entering fullscreen does, so that path is only attempted
    // from the `play` event (see the wiring below).
    var THEATER_BUTTON_SELECTOR =
        '[title="Toggle theater mode" i], [data-js="theater-mode-toggle"], ' +
        'button[title*="theater" i], button[aria-label*="theater" i]';
    function findTheaterButton() {
        try { return document.querySelector(THEATER_BUTTON_SELECTOR); } catch (e) { return null; }
    }

    function isTheaterModeActive() {
        return !!(document.body && document.body.classList.contains("theater-mode"));
    }

    function applyPlayerMode(video, userGesture) {
        var mode = (currentSettings && currentSettings.playerMode) || "standard";
        if (mode === "theater") {
            if (!isTheaterModeActive()) {
                var tbtn = findTheaterButton();
                if (tbtn) simulateClick(tbtn);
            }
        } else if (mode === "fullscreen") {
            if (userGesture && video && !document.fullscreenElement) {
                var target = (video.parentElement && typeof video.parentElement.requestFullscreen === "function")
                    ? video.parentElement : video;
                try { target.requestFullscreen(); } catch (e) { debugLog("fullscreen failed", e); }
            }
        } else {
            // standard: tear down any active mode
            if (isTheaterModeActive()) {
                var tbtn2 = findTheaterButton();
                if (tbtn2) simulateClick(tbtn2);
            }
            if (document.fullscreenElement && document.exitFullscreen) {
                try { document.exitFullscreen(); } catch (e) { debugLog("exit fullscreen failed", e); }
            }
        }
    }

    function handleVideoReady(video, userGesture) {
        applySpeed(video);
        applyVolume(video);
        insertOrUpdateBadge();
        insertDownloadButtons();
        applyPlayerMode(video, !!userGesture);

        var srcKey = video.currentSrc || video.src || "";
        var signature = srcKey + "::" + settingsSignature(currentSettings);
        if (video.dataset.rumbleSyncedFor !== signature) {
            video.dataset.rumbleSyncedFor = signature;
            debugLog("syncing menu for settings", currentSettings);
            syncSettingsMenu(video);

            // In theater mode the player is relocated as the layout switches,
            // and the theater button itself mounts late (the player is built
            // async), so theater may only switch on after the sync above.
            // Re-run the same sync once more, after the transition settles.
            if ((currentSettings.playerMode || "standard") === "theater") {
                (function (sig) {
                    setTimeout(function () {
                        if (video.dataset.rumbleSyncedFor !== sig) return;
                        if (!isTheaterModeActive()) return;
                        syncSettingsMenu(video);
                    }, 1200);
                })(signature);
            }
        } else {
            // Same signature as the last sync. Rumble re-renders its player
            // (theater transition, settings overlay) and can discard the rows
            // that were clicked - that is why the gear menu used to keep
            // showing 1x/Auto until the user opened it and triggered a
            // restart. If the menu is open right now, correct it in place.
            healMenuIfOpen();
        }
    }

    // --- Wiring --------------------------------------------------------

    // 'play' does not bubble, but it does fire during the capture phase, so
    // a single listener on document catches it for any video Rumble adds
    // later on, instead of binding only to the video present at load time.
    document.addEventListener("play", function (event) {
        if (event.target && event.target.tagName === "VIDEO") {
            handleVideoReady(event.target, true);
        }
    }, true);

    document.addEventListener("loadedmetadata", function (event) {
        if (event.target && event.target.tagName === "VIDEO") {
            applySpeed(event.target);
            applyVolume(event.target);
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
        if (video) {
            applySpeed(video);
            applyVolume(video);
            applyPlayerMode(video, false);
            syncSettingsMenu(video);
        }
    });
})();
