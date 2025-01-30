(() => {
    if (!chrome?.runtime) {
        console.debug('Chrome runtime not available yet');
        return;
    }

    // Hide page content initially
    const initialHideStyle = document.createElement('style');
    initialHideStyle.textContent = `
    html {
        visibility: hidden !important;
    }
    html.dom-editor-ready {
        visibility: visible !important;
    }`;
    document.documentElement.appendChild(initialHideStyle);

    let isActive = false;
    let showOutlines = false;
    let valueIncrease = {
        enabled: false,
        increment: 1000,
        randomizer: false
    };
    let domChanges = {};
    let valueChanges = {};
    let editableElements = new WeakSet();
    let isEditing = false;
    let observer = null;
    let isInitialized = false;
    let changesPending = false;

    // Create styles
    const styles = document.createElement('style');
    styles.textContent = `
    *[data-editable="true"] {
        outline: 4px dashed #1a73e8 !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        position: relative !important;
        z-index: 9998 !important;
    }
    *[data-editable="true"]:hover {
        outline: 4px solid #1a73e8 !important;
        background-color: rgba(26, 115, 232, 0.1) !important;
    }
    *[data-editing="true"] {
        outline: 4px solid #34a853 !important;
        background-color: rgba(52, 168, 83, 0.1) !important;
        min-height: 1em !important;
        cursor: text !important;
        user-select: text !important;
        -webkit-user-select: text !important;
    }
    *[data-numeric="true"] {
        background-color: #fff3e0 !important;
        outline: 4px dashed #fb8c00 !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        z-index: 9999 !important;
    }
    *[data-numeric="true"]:hover {
        outline: 4px solid #fb8c00 !important;
        background-color: #ffe0b2 !important;
    }
    *[data-numeric="true"][data-editing="true"] {
        outline: 4px solid #fb8c00 !important;
        background-color: #fff3e0 !important;
    }`;

    function isNumeric(str) {
        if (typeof str !== 'string') return false;
        str = str.replace(/,/g, '').trim();
        if (/^-?\d*\.?\d+$/.test(str)) {
            const num = parseFloat(str);
            return !isNaN(num) && isFinite(num);
        }
        return false;
    }

    function formatNumber(num) {
        if (typeof num !== 'number' || !isFinite(num)) return '0';
        return num.toLocaleString('en-US');
    }

    function parseNumber(str) {
        if (typeof str !== 'string') return 0;
        const num = parseFloat(str.replace(/,/g, ''));
        return isFinite(num) ? num : 0;
    }

    function showPage() {
        document.documentElement.classList.add('dom-editor-ready');
    }

    function generateSelector(element) {
        if (!element || !element.tagName) return null;
        const path = [];
        while (element && element.nodeType === 1) {
            let selector = element.tagName.toLowerCase();
            
            if (element.id && document.querySelectorAll('#' + element.id).length === 1) {
                path.unshift('#' + element.id);
                break;
            }
            
            const stableClasses = Array.from(element.classList)
                .filter(c => !c.includes('hover') && !c.includes('active'));
            if (stableClasses.length > 0) {
                selector += '.' + stableClasses.join('.');
            }
            
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children)
                    .filter(e => e.tagName === element.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(element) + 1;
                    selector += `:nth-of-type(${index})`;
                }
            }
            
            path.unshift(selector);
            element = parent;
            if (element === document.body) break;
        }
        return path.join(' > ');
    }

    function isEditableElement(element) {
        if (!element || !element.tagName) return false;
        
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'script' || 
            tagName === 'style' || 
            tagName === 'link' || 
            tagName === 'meta' || 
            tagName === 'iframe' ||
            tagName === 'svg') {
            return false;
        }

        const text = element.textContent?.trim() || '';
        if (!text || text.length < 1) return false;
        
        if (text.includes('function(') || 
            text.includes('window.') ||
            text.includes('document.') ||
            text.includes('Element')) {
            return false;
        }

        try {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return element.offsetParent !== null && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   rect.width > 0 &&
                   rect.height > 0;
        } catch (e) {
            return false;
        }
    }

    async function applyChanges(changes, valueChanges, forceUpdate = false) {
        if ((!changes && !valueChanges) || (!forceUpdate && isEditing)) return false;

        let updatesMade = false;
        changesPending = true;

        try {
            const promises = [];

            Object.entries(changes || {}).forEach(([selector, data]) => {
                promises.push((async () => {
                    try {
                        const element = document.querySelector(selector);
                        if (element && isEditableElement(element)) {
                            element.textContent = data.text;
                            updatesMade = true;
                        }
                    } catch (e) {
                        console.debug('Failed to apply change:', selector);
                    }
                })());
            });

            if (valueIncrease.enabled) {
                Object.entries(valueChanges || {}).forEach(([selector, data]) => {
                    promises.push((async () => {
                        try {
                            const element = document.querySelector(selector);
                            if (element && isEditableElement(element)) {
                                const baseValue = parseNumber(data.baseValue);
                                if (baseValue === 0) return;
                                
                                const numRefreshes = Math.floor((Date.now() - data.timestamp) / 1000);
                                const newValue = baseValue + (data.increment * numRefreshes);
                                element.textContent = formatNumber(newValue);
                                updatesMade = true;
                            }
                        } catch (e) {
                            console.debug('Failed to apply value change:', selector);
                        }
                    })());
                });
            }

            await Promise.all(promises);
        } finally {
            changesPending = false;
            if (!isInitialized || updatesMade) {
                showPage();
            }
        }

        return updatesMade;
    }

    function makeElementEditable(element) {
        if (editableElements.has(element)) return;

        const isValueElement = isNumeric(element.textContent.trim());
        
        element.addEventListener('click', (e) => {
            if (!isActive) return;
            if (!showOutlines && !valueIncrease.enabled) return;
            if (valueIncrease.enabled && !isValueElement && !showOutlines) return;
            
            e.preventDefault();
            e.stopPropagation();

            document.querySelectorAll('[data-editing="true"]').forEach(el => {
                if (el !== element) {
                    el.removeAttribute('data-editing');
                    el.contentEditable = 'false';
                }
            });

            isEditing = true;
            element.setAttribute('data-editing', 'true');
            element.contentEditable = 'true';
            element.dataset.originalText = element.textContent;
            element.focus();
        });

        element.addEventListener('input', () => {
            if (!isActive || !element.isConnected) return;
            
            const selector = generateSelector(element);
            if (selector) {
                const newText = element.textContent.trim();
                if (valueIncrease.enabled && isNumeric(newText)) {
                    chrome.runtime.sendMessage({
                        type: 'SAVE_CHANGES',
                        selector,
                        text: newText,
                        isNumeric: true,
                        baseValue: newText
                    });
                } else {
                    chrome.runtime.sendMessage({
                        type: 'SAVE_CHANGES',
                        selector,
                        text: newText
                    });
                }
            }
        });

        element.addEventListener('blur', () => {
            if (!element.isConnected) return;
            isEditing = false;
            element.removeAttribute('data-editing');
            element.contentEditable = 'false';

            if (valueIncrease.enabled && isValueElement) {
                const value = parseNumber(element.textContent);
                element.textContent = formatNumber(value);
            }

            if (showOutlines) {
                element.setAttribute('data-editable', 'true');
            }
            if (valueIncrease.enabled && isNumeric(element.textContent)) {
                element.setAttribute('data-numeric', 'true');
            }
        });

        element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                element.blur();
            } else if (e.key === 'Escape') {
                element.textContent = element.dataset.originalText;
                element.blur();
            }
        });

        editableElements.add(element);
    }

    function updateOutlines(forceUpdate = false) {
        if (!isActive && !forceUpdate) return;

        document.querySelectorAll('[data-editable], [data-numeric]').forEach(el => {
            if (!el.hasAttribute('data-editing')) {
                el.removeAttribute('data-editable');
                el.removeAttribute('data-numeric');
                el.contentEditable = 'false';
            }
        });

        if (!isActive) return;

        document.querySelectorAll('*').forEach(element => {
            if (element.children.length === 0 && isEditableElement(element)) {
                const isValueElement = isNumeric(element.textContent.trim());
                
                if (showOutlines) {
                    element.setAttribute('data-editable', 'true');
                    makeElementEditable(element);
                }
                
                if (valueIncrease.enabled && isValueElement) {
                    element.setAttribute('data-numeric', 'true');
                    makeElementEditable(element);
                }
            }
        });
    }

    function initializeObserver() {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver((mutations) => {
            if (!isActive) return;

            let shouldUpdate = false;
            mutations.forEach(mutation => {
                if (mutation.type === 'childList' || 
                    (mutation.type === 'characterData' && !isEditing)) {
                    shouldUpdate = true;
                }
            });

            if (shouldUpdate) {
                applyChanges(domChanges, valueChanges).then(hasUpdates => {
                    if (hasUpdates) {
                        updateOutlines();
                    }
                });
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributeFilter: ['class', 'id']
        });
    }

    // Message handling
    chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
        switch (request.type) {
            case 'STATE_CHANGED':
                isActive = request.isActive;
                showOutlines = request.showOutlines;
                valueIncrease = request.valueIncrease || { enabled: false, increment: 1000, randomizer: false };
                
                if (!isActive) {
                    domChanges = {};
                    valueChanges = {};
                    document.querySelectorAll('[data-editable], [data-editing], [data-numeric]')
                        .forEach(el => {
                            el.removeAttribute('data-editable');
                            el.removeAttribute('data-editing');
                            el.removeAttribute('data-numeric');
                            el.contentEditable = 'false';
                        });
                }

                updateOutlines();
                break;

            case 'APPLY_CHANGES':
                if (isActive) {
                    domChanges = request.changes || {};
                    valueChanges = request.valueChanges || {};
                    applyChanges(domChanges, valueChanges, true).then(hasUpdates => {
                        if (hasUpdates) {
                            updateOutlines();
                        }
                    });
                }
                break;
        }
    });

    // Initialize
    async function initialize() {
        if (!document.documentElement) {
            requestAnimationFrame(initialize);
            return;
        }

        if (isInitialized) return;
        isInitialized = true;

        document.documentElement.appendChild(styles);

        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
            if (response) {
                isActive = response.isActive;
                showOutlines = response.showOutlines;
                valueIncrease = response.valueIncrease || { enabled: false, increment: 1000, randomizer: false };
                
                if (isActive) {
                    const changes = await chrome.runtime.sendMessage({ type: 'GET_CHANGES' });
                    if (changes) {
                        domChanges = changes.changes || {};
                        valueChanges = changes.valueChanges || {};
                        await applyChanges(domChanges, valueChanges, true);
                    }
                }
            }
        } catch (e) {
            console.debug('Error during initialization:', e);
        }

        if (showOutlines || valueIncrease.enabled) {
            updateOutlines(true);
        }

        initializeObserver();

        // Only show page after initialization and changes are applied
        if (!changesPending) {
            showPage();
        }
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
