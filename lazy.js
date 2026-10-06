/*!
 * Lazy loading component v1.0.2
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
    const QU_PREFIX = 'qu';

    if (window.Qu && window.Qu[LIB_NAME]) {
        window.Qu.debug(`⚠️ [${LIB_NAME}] Already registered, skipping duplicate`);
        return;
    }

    let Qu = null;
    
    const Module = {
        name: LIB_NAME,
        _debug: false,
        _initOnce: false,

        _imgObserver: null,
        _bgObserver: null,
        _assetObserver: null,

        _imgCallbacks: new WeakMap(),
        _bgCallbacks: new WeakMap(),
        _assetCallbacks: new WeakMap(),

        _config: {
            selector: 'img[loading="lazy"]',
            loadedClass: 'lazyloaded',
            noAnimationClass: 'no-lazyloaded',
            repeatSelector: '[data-qu-lazy-repeat-bg]',
            bgPatternVar: '--bg-pattern', 
            bgPatternVars: ['--bg-pattern-1', '--bg-pattern-2', '--bg-pattern-3', '--bg-pattern-4', '--bg-pattern-5'],
            threshold: 0,
            rootMargin: '-50px',
            useVisibilityCheck: true,
            useAnimation: true,
            
            assetRootMargin: '500px',
            assetLoadedClass: 'qu-assets-loaded',
            assetLoadingClass: 'qu-assets-loading',
            assetOptions: {},

            fireEventOnLoad: true,
        },

        _setData: function(el, name, value, prefix = DATA_PREFIX) {
            const attrName = `data-${prefix}-${name}`;
            if (value === undefined) {
                el.setAttribute(attrName, '');
            } else {
                el.setAttribute(attrName, value);
            }
        },

        _getData: function(el, name, prefix = DATA_PREFIX) {
            if (!el || typeof el.getAttribute !== 'function') {
                return null;
            }
            return el.getAttribute(`data-${prefix}-${name}`);
        },

        _hasData: function(el, name, prefix = DATA_PREFIX) {
            if (!el || typeof el.hasAttribute !== 'function') {
                return false;
            }
            return el.hasAttribute(`data-${prefix}-${name}`);
        },

        config: function(options) {
            Object.assign(this._config, options);
            return this;
        },

        _Qu: {
            debug: function(...args) {
                if (Qu && Qu.debug) return Qu.debug(...args);
                console.log(...args)
            },
        },

        debug: function(...args) {
            if(!this._debug) return;
            this._Qu.debug(...args);
        },

        use: function (fn) {
            if (typeof fn === 'function') {
                fn(this);
            }
        },

        extend: function () {
            if (Array.isArray(window[LIB_NAME + 'Extend'])) {
                window[LIB_NAME + 'Extend'].forEach((fn) => {
                    this.use(fn);
                });
                window[LIB_NAME + 'Extend'] = [];
            }
        },

        loaded: function(quInstance) {
            Qu = quInstance;
            this.extend();
            this.debug(`📗 [${LIB_NAME}] loaded`);
        },

        initOnce: function(params = {}) {
            if(this._initOnce === true) { return; }
            this._initOnce = true;
            
            this.config(params);

            if (this._config.useVisibilityCheck && 'IntersectionObserver' in window) {
                this._createImgObserver();
                this._createBgObserver();
                this._createAssetObserver();
                this.initLazyWithObserver();
                this.initRepeatPatternsWithObserver();
                this.initAssetsWithObserver();
            } else {
                this.initLazyImageFade();
                this.initLazyRepeatPatterns();
                this.initAssetsFallback();
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
                        if (this._imgObserver) this.initLazyWithObserver(node);
                        if (this._bgObserver) this.initRepeatPatternsWithObserver(node);
                        if (this._assetObserver) this.initAssetsWithObserver(node);
                    });
                });
            }).observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        _unobserveElement: function(el) {
            if (this._imgCallbacks.has(el)) {
                this._imgObserver.unobserve(el);
                this._imgCallbacks.delete(el);
            }
            if (this._bgCallbacks.has(el)) {
                this._bgObserver.unobserve(el);
                this._bgCallbacks.delete(el);
            }
            if (this._assetCallbacks.has(el)) {
                this._assetObserver.unobserve(el);
                this._assetCallbacks.delete(el);
            }
        },

        init: function(quInstance, params = {}) {
            this.initOnce(params);
            this.config(params);
        },

        _createImgObserver: function() {
            if (this._imgObserver) return;
            this._imgObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const img = entry.target;
                    const cb = this._imgCallbacks.get(img);
                    if (cb) cb(entry);
                });
            }, {
                threshold: 0,
                rootMargin: this._config.rootMargin
            });
        },

        _createBgObserver: function() {
            if (this._bgObserver) return;
            this._bgObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const el = entry.target;
                    const cb = this._bgCallbacks.get(el);
                    if (cb) cb(entry);
                });
            }, {
                threshold: 0,
                rootMargin: this._config.rootMargin
            });
        },

        _createAssetObserver: function() {
            if (this._assetObserver) return;
            this._assetObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const el = entry.target;
                    const cb = this._assetCallbacks.get(el);
                    if (cb) cb(entry);
                });
            }, {
                rootMargin: this._config.assetRootMargin,
                threshold: 0
            });
        },

        _getElementConfig: function(el) {
            const config = {
                threshold: this._config.threshold,
                rootMargin: this._config.rootMargin,
                useAnimation: this._config.useAnimation,
                loadedClass: this._config.loadedClass,
                assetRootMargin: this._config.assetRootMargin,
                assetLoadedClass: this._config.assetLoadedClass,
                assetLoadingClass: this._config.assetLoadingClass,
                assetOptions: { ...this._config.assetOptions },
                fireEventOnLoad: this._config.fireEventOnLoad, 
            };
            
            const lazyThreshold = this._getData(el, 'threshold');
            if (lazyThreshold !== null) {
                const val = parseFloat(lazyThreshold);
                if (!isNaN(val)) config.threshold = val;
            }
            
            const lazyRootMargin = this._getData(el, 'root-margin');
            if (lazyRootMargin !== null) {
                config.rootMargin = lazyRootMargin;
                config.assetRootMargin = lazyRootMargin;
            }
            
            const lazyNoAnimation = this._getData(el, 'no-animation');
            if (lazyNoAnimation !== null) {
                config.useAnimation = false;
                el.classList.add(this._config.noAnimationClass);
            }
            
            const lazyAnimation = this._getData(el, 'animation');
            if (lazyAnimation !== null) {
                if (lazyAnimation === 'true' || lazyAnimation === '1') {
                    config.useAnimation = true;
                    el.classList.remove(this._config.noAnimationClass);
                }
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
            } catch (e) {
                return [data];
            }
            return [data];
        },

        _parseAssetUrls: function(el, type) {
            const raw = this._getData(el, type);
            if (!raw) return [];
            let items = [];
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    items = parsed;
                } else if (typeof parsed === 'string') {
                    items = [parsed];
                } else {
                    return [];
                }
            } catch (e) {
                items = [raw];
            }
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

        initLazyWithObserver: function(root) {
            if (!this._imgObserver) return;
            const scope = root || document;
            const lazyImages = [];
            if (scope.nodeType === 1 && scope.matches(this._config.selector)) lazyImages.push(scope);
            scope.querySelectorAll(this._config.selector).forEach(i => lazyImages.push(i));
            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (img.classList.contains(elConfig.loadedClass)) return;
                if (this._imgCallbacks.has(img)) return;

                const callback = (entry) => {
                    if (!entry.isIntersecting) return;
                    const img = entry.target;
                    const onLoad = () => {
                        img.classList.add(elConfig.loadedClass);
                        if (elConfig.fireEventOnLoad) {
                            Qu.trigger(img, 'qu:lazy:imageloaded', { detail: { element: img, config: elConfig } });
                        }
                        this._imgObserver.unobserve(img);
                        this._imgCallbacks.delete(img);
                    };
                    if (img.complete) {
                        onLoad();
                    } else {
                        img.addEventListener('load', onLoad, { once: true });
                        img.addEventListener('error', onLoad, { once: true });
                    }
                };

                this._imgCallbacks.set(img, callback);
                this._imgObserver.observe(img);
            });
        },

        initRepeatPatternsWithObserver: function(root) {
            if (!this._bgObserver) return;
            const scope = root || document;
            const patterns = [];
            if (scope.nodeType === 1 && scope.matches(this._config.repeatSelector)) patterns.push(scope);
            scope.querySelectorAll(this._config.repeatSelector).forEach(i => patterns.push(i));
            patterns.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.loadedClass)) return;
                if (this._bgCallbacks.has(el)) return;

                const urls = this._parseBgUrls(el);
                if (!urls || urls.length === 0) return;

                const callback = (entry) => {
                    if (!entry.isIntersecting) return;
                    const el = entry.target;
                    const onComplete = () => {
                        el.classList.add(elConfig.loadedClass);
                        this._bgObserver.unobserve(el);
                        this._bgCallbacks.delete(el);
                    };
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
                                const varName = this._config.bgPatternVars[index] || `--bg-pattern-${index + 1}`;
                                el.style.setProperty(varName, `url('${url}')`);
                                loaded++;
                                if (loaded === urls.length) onComplete();
                            };
                            img.onerror = () => {
                                loaded++;
                                if (loaded === urls.length) onComplete();
                            };
                            img.src = url;
                        });
                    }
                };

                this._bgCallbacks.set(el, callback);
                this._bgObserver.observe(el);
            });
        },

        initAssetsWithObserver: function(root) {
            if (!this._assetObserver) return;
            const selector = '[data-qu-lazy-css], [data-qu-lazy-js]';
            const scope = root || document;
            const blocks = [];
            if (scope.nodeType === 1 && scope.matches(selector)) blocks.push(scope);
            scope.querySelectorAll(selector).forEach(i => blocks.push(i));
            blocks.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.assetLoadedClass)) return;
                if (this._assetCallbacks.has(el)) return;

                const cssAssets = this._parseAssetUrls(el, 'css');
                const jsAssets = this._parseAssetUrls(el, 'js');
                const allAssets = [...cssAssets, ...jsAssets];
                if (allAssets.length === 0) return;

                const callback = (entry) => {
                    if (!entry.isIntersecting) return;
                    const el = entry.target;
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
                            if (elConfig.fireEventOnLoad) {
                                Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                            }
                            this._assetObserver.unobserve(el);
                            this._assetCallbacks.delete(el);
                        })
                        .catch(() => {
                            if (loadingClass) el.classList.remove(loadingClass);
                            this._assetObserver.unobserve(el);
                            this._assetCallbacks.delete(el);
                        });
                };

                this._assetCallbacks.set(el, callback);
                this._assetObserver.observe(el);
            });
        },

        initAssetsFallback: function() {
            const blocks = document.querySelectorAll('[data-qu-lazy-css], [data-qu-lazy-js]');
            blocks.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.assetLoadedClass)) return;
                const cssAssets = this._parseAssetUrls(el, 'css');
                const jsAssets = this._parseAssetUrls(el, 'js');
                const allAssets = [...cssAssets, ...jsAssets];
                if (allAssets.length === 0) return;
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
                        if (elConfig.fireEventOnLoad) {
                            Qu.trigger(el, 'qu:lazy:blockloaded', { detail: { element: el, config: elConfig } });
                        }
                    })
                    .catch(() => { if (loadingClass) el.classList.remove(loadingClass); });
            });
        },

        initLazyRepeatPatterns: function() {
            const patterns = document.querySelectorAll(this._config.repeatSelector);
            patterns.forEach(el => {
                const elConfig = this._getElementConfig(el);
                if (el.classList.contains(elConfig.loadedClass)) return;
                const urls = this._parseBgUrls(el);
                if (!urls || urls.length === 0) return;
                const onComplete = () => { el.classList.add(elConfig.loadedClass); };
                if (urls.length === 1) {
                    const img = new Image();
                    img.onload = () => { el.style.setProperty(this._config.bgPatternVar, `url('${urls[0]}')`); onComplete(); };
                    img.onerror = () => { onComplete(); };
                    img.src = urls[0];
                } else {
                    let loaded = 0;
                    urls.forEach((url, index) => {
                        const img = new Image();
                        img.onload = () => {
                            const varName = this._config.bgPatternVars[index] || `--bg-pattern-${index + 1}`;
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

        initLazyImageFade: function() {
            const lazyImages = document.querySelectorAll(this._config.selector);
            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (img.classList.contains(elConfig.loadedClass)) return;
                const onLoad = () => {
                    img.classList.add(elConfig.loadedClass);
                    if (elConfig.fireEventOnLoad) {
                        Qu.trigger(img, 'qu:lazy:imageloaded', { detail: { element: img, config: elConfig } });
                    }
                };
                if (img.complete) {
                    onLoad();
                } else {
                    img.addEventListener('load', onLoad);
                    img.addEventListener('error', onLoad);
                }
            });
        },

        setAnimation: function(enable) {
            this._config.useAnimation = enable;
        },

        showAllImagesImmediately: function() {
            const lazyImages = document.querySelectorAll(this._config.selector);
            lazyImages.forEach(img => {
                const elConfig = this._getElementConfig(img);
                if (img.classList.contains(elConfig.loadedClass)) return;
                if (img.complete) {
                    img.classList.add(elConfig.loadedClass);
                } else {
                    img.addEventListener('load', () => { img.classList.add(elConfig.loadedClass); });
                    img.addEventListener('error', () => { img.classList.add(elConfig.loadedClass); });
                }
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