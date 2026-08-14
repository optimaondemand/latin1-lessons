/*!
 * OPTIMA READ-ALOUD PLAYER — v1.0 (pilot)
 * ---------------------------------------------------------------------------
 * Self-contained "Listen" player for GitHub-hosted Optima lesson pages.
 * Uses the browser's built-in Web Speech API: no accounts, no API keys, no
 * network calls once the page has loaded. Works inside a Canvas iframe.
 *
 * HOW TO USE
 *   Add ONE line to a lesson page, just before </body>:
 *     <script defer src="../../shared/read-aloud/read-aloud.v1.js"></script>
 *   The script injects its own styles and control panel at the top of the
 *   .canvas-frame wrapper. Nothing else in the page changes.
 *
 * OPTIONS (all optional, set in the page)
 *   data-ra-skip        on any element the reader must NOT read
 *                       (preview banners, answer keys, decorative text,
 *                        vocabulary tables where recorded audio is the model)
 *   data-readaloud-root on one container, to limit reading to that container
 *   data-ra-lang="es"   on the root, to declare the page's spoken language
 *   lang="es" / "fr"    on any element, to switch voices mid-page
 *
 * BEHAVIOUR NOTES
 *   - Never reads itself, <button> labels, or hidden elements, so unrevealed
 *     widget feedback stays unread until the student reveals it.
 *   - Text is split into sentences. This also sidesteps Chrome's ~15-second
 *     cutoff on long utterances.
 *   - If the browser has no speech voices, the player disables itself with a
 *     friendly message instead of breaking the page.
 *   - If a block's language has no installed voice (e.g. Latin), the browser
 *     default voice reads it. Recorded native audio remains the pronunciation
 *     model; this player is for instructions and explanation.
 */
