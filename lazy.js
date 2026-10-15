/*!
 * Lazy loading component v1.0.4
 *
 * @author Serge Galich <gaserge@mail.ru>
 * @copyright 2025
 * @license MIT
 * @website http://qujs.ru/lazy/
 *
 * @requires Qu
 */

(function (window, document) {
    'use strict';

    const LIB_NAME = 'Lazy';
    const DATA_PREFIX = 'qu-lazy';
    const ANIM_ATTR = 'data-qu-animation-open';
    const OPENING_ATTR = 'data-qu-opening';
    const CLOSE_ATTR = 'data-qu-animation-close';
    const CLOSING_ATTR = 'data-qu-closing';

    if (window.Qu && window.Qu[LIB_NAME]) {
        window.Qu.debug(`⚠️ [${LIB_NAME}] Already registered, skipping duplicate`);
        return;
    }

    let Qu = null;

    const Module = {
        name: LIB_NAME,
        _debug: false,
        _initOnce: false,

        _useObserver: false,
        _observers: null,      // Map<rootMargin|threshold, IntersectionObserver>
        _elObservers: null,
        _states: null,         // WeakMap<el, state>
        _durationCache: null,  // Map<'open|name'|'close|name', ms>

        _imgCallbacks: new WeakMap(),
        _bgCallbacks: new WeakMap(),
        _assetCallbacks: new WeakMap(),

        _config: {
            selector: 'img[loading="lazy"]',
            loadedClass: 'lazyloaded',
            repeatSelector: '[data-qu-lazy-repeat-bg]',
            blockSelector: '[data-qu-lazy-block]',
            assetSelector: '[data-qu-lazy-css], [data-qu-lazy-js]',

            bgPatternVar: '--bg-pattern',
            bgPatternVars: ['--bg-pattern-1', '--bg-pattern-2', '--bg-pattern-3', '--bg-pattern-4', '--bg-pattern-5'],

            threshold: 0,
            rootMargin: '-50px 0 -50px 0',
            useVisibilityCheck: true,

            animationOpen: null,
            animationClose: null, // НЕОБХОДИМО ПОСЛЕДНИМ КАДРОМ TRANSFORM NONE, ИЛИ ЛАГИ НА ГРАНИЦЕ

            // сколько ждать стабилизации состояния (мс)
            settleDelay: 180,
            immediateDelay: 120, 

            // если null — читать из CSS; иначе — фиксированная длительность (мс)
            animationDuration: null,
            immediateAnimation: false,  // true → не ждать окончания текущей анимации, переключаться сразу

            assetRootMargin: '500px',
            assetLoadedClass: 'qu-assets-loaded',
            assetLoadingClass: 'qu-assets-loading',
            assetOptions: {},

            fireEventOnLoad: true,
        },

        _setData: function(el, name, value, prefix = DATA_PREFIX) {
            const attrName = `data-${prefix}-${name}`;
            if (value === undefined) el.setAttribute(attrName, '');
            else el.setAttribute(attrName, value);
        },

        _getData: function(el, name, prefix = DATA_PREFIX) {
            if (!el || typeof el.getAttribute !== 'function') return null;
            return el.getAttribute(`data-${prefix}-${name}`);
        },

        _hasData: function(el, name, prefix = DATA_PREFIX) {
            if (!el || typeof el.hasAttribute !== 'function') return false;
            return el.hasAttribute(`data-${prefix}-${name}`);
        },

        config: function(options) {
            Object.assign(this._config, options);
            return this;
        },

        _Qu: {
            debug: function(...args) {
                if (Qu && Qu.debug) return Qu.debug(...args);
                console.log(...args);
            },
        },

        debug: function(...args) {
            if (!this._debug) return;
            this._Qu.debug(...args);
        },

        use: function (fn) {
            if (typeof fn === 'function') fn(this);
        },

        extend: function () {
            if (Array.isArray(window[LIB_NAME + 'Extend'])) {
                window[LIB_NAME + 'Extend'].forEach((fn) => this.use(fn));
                window[LIB_NAME + 'Extend'] = [];
            }
        },

        loaded: function(quInstance) {
            Qu = quInstance;
            this.extend();
            this.debug(`📗 [${LIB_NAME}] loaded`);
        },

        initOnce: function(params = {}) {
            if (this._initOnce === true) return;
            this._initOnce = true;

            this.config(params);
            this._elObservers = new WeakMap();
            this._states = new WeakMap();
            this._observers = new Map();

            if (this._config.useVisibilityCheck && 'IntersectionObserver' in window) {
                this._useObserver = true;
                this.initLazyWithObserver();
                this.initRepeatPatternsWithObserver();
                this.initAssetsWithObserver();
                this.initBlocksWithObserver();
            } else {
                this.initLazyImageFade();
                this.initLazyRepeatPatterns();
                this.initAssetsFallback();
                this.initBlocksFallback();
            }

            new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.removedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            this._unobserveElement(node);
                            node.querySelectorAll('*').forEach((child) => this._unobserveElement(child));
                        }
                    });
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType !== 1) return;
                        if (!this._useObserver) return;
                        this.initLazyWithObserver(node);
                        this.initRepeatPatternsWithObserver(node);
                        this.initAssetsWithObserver(node);
                        this.initBlocksWithObserver(node);
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        },

        _unobserveElement: function(el) {
            const obs = this._elObservers && this._elObservers.get(el);
            if (obs) {
                obs.unobserve(el);
                this._elObservers.delete(el);
            }
            const st = this._states && this._states.get(el);
            if (st) {
                clearTimeout(st.animTimer);
                clearTimeout(st.settleTimer);
                this._states.delete(el);
            }
            this._imgCallbacks.delete(el);
            this._bgCallbacks.delete(el);
            this._assetCallbacks.delete(el);
        },

        init: function(quInstance, params = {}) {
            this.initOnce(params);
            this.config(params);
        },

        /* ============================================================
         *  STATE
         * ============================================================ */

        _getState: function(el) {
            if (!this._states) this._states = new WeakMap();
            let st = this._states.get(el);
            if (!st) {
                st = {
                    lastIsIn: null,     // true/false/null
                    animState: 'idle',  // 'idle' | 'open' | 'close'
                    animTimer: null,
                    settleTimer: null,
                    pending: null       // 'open' | 'close' | null
                };
                this._states.set(el, st);
            }
            return st;
        },

        /* ============================================================
         *  ANIMATION
         * ============================================================ */

        _prepareAnimation: function(el) {
            if (!el.hasAttribute(ANIM_ATTR) && this._config.animationOpen) {
                el.setAttribute(ANIM_ATTR, this._config.animationOpen);
            }
            if (!el.hasAttribute(CLOSE_ATTR) && this._config.animationClose) {
                el.setAttribute(CLOSE_ATTR, this._config.animationClose);
            }
            return el.hasAttribute(ANIM_ATTR);
        },

        _resolveDuration: function(el, action) {
            if (this._config.animationDuration != null) return this._config.animationDuration;

            if (!this._durationCache) this._durationCache = new Map();

            const name = el.getAttribute(action === 'open' ? ANIM_ATTR : CLOSE_ATTR) || '';
            const key = action + '|' + name;
            if (this._durationCache.has(key)) return this._durationCache.get(key);

            const cs = getComputedStyle(el);
            let maxMs = 0;

            const td = cs.transitionDuration;
            if (td && td !== 'none') {
                for (const s of td.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }

            const ad = cs.animationDuration;
            if (ad && ad !== 'none') {
                for (const s of ad.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }

            if (!maxMs || maxMs < 50) maxMs = 400;

            this._durationCache.set(key, maxMs);
            return maxMs;
        },

        _resolveDuration: function(el, action) {
            if (this._config.animationDuration != null) return this._config.animationDuration;
            if (!this._durationCache) this._durationCache = new Map();
        
            const name = el.getAttribute(action === 'open' ? ANIM_ATTR : CLOSE_ATTR) || '';
            const key = action + '|' + name;
            if (this._durationCache.has(key)) return this._durationCache.get(key);
        
            const cs = getComputedStyle(el);
            let maxMs = 0;
        
            const td = cs.transitionDuration;
            if (td && td !== 'none') {
                for (const s of td.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }
        
            const ad = cs.animationDuration;
            if (ad && ad !== 'none') {
                for (const s of ad.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }
        
            // ← НОВОЕ: учитываем animation-delay
            const dl = cs.animationDelay;
            if (dl && dl !== 'none') {
                let delayMax = 0;
                for (const s of dl.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > delayMax) delayMax = ms;
                }
                maxMs += delayMax;
            }
        
            if (!maxMs || maxMs < 50) maxMs = 400;
            this._durationCache.set(key, maxMs);
            return maxMs;
        },

        _resolveDuration: function(el, action) {
            if (this._config.animationDuration != null) return this._config.animationDuration;
            if (!this._durationCache) this._durationCache = new Map();
        
            const name = el.getAttribute(action === 'open' ? ANIM_ATTR : CLOSE_ATTR) || '';
            const cs = getComputedStyle(el);
        
            // КЛЮЧЕВОЕ: stagger у каждого элемента свой → он обязан быть в ключе
            const staggerVar = action === 'open' ? '--qua-stagger-open' : '--qua-stagger-close';
            const stagger = cs.getPropertyValue(staggerVar).trim() || '0s';
            const key = action + '|' + name + '|' + stagger;
        
            if (this._durationCache.has(key)) return this._durationCache.get(key);
        
            let maxMs = 0;
        
            const td = cs.transitionDuration;
            if (td && td !== 'none') {
                for (const s of td.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }
        
            const ad = cs.animationDuration;
            if (ad && ad !== 'none') {
                for (const s of ad.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > maxMs) maxMs = ms;
                }
            }
        
            const dl = cs.animationDelay;
            if (dl && dl !== 'none') {
                let delayMax = 0;
                for (const s of dl.split(',')) {
                    const t = s.trim();
                    const ms = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
                    if (isFinite(ms) && ms > delayMax) delayMax = ms;
                }
                maxMs += delayMax;
            }
        
            if (!maxMs || maxMs < 50) maxMs = 400;
            this._durationCache.set(key, maxMs);
            return maxMs;
        },

_animate: function(el, action) {
    const st = this._getState(el);
    const attr = action === 'open' ? OPENING_ATTR : CLOSING_ATTR;
    const opposite = action === 'open' ? CLOSING_ATTR : OPENING_ATTR;

    if (el.hasAttribute(attr) && !el.hasAttribute(opposite)) {
        //st.animState = 'idle';
        return;
    }

    const immediate = this._getData(el, 'immediate') !== null
        ? this._getData(el, 'immediate') !== 'false'
        : this._config.immediateAnimation;

    // снимаем с наблюдения — IO молчит пока идёт анимация
    // НО только если immediate=false. При immediate IO должен продолжать следить,
    // чтобы поймать разворот скролла прямо во время анимации
    if (!immediate) {
        const obs = this._elObservers && this._elObservers.get(el);
        if (obs) obs.unobserve(el);
    }

    st.animState = action;
    el.removeAttribute(opposite);
    el.setAttribute(attr, '');

    const duration = this._resolveDuration(el, action);

    clearTimeout(st.animTimer);
    st.animTimer = setTimeout(() => this._animDone(el, action), duration + 50);

    if (Qu && Qu.trigger) {
        Qu.trigger(el, 'qu:lazy:animation:start', {
            detail: { element: el, action, duration }
        });
    }
},
_animDone: function(el, action) {
    const st = this._getState(el);
    st.animState = 'idle';

    if (Qu && Qu.trigger) {
        Qu.trigger(el, 'qu:lazy:animation:end', {
            detail: { element: el, action }
        });
    }
    if (action === 'close') {
        el.removeAttribute(OPENING_ATTR);
        el.removeAttribute(CLOSING_ATTR);
    }

    // возвращаем наблюдение — IO выдаст свежий entry по финальной геометрии
    const obs = this._elObservers && this._elObservers.get(el);
    if (obs) {
        obs.unobserve(el);
        obs.observe(el);

        /* 
        requestAnimationFrame(() => requestAnimationFrame(() => {
            obs.observe(el);
        })); */
    }

    // если был pending и он отличается от того что только что доиграл
    if (st.pending && st.pending !== action) {
        const want = st.pending;
        st.pending = null;

        if ((want === 'open') === st.lastIsIn) {
            this._animate(el, want);
        }
    } else {
        st.pending = null;
    }
},

        _finish: function(el, config) {
            if (el.hasAttribute(ANIM_ATTR)) {
                this._animate(el, 'open');
            } else {
                el.classList.add(config.loadedClass);
            }
        },

        /* ============================================================
         *  INTERSECT + SETTLE
         * ============================================================ */

_onIntersect: function(el, entry, loadFn) {
    const st = this._getState(el);
    st.lastIsIn = entry.isIntersecting;

    const immediate = this._getData(el, 'immediate') !== null
        ? this._getData(el, 'immediate') !== 'false'
        : this._config.immediateAnimation;

    clearTimeout(st.settleTimer);
    st.settleTimer = setTimeout(
        () => this._settle(el, loadFn),
        immediate ? 0 : this._config.settleDelay
    );
},
/* 
_onIntersect: function(el, entry, loadFn) {
    const st = this._getState(el);
    st.lastIsIn = entry.isIntersecting;

    const immediate = this._getData(el, 'immediate') !== null
        ? this._getData(el, 'immediate') !== 'false'
        : this._config.immediateAnimation;

    // антидребезг нужен всегда — иначе на границе IO стреляет десятки раз в секунду
    // при immediate просто чуть меньше задержка
    const delay = immediate
        ? (this._config.immediateDelay || 120)
        : this._config.settleDelay;

    clearTimeout(st.settleTimer);
    st.settleTimer = setTimeout(() => this._settle(el, loadFn), delay);
}, */

_onIntersect: function(el, entry, loadFn) {
    const st = this._getState(el);
    st.lastIsIn = entry.isIntersecting;

    const immediate = this._getData(el, 'immediate') !== null
        ? this._getData(el, 'immediate') !== 'false'
        : this._config.immediateAnimation;

    // антидребезг обязателен, даже когда immediate=true
    const delay = immediate
        ? (this._config.immediateDelay || 120)
        : this._config.settleDelay;

    clearTimeout(st.settleTimer);
    st.settleTimer = setTimeout(() => this._settle(el, loadFn), delay);
},

_settle: function(el, loadFn) {
    const st = this._getState(el);
    const isIn = st.lastIsIn;

    // per-element: data-qu-lazy-immediate, иначе — из конфига
    const immediate = this._getData(el, 'immediate') !== null
        ? this._getData(el, 'immediate') !== 'false'
        : this._config.immediateAnimation;

    // если идёт анимация
    if (st.animState !== 'idle') {
        if (!immediate) {
            // старое поведение: ждём окончания, потом играем pending
            const want = isIn ? 'open' : 'close';
            if (st.animState !== want) {
                st.pending = want;
            } else {
                st.pending = null;
            }
            return;
        }
        // immediate: не выходим, идём переключать анимацию прямо сейчас
    }

    if (isIn) {
        if (el._quLazyLoaded) {
            this._animate(el, 'open');
        } else if (!el._quLazyLoading && loadFn) {
            el._quLazyLoading = true;
            loadFn();
        }
    } else if (el.hasAttribute(CLOSE_ATTR) && el.hasAttribute(OPENING_ATTR)) {
        this._animate(el, 'close');
    }
},

_settle: function(el, loadFn) {
    const st = this._getState(el);
    const isIn = st.lastIsIn;

    // Анимация идёт — не прерываем её ни при каком immediate.
    // Просто запоминаем, что нужно доиграть после.
    if (st.animState !== 'idle') {
        const want = isIn ? 'open' : 'close';
        if (st.animState !== want) {
            st.pending = want;
        } else {
            st.pending = null;
        }
        return;
    }

    if (isIn) {
        if (el._quLazyLoaded) {
            this._animate(el, 'open');
        } else if (!el._quLazyLoading && loadFn) {
            el._quLazyLoading = true;
            loadFn();
        }
    } else if (el.hasAttribute(CLOSE_ATTR) && el.hasAttribute(OPENING_ATTR)) {
        this._animate(el, 'close');
    }
},

        _unobserveIfDone: function(el) {
            if (el.hasAttribute(CLOSE_ATTR)) return; // следим дальше

            const o = this._elObservers && this._elObservers.get(el);
            if (o) o.unobserve(el);
            if (this._elObservers) this._elObservers.delete(el);
            this._imgCallbacks.delete(el);
            this._bgCallbacks.delete(el);
            this._assetCallbacks.delete(el);
        },

        _normalizeMargin: function(value) {
            if (value == null || value === '') return '0px';
        
            const s = String(value).trim();
            if (s === '0') return '0px';
        
            return s.split(/\s+/).map(function(part) {
                if (part === '0') return '0px';
                if (/^-?\d+(\.\d+)?$/.test(part)) return part + 'px';
                return part;
            }).join(' ');
        },

        /* ============================================================
         *  OBSERVER (единый для img / bg / block / asset)
         * ============================================================ */

        _getObserver: function(rootMargin, threshold) {
            if (!this._observers) this._observers = new Map();
            const safeMargin = this._normalizeMargin(rootMargin);
            const key = safeMargin + '|' + threshold;
            let obs = this._observers.get(key);
            if (obs) return obs;

            const self = this;
            obs = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    const el = entry.target;
                    const cb = self._imgCallbacks.get(el) ||
                               self._bgCallbacks.get(el) ||
                               self._assetCallbacks.get(el);
                    if (cb) cb(entry);
                });
            }, { threshold: threshold, rootMargin: safeMargin  });

            this._observers.set(key, obs);
            return obs;
        },

        /* ============================================================
         *  Element config
         * ============================================================ */

        _getElementConfig: function(el) {
            const config = {
                threshold: this._config.threshold,
                rootMargin: this._config.rootMargin,
                loadedClass: this._config.loadedClass,
                assetRootMargin: this._config.assetRootMargin,
                assetLoadedClass: this._config.assetLoadedClass,
                assetLoadingClass: this._config.assetLoadingClass,
                assetOptions: { ...this._config.assetOptions },
                fireEventOnLoad: this._config.fireEventOnLoad
            };

            const lazyThreshold = this._getData(el, 'threshold');
            if (lazyThreshold !== null) {
                const val = parseFloat(lazyThreshold);
                if (!isNaN(val)) config.threshold = val;
            }

            const lazyRootMargin = this._getData(el, 'root-margin');
            if (lazyRootMargin !== null && lazyRootMargin !== '') {
                config.rootMargin = lazyRootMargin;
                config.assetRootMargin = lazyRootMargin;
            }

            const lazyLoadedClass = this._getData(el, 'loaded-class');
            if (lazyLoadedClass !== null) {
                config.loadedClass = lazyLoadedClass;
                config.assetLoadedClass = lazyLoadedClass;
            }

            const lazyLoadingClass = this._getData(el, 'loading-class');
            if (lazyLoadingClass !== null) {
                config.assetLoadingClass = lazyLoadingClass;
            }

            const lazyOptions = this._getData(el, 'options');
            if (lazyOptions) {
                try {
                    const parsed = JSON.parse(lazyOptions);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        config.assetOptions = { ...config.assetOptions, ...parsed };
                    }
                } catch (e) {}
            }

            if (this._getData(el, 'fire-event') !== null) {
                config.fireEventOnLoad = this._getData(el, 'fire-event') !== 'false';
            }

            return config;
        },

        _parseBgUrls: function(el) {
            const data = this._getData(el, 'repeat-bg');
            if (!data) return null;
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) return parsed.filter(url => url && typeof url === 'string');
            } catch (e) { return [data]; }
            return [data];
        },

        _parseAssetUrls: function(el, type) {
            const raw = this._getData(el, type);
            if (!raw) return [];
            let items = [];
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) items = parsed;
                else if (typeof parsed === 'string') items = [parsed];
                else return [];
            } catch (e) { items = [raw]; }

            const config = this._getElementConfig(el);
            const globalOptions = config.assetOptions || {};
            return items
                .map(item => {
                    if (typeof item === 'string') return { url: item, options: { ...globalOptions } };
                    if (item && typeof item === 'object' && item.url) return { url: item.url, options: { ...globalOptions, ...item } };
                    return null;
                })
                .filter(Boolean);
        },

        /* ============================================================
         *  IMAGES
         * ============================================================ */

        initLazyWithObserver: function(root) {
            if (!this._useObserver) return;
            const scope = root || document;
            const lazyImages = [];
            if (scope.nodeType === 1 && scope.matches(this._config.selector)) lazyImages.push(scope);
            scope.querySelectorAll(this._config.selector).forEach(i => lazyImages.push(i));

            const self = this;

            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (this._imgCallbacks.has(img)) return;
                if (img._quLazyLoaded) return;

                this._prepareAnimation(img);

                const observer = this._getObserver(elConfig.rootMargin, elConfig.threshold);

                const loadFn = () => {
                    const onLoad = () => {
                        img._quLazyLoaded = true;
                        img._quLazyLoading = false;

                        self._finish(img, elConfig);

                        if (elConfig.fireEventOnLoad) {
                            Qu.trigger(img, 'qu:lazy:imageloaded', { detail: { element: img, config: elConfig } });
                        }

                        self._unobserveIfDone(img);
                    };

                    if (img.complete) onLoad();
                    else {
                        img.addEventListener('load', onLoad, { once: true });
                        img.addEventListener('error', onLoad, { once: true });
                    }
                };

                const callback = (entry) => self._onIntersect(img, entry, loadFn);

                this._imgCallbacks.set(img, callback);
                this._elObservers.set(img, observer);
                observer.observe(img);
            });
        },

        /* ============================================================
         *  BG PATTERNS
         * ============================================================ */

        initRepeatPatternsWithObserver: function(root) {
            if (!this._useObserver) return;
            const scope = root || document;
            const patterns = [];
            if (scope.nodeType === 1 && scope.matches(this._config.repeatSelector)) patterns.push(scope);
            scope.querySelectorAll(this._config.repeatSelector).forEach(i => patterns.push(i));

            const self = this;

            patterns.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.loadedClass)) return;
                if (this._bgCallbacks.has(el)) return;

                const urls = this._parseBgUrls(el);
                if (!urls || urls.length === 0) return;

                this._prepareAnimation(el);

                const observer = this._getObserver(elConfig.rootMargin, elConfig.threshold);

                const loadFn = () => {
                    const finish = () => {
                        el._quLazyLoaded = true;
                        el._quLazyLoading = false;
                        self._finish(el, elConfig);
                        self._unobserveIfDone(el);
                    };

                    if (urls.length === 1) {
                        const img = new Image();
                        img.onload = () => {
                            el.style.setProperty(self._config.bgPatternVar, `url('${urls[0]}')`);
                            finish();
                        };
                        img.onerror = () => { finish(); };
                        img.src = urls[0];
                    } else {
                        let loaded = 0;
                        urls.forEach((url, index) => {
                            const img = new Image();
                            img.onload = () => {
                                const varName = self._config.bgPatternVars[index] || `--bg-pattern-${index + 1}`;
                                el.style.setProperty(varName, `url('${url}')`);
                                loaded++;
                                if (loaded === urls.length) finish();
                            };
                            img.onerror = () => { loaded++; if (loaded === urls.length) finish(); };
                            img.src = url;
                        });
                    }
                };

                const callback = (entry) => self._onIntersect(el, entry, loadFn);

                this._bgCallbacks.set(el, callback);
                this._elObservers.set(el, observer);
                observer.observe(el);
            });
        },

        /* ============================================================
         *  ASSETS
         * ============================================================ */

        initAssetsWithObserver: function(root) {
            if (!this._useObserver) return;
            const selector = this._config.assetSelector;
            const scope = root || document;
            const blocks = [];
            if (scope.nodeType === 1 && scope.matches(selector)) blocks.push(scope);
            scope.querySelectorAll(selector).forEach(i => blocks.push(i));

            const self = this;

            blocks.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.assetLoadedClass)) return;
                if (this._assetCallbacks.has(el)) return;

                const cssAssets = this._parseAssetUrls(el, 'css');
                const jsAssets = this._parseAssetUrls(el, 'js');
                const allAssets = [...cssAssets, ...jsAssets];
                if (allAssets.length === 0) return;

                this._prepareAnimation(el);

                const observer = this._getObserver(elConfig.assetRootMargin, 0);

                const loadFn = () => {
                    const loadingClass = elConfig.assetLoadingClass;
                    if (loadingClass) el.classList.add(loadingClass);

                    const groups = new Map();
                    for (const asset of allAssets) {
                        const key = JSON.stringify(asset.options);
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key).push(asset.url);
                    }
                    const loads = [];
                    for (const [key, urls] of groups) {
                        const opts = JSON.parse(key);
                        loads.push(Qu.loadAssets(urls, { waitForLoad: true, ...opts }));
                    }

                    Promise.allSettled(loads)
                        .then(() => {
                            if (loadingClass) el.classList.remove(loadingClass);
                            el.classList.add(elConfig.assetLoadedClass);

                            el._quLazyLoaded = true;
                            el._quLazyLoading = false;

                            self._finish(el, elConfig);

                            if (elConfig.fireEventOnLoad) {
                                Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                            }

                            self._unobserveIfDone(el);
                        })
                        .catch(() => {
                            if (loadingClass) el.classList.remove(loadingClass);
                            el._quLazyLoading = false;
                            self._unobserveIfDone(el);
                        });
                };

                const callback = (entry) => self._onIntersect(el, entry, loadFn);

                this._assetCallbacks.set(el, callback);
                this._elObservers.set(el, observer);
                observer.observe(el);
            });
        },

        /* ============================================================
         *  BLOCKS
         * ============================================================ */

        initBlocksWithObserver: function(root) {
            if (!this._useObserver) return;

            const scope = root || document;
            const blocks = [];
            if (scope.nodeType === 1 && scope.matches(this._config.blockSelector)) blocks.push(scope);
            scope.querySelectorAll(this._config.blockSelector).forEach(i => blocks.push(i));

            const self = this;

            blocks.forEach(el => {
                if (this._bgCallbacks.has(el)) return;
                if (el._quLazyLoaded) return;

                this._prepareAnimation(el);

                const elConfig = this._getElementConfig(el);
                const observer = this._getObserver(elConfig.rootMargin, elConfig.threshold);

                const loadFn = () => {
                    el._quLazyLoaded = true;
                    el._quLazyLoading = false;

                    self._finish(el, elConfig);

                    if (elConfig.fireEventOnLoad) {
                        Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                    }

                    self._unobserveIfDone(el);
                };

                const callback = (entry) => self._onIntersect(el, entry, loadFn);

                this._bgCallbacks.set(el, callback);
                this._elObservers.set(el, observer);
                observer.observe(el);
            });
        },

        /* ============================================================
         *  FALLBACK (без IntersectionObserver)
         * ============================================================ */

        initAssetsFallback: function() {
            const blocks = document.querySelectorAll(this._config.assetSelector);
            const self = this;
            blocks.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.assetLoadedClass)) return;
                const cssAssets = this._parseAssetUrls(el, 'css');
                const jsAssets = this._parseAssetUrls(el, 'js');
                const allAssets = [...cssAssets, ...jsAssets];
                if (allAssets.length === 0) return;

                this._prepareAnimation(el);

                const loadingClass = elConfig.assetLoadingClass;
                if (loadingClass) el.classList.add(loadingClass);

                const groups = new Map();
                for (const asset of allAssets) {
                    const key = JSON.stringify(asset.options);
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(asset.url);
                }
                const loads = [];
                for (const [key, urls] of groups) {
                    const opts = JSON.parse(key);
                    loads.push(Qu.loadAssets(urls, { waitForLoad: true, ...opts }));
                }

                Promise.allSettled(loads)
                    .then(() => {
                        if (loadingClass) el.classList.remove(loadingClass);
                        el.classList.add(elConfig.assetLoadedClass);
                        self._finish(el, elConfig);
                        if (elConfig.fireEventOnLoad) {
                            Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                        }
                    })
                    .catch(() => { if (loadingClass) el.classList.remove(loadingClass); });
            });
        },

        initLazyRepeatPatterns: function() {
            const patterns = document.querySelectorAll(this._config.repeatSelector);
            const self = this;
            patterns.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.loadedClass)) return;
                const urls = this._parseBgUrls(el);
                if (!urls || urls.length === 0) return;

                this._prepareAnimation(el);

                const onComplete = () => self._finish(el, elConfig);

                if (urls.length === 1) {
                    const img = new Image();
                    img.onload = () => {
                        el.style.setProperty(this._config.bgPatternVar, `url('${urls[0]}')`);
                        onComplete();
                    };
                    img.onerror = () => { onComplete(); };
                    img.src = urls[0];
                } else {
                    let loaded = 0;
                    urls.forEach((url, index) => {
                        const img = new Image();
                        img.onload = () => {
                            const varName = self._config.bgPatternVars[index] || `--bg-pattern-${index + 1}`;
                            el.style.setProperty(varName, `url('${url}')`);
                            loaded++;
                            if (loaded === urls.length) onComplete();
                        };
                        img.onerror = () => { loaded++; if (loaded === urls.length) onComplete(); };
                        img.src = url;
                    });
                }
            });
        },

        initBlocksFallback: function() {
            const blocks = document.querySelectorAll(this._config.blockSelector);
            const self = this;
            blocks.forEach(el => {
                const elConfig = this._getElementConfig(el);
                this._prepareAnimation(el);
                self._finish(el, elConfig);
                if (elConfig.fireEventOnLoad) {
                    Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                }
            });
        },

        initLazyImageFade: function() {
            const lazyImages = document.querySelectorAll(this._config.selector);
            const self = this;
            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (img.classList.contains(elConfig.loadedClass)) return;

                this._prepareAnimation(img);

                const onLoad = () => {
                    self._finish(img, elConfig);
                    if (elConfig.fireEventOnLoad) {
                        Qu.trigger(img, 'qu:lazy:imageloaded', { detail: { element: img, config: elConfig } });
                    }
                };

                if (img.complete) onLoad();
                else {
                    img.addEventListener('load', onLoad);
                    img.addEventListener('error', onLoad);
                }
            });
        },

        setAnimation: function(enable) {
            this._config.animationOpen = enable ? (this._config.animationOpen || 'fade') : null;
        },

        showAllImagesImmediately: function() {
            const lazyImages = document.querySelectorAll(this._config.selector);
            const self = this;
            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (img.classList.contains(elConfig.loadedClass)) return;
                self._finish(img, elConfig);
            });
        }
    };

    if (window.Qu) {
        window.Qu.lib(LIB_NAME, Module);
    } else {
        window._QuLibs = window._QuLibs || [];
        window._QuLibs.push({ name: LIB_NAME, instance: Module });
    }

})(window, document);