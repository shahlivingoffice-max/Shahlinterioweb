/* =====================================================================
   SECUREX MOTION ENGINE
   Shared by index.html and product/index.html.
   Vanilla, dependency-free. Everything degrades to a static page if this
   file fails to load — the .js-on gate in the stylesheets guarantees it.
   ===================================================================== */
(function () {
    'use strict';

    var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mqFine   = window.matchMedia('(hover: hover) and (pointer: fine)');
    var reduced  = mqReduce.matches;
    var fine     = mqFine.matches;

    /* ---------------------------------------------------------------
       1. Word-by-word headline reveal
       --------------------------------------------------------------- */
    /* Undo a previous split so re-splitting edited copy can't nest wrappers. */
    function unsplitWords(el) {
        var wrapped = el.querySelectorAll('.rw');
        if (!wrapped.length) return;
        Array.prototype.forEach.call(wrapped, function (span) {
            span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
        });
        el.normalize();
    }

    function splitWords(el) {
        if (el.__splitText === el.textContent) return;
        unsplitWords(el);

        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [], node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue.trim()) nodes.push(node);
        }
        if (!nodes.length) return;

        var index = 0;
        nodes.forEach(function (textNode) {
            var frag = document.createDocumentFragment();
            textNode.nodeValue.split(/(\s+)/).forEach(function (token) {
                if (!token) return;
                if (!token.trim()) { frag.appendChild(document.createTextNode(' ')); return; }
                var word = document.createElement('span');
                word.className = 'rw';
                word.style.setProperty('--wi', index++);
                var inner = document.createElement('i');
                inner.textContent = token;
                word.appendChild(inner);
                frag.appendChild(word);
            });
            textNode.parentNode.replaceChild(frag, textNode);
        });

        el.__splitText = el.textContent;
        if (el.dataset.wdelay) el.style.setProperty('--wdelay', el.dataset.wdelay);
    }

    var splitObs = 'IntersectionObserver' in window
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) entry.target.classList.add('split-in');
            });
        }, { rootMargin: '0px 0px -60px 0px', threshold: 0.15 })
        : null;

    function initSplits(root) {
        (root || document).querySelectorAll('[data-split]').forEach(function (el) {
            if (el.dataset.splitOn === 'ready') {
                // Hold off until the ready gate: splitting earlier would fight the
                // CMS loader, which rewrites some headline text after first paint.
                if (!document.body.classList.contains('is-ready')) return;
                splitWords(el);
                el.classList.add('split-in');
                return;
            }
            splitWords(el);
            if (splitObs) { splitObs.unobserve(el); splitObs.observe(el); }
            else el.classList.add('split-in');
        });
    }

    /* ---------------------------------------------------------------
       2. Scroll reveal + grid stagger
       --------------------------------------------------------------- */
    var revealObs = 'IntersectionObserver' in window
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('visible');
                revealObs.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -40px 0px', threshold: 0.1 })
        : null;

    var STAGGER_GRIDS = '.features-grid,.why-grid,.gallery-grid,.stats-grid,.product-grid,.about-highlights';

    function initReveals(root) {
        var scope = root || document;

        scope.querySelectorAll(STAGGER_GRIDS).forEach(function (grid) {
            var i = 0;
            Array.prototype.forEach.call(grid.children, function (child) {
                if (child.classList.contains('reveal')) child.style.setProperty('--rd', (i++ * 80) + 'ms');
            });
        });

        scope.querySelectorAll('.reveal:not(.visible)').forEach(function (el) {
            if (revealObs) revealObs.observe(el);
            else el.classList.add('visible');
        });
    }

    /* ---------------------------------------------------------------
       3. Pointer-tracked card tilt + spotlight
       --------------------------------------------------------------- */
    function attachTilt(el) {
        if (el.__tilt || !fine || reduced) return;
        el.__tilt = true;

        var rect = null, frame = null, px = 0.5, py = 0.5;

        el.addEventListener('pointerenter', function () {
            rect = el.getBoundingClientRect();
            el.classList.add('is-tilting');
        });

        el.addEventListener('pointermove', function (e) {
            if (!rect) rect = el.getBoundingClientRect();
            px = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
            py = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
            if (frame) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
                el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
                el.style.transform =
                    'perspective(900px) rotateX(' + ((0.5 - py) * 6).toFixed(2) + 'deg)' +
                    ' rotateY(' + ((px - 0.5) * 8).toFixed(2) + 'deg)' +
                    ' translate3d(0,-8px,0) scale(1.015)';
            });
        });

        el.addEventListener('pointerleave', function () {
            if (frame) { cancelAnimationFrame(frame); frame = null; }
            el.classList.remove('is-tilting');
            el.style.transform = '';
            rect = null;
        });
    }

    /* ---------------------------------------------------------------
       4. Magnetic buttons
       --------------------------------------------------------------- */
    function attachMagnetic(el) {
        if (el.__magnetic || !fine || reduced) return;
        el.__magnetic = true;

        // Keep each button's own CSS hover lift inside the JS transform,
        // otherwise the inline style would cancel it mid-hover.
        var lift = el.classList.contains('btn') ? -4 : -2;
        var scale = el.classList.contains('btn') ? 1.02 : 1;
        var rect = null, frame = null, dx = 0, dy = 0;

        el.addEventListener('pointerenter', function () { rect = el.getBoundingClientRect(); });

        el.addEventListener('pointermove', function (e) {
            if (!rect) rect = el.getBoundingClientRect();
            dx = (e.clientX - (rect.left + rect.width / 2)) * 0.22;
            dy = (e.clientY - (rect.top + rect.height / 2)) * 0.28;
            dx = Math.min(Math.max(dx, -9), 9);
            dy = Math.min(Math.max(dy, -6), 6);
            if (frame) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                el.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + (dy + lift).toFixed(1) + 'px,0) scale(' + scale + ')';
            });
        });

        el.addEventListener('pointerleave', function () {
            if (frame) { cancelAnimationFrame(frame); frame = null; }
            el.style.transform = '';
            rect = null;
        });
    }

    /* ---------------------------------------------------------------
       5. Press ripple
       --------------------------------------------------------------- */
    function attachRipple(el) {
        if (el.__ripple || reduced) return;
        el.__ripple = true;

        el.addEventListener('pointerdown', function (e) {
            var rect = el.getBoundingClientRect();
            var size = Math.max(rect.width, rect.height);
            var ink = document.createElement('span');
            ink.className = 'ripple';
            ink.style.width = ink.style.height = size + 'px';
            ink.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ink.style.top  = (e.clientY - rect.top  - size / 2) + 'px';
            el.appendChild(ink);
            setTimeout(function () { if (ink.parentNode) ink.parentNode.removeChild(ink); }, 620);
        });
    }

    function initInteractions(root) {
        var scope = root || document;
        scope.querySelectorAll('.tilt').forEach(attachTilt);
        scope.querySelectorAll('[data-magnetic]').forEach(attachMagnetic);
        scope.querySelectorAll('.btn, .btn-nav, .btn-submit, .product-enquiry, .filter-btn').forEach(attachRipple);
    }

    /* ---------------------------------------------------------------
       6. Scroll rail, back-to-top ring, hero parallax
       --------------------------------------------------------------- */
    var progressBar = document.getElementById('scroll-progress');
    var toTopBtn    = document.getElementById('toTop');
    var toTopFill   = document.getElementById('ttFill');
    var heroContent = document.querySelector('.hero .hero-content');
    var RING_LENGTH = 151;   // 2πr for r=24
    var scrollQueued = false;

    function readScroll() {
        scrollQueued = false;
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var ratio = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;

        if (progressBar) progressBar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
        if (toTopFill)   toTopFill.style.strokeDashoffset = (RING_LENGTH * (1 - ratio)).toFixed(1);
        if (toTopBtn)    toTopBtn.classList.toggle('is-visible', window.scrollY > 520);

        if (heroContent && !reduced) {
            var vh = window.innerHeight;
            if (window.scrollY < vh) {
                heroContent.style.transform = 'translate3d(0,' + (window.scrollY * 0.18).toFixed(1) + 'px,0)';
                heroContent.style.opacity = Math.max(0, 1 - window.scrollY / (vh * 0.85)).toFixed(3);
            }
        }
    }

    function onScroll() {
        if (scrollQueued) return;
        scrollQueued = true;
        requestAnimationFrame(readScroll);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    if (toTopBtn) {
        toTopBtn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        });
    }

    /* ---------------------------------------------------------------
       7. Cursor halo — idles itself once the pointer settles
       --------------------------------------------------------------- */
    (function cursorHalo() {
        var halo = document.getElementById('cursor-halo');
        if (!halo || !fine || reduced) return;

        var tx = 0, ty = 0, x = 0, y = 0, scale = 1, targetScale = 1;
        var running = false, seen = false;

        function loop() {
            x += (tx - x) * 0.18;
            y += (ty - y) * 0.18;
            scale += (targetScale - scale) * 0.2;
            halo.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')';

            if (Math.abs(tx - x) < 0.3 && Math.abs(ty - y) < 0.3 && Math.abs(targetScale - scale) < 0.005) {
                running = false;   // settled: stop burning frames until the pointer moves again
                return;
            }
            requestAnimationFrame(loop);
        }

        function wake() {
            if (running) return;
            running = true;
            requestAnimationFrame(loop);
        }

        document.addEventListener('pointermove', function (e) {
            tx = e.clientX; ty = e.clientY;
            if (!seen) { seen = true; x = tx; y = ty; halo.classList.add('is-on'); }
            wake();
        }, { passive: true });

        document.addEventListener('pointerover', function (e) {
            var hot = !!(e.target.closest &&
                e.target.closest('a,button,[role="button"],input,textarea,select,.tilt,.contact-detail'));
            halo.classList.toggle('is-hot', hot);
            targetScale = hot ? 1.45 : 1;
            wake();
        }, { passive: true });

        document.addEventListener('pointerdown', function () { targetScale = 0.8; wake(); }, { passive: true });
        document.addEventListener('pointerup',   function () { targetScale = halo.classList.contains('is-hot') ? 1.45 : 1; wake(); }, { passive: true });
        document.addEventListener('pointerleave', function () { halo.classList.remove('is-on'); }, { passive: true });
        document.addEventListener('pointerenter', function () { if (seen) halo.classList.add('is-on'); }, { passive: true });
    })();

    /* ---------------------------------------------------------------
       8. Capability marquee
       --------------------------------------------------------------- */
    (function marquee() {
        var track = document.getElementById('marqueeTrack');
        if (!track) return;

        var items = [
            'Fiber Laser Cutting', 'CNC Bending', 'Powder Coated Finish', 'Rust Resistant Build',
            'Bulk B2B Orders', 'Custom Dimensions', 'Glossy Finishing Unit', 'Factory Direct Pricing'
        ];

        var half = items.map(function (label) {
            return '<span class="marquee-item">' + label + '</span><span class="marquee-dot"></span>';
        }).join('');

        track.innerHTML = half + half;   // duplicated so the -50% loop is seamless
    })();

    /* ---------------------------------------------------------------
       9. Ready gate — hero choreography starts when the splash clears
       --------------------------------------------------------------- */
    var readyFired = false;

    function markReady() {
        if (readyFired) return;
        readyFired = true;
        document.body.classList.add('is-ready');
        document.querySelectorAll('[data-split][data-split-on="ready"]').forEach(function (el) {
            splitWords(el);
            el.classList.add('split-in');
        });
    }

    function boot() {
        initSplits();
        initReveals();
        initInteractions();
        readScroll();

        if (document.getElementById('splash-screen')) {
            document.addEventListener('securex:splash-end', markReady);
            setTimeout(markReady, 6000);   // failsafe if the splash never reports in
        } else {
            markReady();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    /* Re-arm everything for DOM injected later (Supabase content, filters). */
    window.SecurexMotion = {
        refresh: function (root) {
            initSplits(root);
            initReveals(root);
            initInteractions(root);
        }
    };

    document.addEventListener('securex:content-ready', function (e) {
        window.SecurexMotion.refresh(e.detail && e.detail.root);
    });
})();
