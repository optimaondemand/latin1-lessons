/*!
 * OPTIMA READ-ALOUD PLAYER — v2.0 (pilot: hybrid language switching)
 * ---------------------------------------------------------------------------
 * Self-contained "Listen" player for GitHub-hosted Optima lesson pages.
 * Browser-native Web Speech API: no accounts, no API keys, no network calls.
 *
 * WHAT v2 ADDS OVER v1
 *   Language switching. A Web Speech utterance carries exactly ONE voice, so
 *   reading "why does Spanish say el patio?" correctly means splitting the
 *   sentence at its language boundaries and speaking each run separately.
 *   v2 uses the DOM's own element boundaries as the unit of that decision:
 *   an inline <span> or <em> is already its own segment, so tagged or
 *   detectable target-language words separate naturally from English prose.
 *
 * THREE TIERS OF LANGUAGE DECISION (highest confidence first)
 *   1. EXPLICIT   a lang="es" / lang="fr" attribute on or above the text.
 *                 Always authoritative. This is the tier to grow over time.
 *   2. DIACRITIC  the segment carries letters unique to the language
 *                 (á é í ó ú ñ ü ¿ ¡ for Spanish; à â ç è ê ë î ï ô ù û œ
 *                 for French). High confidence, no word list needed.
 *   3. LEXICAL    the segment is short and every word of it appears in a
 *                 curated list of UNAMBIGUOUS target-language words.
 *                 Deliberately conservative: ambiguous tokens that are also
 *                 English words ("no", "me", "a", "o", "son", "van") are
 *                 excluded, and morpheme fragments ("-o", "-a") are ignored.
 *
 * Anything not matched stays in the page's default language. The bias is
 * always toward NOT switching: an English word read by a Spanish voice is
 * worse than a Spanish word read by an English one, because a wrong switch
 * mid-sentence sounds broken and models the wrong pronunciation.
 *
 * RECORDED AUDIO REMAINS THE MODEL
 *   Synthetic speech must never carry a phonemic contrast that IS the
 *   learning objective. Put data-ra-skip on vocabulary tables and
 *   pronunciation models so the recorded native audio stays authoritative.
 *
 * HOW TO USE
 *   Add ONE line to a lesson page, just before </body>:
 *     <script defer src="../../shared/read-aloud/read-aloud.v2.js"></script>
 *
 * OPTIONS (set in the page)
 *   data-ra-skip         element the reader must NOT read
 *   data-readaloud-root  limit reading to one container
 *   data-ra-lang="es"    declare the page's default spoken language
 *   lang="es"            tier-1 marking on any element (authoritative)
 *
 * AUDIT MODE
 *   Add ?ra-debug=1 to the page URL. Every segment is outlined and labelled
 *   with the language chosen and the tier that chose it, and a summary is
 *   printed to the console. Use this to check the classifier's decisions
 *   against the actual lesson text rather than trusting them.
 */