(function () {
    "use strict";

    if (window.__optimaReadAloud) { return; }   // never initialise twice
    window.__optimaReadAloud = "1.0";

    var CSS = [
        "#optima-read-aloud{background:linear-gradient(135deg,#E8F6FB 0%,#F4F9FC 100%);border:1px solid #C5DCE5;border-left:5px solid #2196D0;border-radius:8px;padding:14px 18px;margin:0 0 20px 0;}",
        "#optima-read-aloud .ora-kicker{font-size:11px;color:#1B6A94;letter-spacing:.4px;margin-bottom:10px;}",
        "#optima-read-aloud .ora-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}",
        "#optima-read-aloud .ora-controls button{border-radius:8px;padding:8px 16px;font-size:14px;cursor:pointer;font-family:inherit;transition:all .15s;}",
        "#ora-play{background:#0E1C42;color:#FFFFFF;border:1.5px solid #0E1C42;}",
        "#ora-play:hover:enabled{background:#1B2D5E;}",
        "#ora-play:disabled{background:#D0D9E8;border-color:#D0D9E8;color:#6b7a99;cursor:default;}",
        "#ora-stop{background:#FFFFFF;color:#0E1C42;border:1.5px solid #D0D9E8;}",
        "#ora-stop:hover:enabled{background:#F4F6FA;border-color:#55C8E8;}",
        "#ora-stop:disabled{color:#999;border-color:#E4E9F2;cursor:default;}",
        "#optima-read-aloud .ora-speed{font-size:12px;color:#6b7a99;display:flex;align-items:center;gap:6px;}",
        "#ora-rate{font-family:inherit;font-size:13px;color:#0E1C42;border:1.5px solid #D0D9E8;border-radius:6px;padding:5px 8px;background:#FFFFFF;}",
        "#ora-status{font-size:12px;color:#666;}",
        ".ora-highlight{background:#FDF3E3 !important;box-shadow:inset 4px 0 0 #C7922C;border-radius:4px;transition:background .2s;}"
    ].join("\n");

    var PANEL =
        '<div class="ora-kicker">&#128266; READ ALOUD &mdash; LISTEN TO THIS PAGE</div>' +
        '<div class="ora-controls">' +
          '<button id="ora-play" type="button" aria-label="Listen to this page">&#9654;&#65039; Listen</button>' +
          '<button id="ora-stop" type="button" aria-label="Stop reading" disabled>&#9632; Stop</button>' +
          '<label class="ora-speed">Speed' +
            '<select id="ora-rate" aria-label="Reading speed">' +
              '<option value="0.8">Slower</option>' +
              '<option value="1" selected>Normal</option>' +
              '<option value="1.25">Faster</option>' +
            '</select>' +
          '</label>' +
          '<span id="ora-status" role="status" aria-live="polite"></span>' +
        '</div>';

    var LABEL_PLAY   = "▶️ Listen";
    var LABEL_PAUSE  = "⏸️ Pause";
    var LABEL_RESUME = "▶️ Resume";

    // Innermost meaningful text blocks, tried first; generic containers only as a fallback,
    // so a stray text node in a card does not highlight the whole card.
    var BLOCK_PRIMARY  = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, figcaption";
    var BLOCK_FALLBACK = "div, section, article, main";
    var SKIP_SEL = "#optima-read-aloud, [data-ra-skip], [aria-hidden=\"true\"], .preview-banner, button, script, style, select, option, noscript, iframe, audio, video";

    // A period inside a number or a common abbreviation is not a sentence end.
    // Without this, "Lesson 0.02" is read as "Lesson zero." / "zero two".
    var MARK = String.fromCharCode(1);   // sentinel that cannot occur in lesson text
    var ABBREV = /\b(e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|St|approx|Fig|No)\./gi;

    function protectPeriods(s) {
        return s.replace(/(\d)\.(\d)/g, "$1" + MARK + "$2")
                .replace(ABBREV, function (m) { return m.replace(/\./g, MARK); });
    }
    function restorePeriods(s) {
        return s.split(MARK).join(".");
    }

    var root, playBtn, stopBtn, rateSel, statusEl;
    var queue = [], idx = 0;
    var playing = false, paused = false, stopping = false;
    var currentBlock = null;
    var currentUtterance = null;   // held to dodge a Chrome garbage-collection bug
    var voices = [];

    function loadVoices() {
        try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
        return voices.length;
    }

    // Pick the best voice for a language tag ("es-MX" -> "es"). Returns null when
    // the language has no installed voice; the browser default then reads it.
    function pickVoice(lang) {
        if (!voices.length) { loadVoices(); }
        if (!voices.length) { return null; }
        var base = String(lang || "en").toLowerCase().split("-")[0];
        var match = voices.filter(function (v) {
            return String(v.lang || "").toLowerCase().split("-")[0] === base;
        });
        if (!match.length) { return null; }
        return match.filter(function (v) { return /natural|neural/i.test(v.name); })[0]
            || match.filter(function (v) { return /google/i.test(v.name); })[0]
            || match.filter(function (v) { return v.default; })[0]
            || match[0];
    }

    function langOf(el) {
        var tagged = el && el.closest ? el.closest("[lang]") : null;
        if (tagged && tagged !== document.documentElement) { return tagged.getAttribute("lang"); }
        if (root && root.getAttribute && root.getAttribute("data-ra-lang")) {
            return root.getAttribute("data-ra-lang");
        }
        if (tagged) { return tagged.getAttribute("lang"); }
        return document.documentElement.getAttribute("lang") || "en";
    }

    function isVisible(el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // Walk text nodes, attach each to its nearest block ancestor, split into sentences.
    function collectQueue() {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        var items = [];   // [{ el, text }] — one entry per block, in reading order
        var node;
        while ((node = walker.nextNode())) {
            if (!/\S/.test(node.textContent)) { continue; }
            var el = node.parentElement;
            if (!el || el.closest(SKIP_SEL)) { continue; }
            if (!isVisible(el)) { continue; }
            var block = el.closest(BLOCK_PRIMARY) || el.closest(BLOCK_FALLBACK) || root;
            var last = items[items.length - 1];
            if (last && last.el === block) { last.text += " " + node.textContent; }
            else { items.push({ el: block, text: node.textContent }); }
        }
        var q = [];
        items.forEach(function (item) {
            var clean = item.text.replace(/\s+/g, " ").trim();
            if (!clean) { return; }
            var lang = langOf(item.el);
            var guarded = protectPeriods(clean);
            var sentences = guarded.match(/[^.!?]+[.!?]+[”"')\]]*\s*|[^.!?]+$/g) || [guarded];
            sentences.forEach(function (s) {
                s = restorePeriods(s).trim();
                if (s) { q.push({ el: item.el, text: s, lang: lang }); }
            });
        });
        return q;
    }

    function highlight(el) {
        if (el === currentBlock) { return; }
        clearHighlight();
        currentBlock = el;
        if (el && el !== document.body) {
            el.classList.add("ora-highlight");
            try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
        }
    }

    function clearHighlight() {
        if (currentBlock) { currentBlock.classList.remove("ora-highlight"); }
        currentBlock = null;
    }

    function speakNext() {
        if (idx >= queue.length) { finish("Finished reading this page."); return; }
        var item = queue[idx];
        highlight(item.el);
        var u = new SpeechSynthesisUtterance(item.text);
        u.rate = parseFloat(rateSel.value) || 1;
        u.lang = item.lang || "en";
        var v = pickVoice(item.lang);
        if (v) { u.voice = v; }
        u.onend = function () {
            if (stopping) { return; }
            idx++;
            speakNext();
        };
        u.onerror = function (e) {
            if (stopping || e.error === "canceled" || e.error === "interrupted") { return; }
            idx++;
            speakNext();
        };
        currentUtterance = u;
        window.speechSynthesis.speak(u);
        statusEl.textContent = "Reading… " + (idx + 1) + " / " + queue.length;
    }

    function finish(message) {
        playing = false;
        paused = false;
        clearHighlight();
        playBtn.textContent = LABEL_PLAY;
        stopBtn.disabled = true;
        statusEl.textContent = message || "";
        currentUtterance = null;
    }

    function start() {
        queue = collectQueue();
        if (!queue.length) { statusEl.textContent = "Nothing to read on this page."; return; }
        idx = 0;
        stopping = false;
        playing = true;
        paused = false;
        window.speechSynthesis.cancel();
        playBtn.textContent = LABEL_PAUSE;
        stopBtn.disabled = false;
        speakNext();
    }

    function boot() {
        root = document.querySelector("[data-readaloud-root]")
            || document.querySelector(".canvas-frame")
            || document.body;
        if (!root) { return; }

        var style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        var panel = document.createElement("div");
        panel.id = "optima-read-aloud";
        panel.innerHTML = PANEL;
        root.insertBefore(panel, root.firstChild);

        playBtn  = document.getElementById("ora-play");
        stopBtn  = document.getElementById("ora-stop");
        rateSel  = document.getElementById("ora-rate");
        statusEl = document.getElementById("ora-status");

        if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
            playBtn.disabled = true;
            rateSel.disabled = true;
            statusEl.textContent = "Read-aloud is not supported in this browser.";
            return;
        }

        loadVoices();
        if ("onvoiceschanged" in window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }

        playBtn.addEventListener("click", function () {
            if (playing && !paused) {
                window.speechSynthesis.pause();
                paused = true;
                playBtn.textContent = LABEL_RESUME;
                statusEl.textContent = "Paused";
                return;
            }
            if (playing && paused) {
                window.speechSynthesis.resume();
                paused = false;
                playBtn.textContent = LABEL_PAUSE;
                statusEl.textContent = "Reading… " + (idx + 1) + " / " + queue.length;
                return;
            }
            // Chrome returns an empty voice list until the engine warms up; on a cold
            // first click, wait briefly for it rather than reading in the wrong voice.
            if (!loadVoices()) {
                statusEl.textContent = "Loading voices…";
                setTimeout(function () { loadVoices(); start(); }, 250);
                return;
            }
            start();
        });

        stopBtn.addEventListener("click", function () {
            stopping = true;
            window.speechSynthesis.cancel();
            finish("");
        });

        // Changing speed mid-read restarts the current sentence at the new rate.
        rateSel.addEventListener("change", function () {
            if (!playing || paused) { return; }
            stopping = true;
            window.speechSynthesis.cancel();
            setTimeout(function () { stopping = false; speakNext(); }, 60);
        });

        window.addEventListener("pagehide", function () {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