(function () {
    "use strict";

    if (window.__optimaReadAloud) { return; }
    window.__optimaReadAloud = "2.0";

    var DEBUG = /[?&]ra-debug=1/.test(window.location.search);

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
        "#ora-voices{font-size:11px;color:#1B6A94;background:none;border:none;text-decoration:underline;cursor:pointer;padding:0;font-family:inherit;}",
        ".ora-highlight{background:#FDF3E3 !important;box-shadow:inset 4px 0 0 #C7922C;border-radius:4px;transition:background .2s;}",
        ".ora-dbg{outline:1px dashed rgba(33,150,208,.8);}",
        ".ora-dbg-es{outline:2px solid #C7922C;background:rgba(199,146,44,.12);}",
        ".ora-dbg-tag{font-size:9px;background:#0E1C42;color:#fff;padding:1px 4px;border-radius:3px;vertical-align:super;}"
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
          '<button id="ora-voices" type="button">voices on this device</button>' +
        '</div>';

    var LABEL_PLAY   = "▶️ Listen";
    var LABEL_PAUSE  = "⏸️ Pause";
    var LABEL_RESUME = "▶️ Resume";

    var BLOCK_PRIMARY  = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, figcaption";
    var BLOCK_FALLBACK = "div, section, article, main";
    var SKIP_SEL = '#optima-read-aloud, [data-ra-skip], [aria-hidden="true"], .preview-banner, button, script, style, select, option, noscript, iframe, audio, video';

    // ---- sentence splitting -------------------------------------------------
    var MARK = String.fromCharCode(1);
    var ABBREV = /\b(e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|St|Sr|Sra|approx|Fig|No)\./gi;
    function protectPeriods(s) {
        return s.replace(/(\d)\.(\d)/g, "$1" + MARK + "$2")
                .replace(ABBREV, function (m) { return m.replace(/\./g, MARK); });
    }
    function restorePeriods(s) { return s.split(MARK).join("."); }

    // ---- tier 2: letters unique to a language -------------------------------
    var DIACRITIC = {
        es: /[áéíóúñü¿¡]/i,
        fr: /[àâçèêëîïôùûüœ]/i
    };

    // ---- tier 3: unambiguous words only -------------------------------------
    // Every entry here must NOT be a word a student would meet in English prose.
    // Ambiguous tokens are intentionally absent: no, me, a, o, son, van, ten,
    // pan, red, la is kept (its English use is vanishingly rare in lessons).
    var LEXICON = {
        es: ("el la los las un una unos unas del al y de en con por para que quien " +
             "es eres soy somos son está están estoy estás ser estar tener tengo tienes " +
             "hola adiós buenos buenas días tardes noches gracias señor señora señorita " +
             "cómo qué dónde cuándo quién cuál gusta gustan gustar llamo llamas llama " +
             "tú usted ustedes nosotros ellos ellas yo mi tu su nuestro " +
             "amigo amiga hermano hermana padre madre familia hijo hija abuelo abuela " +
             "rojo roja azul verde blanco blanca negro negra amarillo amarilla " +
             "encantado encantada mucho mucha muy también pero porque " +
             "casa escuela libro mesa silla puerta ventana pastel plaza patio fiesta " +
             "doctor doctora maestro maestra estudiante niño niña hombre mujer " +
             "gato perro comida agua leche pan").split(/\s+/),
        fr: ("le la les un une des du au aux et de en avec pour que qui " +
             "est sont suis es être avoir ai as bonjour bonsoir salut merci " +
             "monsieur madame mademoiselle comment quoi où quand pourquoi " +
             "je tu il elle nous vous ils elles mon ton son notre votre " +
             "ami amie frère soeur père mère famille fils fille " +
             "rouge bleu vert blanc noir jaune très aussi mais parce " +
             "maison école livre table chaise porte fenêtre chat chien pain eau lait").split(/\s+/)
    };
    // Articles are the strongest single-token signal: they are unambiguous and
    // they reliably introduce a noun that may not be in any word list.
    var ARTICLES = {
        es: { el: 1, la: 1, los: 1, las: 1, un: 1, una: 1, unos: 1, unas: 1 },
        fr: { le: 1, la: 1, les: 1, un: 1, une: 1, des: 1 }
    };

    // English grammar terms that sit next to a target-language example as a
    // gloss: "el (masculine · -o)". Their presence means the segment is mixed,
    // so the article rule must not claim the whole thing.
    var GLOSS = {};
    ("masculine feminine singular plural noun nouns verb verbs adjective adjectives " +
     "ending endings ends means meaning word words article articles gender " +
     "male female the and or is are").split(/\s+/).forEach(function (w) { GLOSS[w] = 1; });

    // Words that are unmistakably English. Deliberately excludes tokens that are
    // also Spanish or French ("no", "me", "a", "o", "son", "van", "en", "de"),
    // so the veto never fires on genuine target-language text.
    var EN_COMMON = {};
    ("the and is are was were you your this that these those with which what why how when " +
     "see take follow rule each every it its in on to of for from but so they we he she " +
     "do does did can will would should has have had be been not yes about into more than " +
     "spanish english french latin word words sound sounds letter letters sentence " +
     "here there now then just only also because if while after before " +
     "means ending ends masculine feminine").split(/\s+/).forEach(function (w) { EN_COMMON[w] = 1; });

    var LEX_SET = {};
    Object.keys(LEXICON).forEach(function (k) {
        LEX_SET[k] = {};
        LEXICON[k].forEach(function (w) { LEX_SET[k][w] = true; });
    });

    // Strip punctuation/markers so "¿Cómo?" and "patio," match the lexicon.
    function words(text) {
        return text.toLowerCase()
                   .replace(/[^a-záéíóúñüàâçèêëîïôùûœ\s'-]/g, " ")
                   .split(/\s+/)
                   .filter(function (w) { return w && !/^-/.test(w) && w.length > 1; });
    }

    // Decide a segment's language. Returns {lang, tier}. `fallback` is the
    // page default, used whenever nothing matches confidently.
    function classify(text, explicit, fallback, targets) {
        if (explicit) { return { lang: explicit, tier: "explicit" }; }
        var i, t;
        var w = words(text);

        // VETO: one unmistakably English word means this segment is English prose,
        // however many accents or target-language words it also contains.
        // "You see the Spanish word la música." is an English sentence, and a
        // single accent must not hand the whole of it to a Spanish voice.
        if (w.some(function (x) { return EN_COMMON[x]; })) {
            return { lang: fallback, tier: "default" };
        }

        for (i = 0; i < targets.length; i++) {
            t = targets[i];
            if (DIACRITIC[t] && DIACRITIC[t].test(text)) { return { lang: t, tier: "diacritic" }; }
        }
        if (w.length && w.length <= 8) {
            for (i = 0; i < targets.length; i++) {
                t = targets[i];
                if (!LEX_SET[t]) { continue; }
                var hits = w.filter(function (x) { return LEX_SET[t][x]; }).length;
                if (hits === w.length) { return { lang: t, tier: "lexical" }; }
            }
        }
        // A short phrase opening with a target-language article is that language,
        // even when the noun is outside our word list: "el rodeo", "la piñata".
        // No English phrase begins "el"/"la" followed by one or two words.
        if (w.length >= 2 && w.length <= 3 && !w.some(function (x) { return GLOSS[x]; })) {
            for (i = 0; i < targets.length; i++) {
                t = targets[i];
                if (ARTICLES[t] && ARTICLES[t][w[0]]) { return { lang: t, tier: "article" }; }
            }
        }
        return { lang: fallback, tier: "default" };
    }

    // Sabina (es-MX) is the voice used for this course's recorded audio clips.
    var PREFERRED = { es: /sabina/i };

    // RUN CONTINUATION
    // A target-language word often shares a text node with the English that
    // follows it: "<span>el</span> patio but <span>la</span> plaza?". The node
    // " patio but " has no element boundary to split on, so the English veto
    // sends "patio" to the English voice along with "but".
    // When the PREVIOUS segment was already confidently in a target language,
    // a leading run of that language's words continues it: "el" + " patio"
    // becomes one Spanish utterance, and " but " stays English.
    // Only fires as a continuation, never to start a run, so context does the
    // disambiguating that a word list alone cannot.
    var MAX_CONTINUATION_WORDS = 3;

    function splitLeadingRun(text, lang) {
        if (!LEX_SET[lang]) { return null; }
        var re = /\S+/g, m, taken = 0, end = 0;
        while ((m = re.exec(text))) {
            if (taken >= MAX_CONTINUATION_WORDS) { break; }
            var w = m[0].toLowerCase().replace(/[^a-záéíóúñüàâçèêëîïôùûœ'-]/g, "");
            if (!w || w.length < 2 || !LEX_SET[lang][w] || EN_COMMON[w]) { break; }
            taken++;
            end = m.index + m[0].length;
        }
        if (!taken) { return null; }
        return { head: text.slice(0, end), tail: text.slice(end) };
    }

    var root, playBtn, stopBtn, rateSel, statusEl, voicesBtn;
    var queue = [], idx = 0;
    var playing = false, paused = false, stopping = false;
    var currentBlock = null, currentUtterance = null;
    var voices = [];
    var pageLang = "en", targetLangs = [];

    function loadVoices() {
        try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
        return voices.length;
    }

    function pickVoice(lang) {
        if (!voices.length) { loadVoices(); }
        if (!voices.length) { return null; }
        var base = String(lang || "en").toLowerCase().split("-")[0];
        var match = voices.filter(function (v) {
            return String(v.lang || "").toLowerCase().split("-")[0] === base;
        });
        if (!match.length) { return null; }
        // Prefer the voice the course's own recorded audio already uses, so the
        // player sounds continuous with the mp3s rather than like a second narrator.
        if (PREFERRED[base]) {
            var favourite = match.filter(function (v) { return PREFERRED[base].test(v.name); })[0];
            if (favourite) { return favourite; }
        }
        return match.filter(function (v) { return /natural|neural/i.test(v.name); })[0]
            || match.filter(function (v) { return /google/i.test(v.name); })[0]
            || match.filter(function (v) { return v.default; })[0]
            || match[0];
    }

    function explicitLangOf(el) {
        var tagged = el && el.closest ? el.closest("[lang]") : null;
        if (tagged && tagged !== document.documentElement) {
            return String(tagged.getAttribute("lang") || "").toLowerCase().split("-")[0];
        }
        return null;
    }

    function isVisible(el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // Build the queue as language-runs. Each text node is a segment carrying its
    // own language decision; adjacent segments agreeing on language merge back
    // together so the audio does not fragment unnecessarily.
    function collectQueue() {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        var segs = [], node;
        while ((node = walker.nextNode())) {
            if (!/\S/.test(node.textContent)) { continue; }
            var el = node.parentElement;
            if (!el || el.closest(SKIP_SEL)) { continue; }
            if (!isVisible(el)) { continue; }
            var block = el.closest(BLOCK_PRIMARY) || el.closest(BLOCK_FALLBACK) || root;
            var text = node.textContent.replace(/\s+/g, " ");
            if (!text.trim()) { continue; }
            var d = classify(text, explicitLangOf(el), pageLang, targetLangs);
            segs.push({ block: block, el: el, text: text, lang: d.lang, tier: d.tier });
        }

        // Extend a target-language run into the English text node that follows it.
        var expanded = [];
        segs.forEach(function (s) {
            var prev = expanded[expanded.length - 1];
            if (prev && prev.block === s.block && s.lang === pageLang && prev.lang !== pageLang) {
                var split = splitLeadingRun(s.text, prev.lang);
                if (split) {
                    expanded.push({ block: s.block, el: s.el, text: split.head,
                                    lang: prev.lang, tier: "continuation" });
                    if (/\S/.test(split.tail)) {
                        expanded.push({ block: s.block, el: s.el, text: split.tail,
                                        lang: pageLang, tier: "default" });
                    }
                    return;
                }
            }
            expanded.push(s);
        });

        // Merge neighbours that share a block and a language.
        var merged = [];
        expanded.forEach(function (s) {
            var last = merged[merged.length - 1];
            if (last && last.block === s.block && last.lang === s.lang) {
                last.text += s.text;
                if (s.tier !== "default") { last.tier = s.tier; }
            } else {
                merged.push({ block: s.block, el: s.el, text: s.text, lang: s.lang, tier: s.tier });
            }
        });

        // Sentence-split within each run; a run in a non-default language is
        // usually a word or phrase and is spoken whole.
        var q = [];
        merged.forEach(function (run) {
            var clean = run.text.replace(/\s+/g, " ").trim();
            if (!clean) { return; }
            if (run.lang !== pageLang) {
                q.push({ el: run.block, text: clean, lang: run.lang, tier: run.tier });
                return;
            }
            var guarded = protectPeriods(clean);
            var parts = guarded.match(/[^.!?]+[.!?]+[”"')\]]*\s*|[^.!?]+$/g) || [guarded];
            parts.forEach(function (s) {
                s = restorePeriods(s).trim();
                if (s) { q.push({ el: run.block, text: s, lang: run.lang, tier: run.tier }); }
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
        u.lang = item.lang;
        var v = pickVoice(item.lang);
        if (v) { u.voice = v; }
        u.onend = function () { if (stopping) { return; } idx++; speakNext(); };
        u.onerror = function (e) {
            if (stopping || e.error === "canceled" || e.error === "interrupted") { return; }
            idx++; speakNext();
        };
        currentUtterance = u;
        window.speechSynthesis.speak(u);
        statusEl.textContent = "Reading… " + (idx + 1) + " / " + queue.length;
    }

    function finish(message) {
        playing = false; paused = false;
        clearHighlight();
        playBtn.textContent = LABEL_PLAY;
        stopBtn.disabled = true;
        statusEl.textContent = message || "";
        currentUtterance = null;
    }

    function start() {
        queue = collectQueue();
        if (!queue.length) { statusEl.textContent = "Nothing to read on this page."; return; }
        idx = 0; stopping = false; playing = true; paused = false;
        window.speechSynthesis.cancel();
        playBtn.textContent = LABEL_PAUSE;
        stopBtn.disabled = false;
        speakNext();
    }

    // Report which target languages this device can actually speak, so a
    // missing voice is diagnosed in seconds rather than guessed at.
    function reportVoices() {
        loadVoices();
        var lines = [pageLang].concat(targetLangs).map(function (l) {
            var v = pickVoice(l);
            return l + ": " + (v ? v.name + " [" + v.lang + "]" : "NO VOICE INSTALLED");
        });
        statusEl.textContent = lines.join("  ·  ");
        if (window.console) { console.log("[read-aloud] voices:\n" + lines.join("\n")); }
    }

    function runDebug() {
        var q = collectQueue();
        var counts = {};
        q.forEach(function (i) {
            var k = i.lang + "/" + i.tier;
            counts[k] = (counts[k] || 0) + 1;
            if (i.lang !== pageLang && i.el) { i.el.classList.add("ora-dbg-es"); }
        });
        if (window.console) {
            console.log("[read-aloud] AUDIT — " + q.length + " utterances");
            console.table(counts);
            console.log(q.filter(function (i) { return i.lang !== pageLang; })
                         .map(function (i) { return i.tier + " → " + i.lang + " : " + i.text; }));
        }
        statusEl.textContent = "Audit: " + q.length + " utterances, " +
            q.filter(function (i) { return i.lang !== pageLang; }).length + " in a target language";
        window.__oraAudit = q;
    }

    // Which languages this course may switch into. DETECTION IS OPT-IN PER COURSE:
    // declared in the include line as read-aloud.js?target=es (or data-ra-targets
    // on the root). With nothing declared, no detection runs at all and the page
    // is read in its own language.
    //
    // This matters on Latin pages. Latin shares short words with Spanish and
    // French — "et", "de", "que", "tu" — so a fleet-wide detector with every
    // language switched on would read Latin phrases in a French voice. A Latin
    // course simply declares no targets. An explicit lang= attribute is still
    // honoured either way, because markup always outranks detection.
    function declaredTargets() {
        var tag = document.querySelector('script[src*="read-aloud"]');
        var src = tag ? (tag.getAttribute("src") || "") : "";
        var m = /[?&]target=([a-z,\-]+)/i.exec(src);
        var raw = m ? m[1] : (root.getAttribute("data-ra-targets") || "");
        return raw.split(",")
                  .map(function (x) { return x.trim().toLowerCase().split("-")[0]; })
                  .filter(function (x) { return x && x !== pageLang && DIACRITIC[x]; });
    }

    function boot() {
        root = document.querySelector("[data-readaloud-root]")
            || document.querySelector(".canvas-frame")
            || document.body;
        if (!root) { return; }

        pageLang = String(root.getAttribute("data-ra-lang")
                    || document.documentElement.getAttribute("lang") || "en")
                   .toLowerCase().split("-")[0];
        targetLangs = declaredTargets();

        var style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        var panel = document.createElement("div");
        panel.id = "optima-read-aloud";
        panel.innerHTML = PANEL;
        root.insertBefore(panel, root.firstChild);

        playBtn = document.getElementById("ora-play");
        stopBtn = document.getElementById("ora-stop");
        rateSel = document.getElementById("ora-rate");
        statusEl = document.getElementById("ora-status");
        voicesBtn = document.getElementById("ora-voices");

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

        rateSel.addEventListener("change", function () {
            if (!playing || paused) { return; }
            stopping = true;
            window.speechSynthesis.cancel();
            setTimeout(function () { stopping = false; speakNext(); }, 60);
        });

        voicesBtn.addEventListener("click", reportVoices);

        window.addEventListener("pagehide", function () {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        });

        if (DEBUG) { runDebug(); }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
