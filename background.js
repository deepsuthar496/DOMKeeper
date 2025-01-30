// State management
const state = {
    isActive: false,
    showOutlines: false,
    valueIncrease: {
        enabled: false,
        increment: 1000,
        randomizer: false
    },
    changes: {},
    valueChanges: {}
};

function getRandomIncrement(baseIncrement) {
    const min = baseIncrement * 0.5;
    const max = baseIncrement * 1.5;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Load saved state
async function loadState() {
    try {
        const saved = await chrome.storage.local.get([
            'isActive', 
            'showOutlines', 
            'changes',
            'valueIncrease',
            'valueChanges'
        ]);
        
        state.isActive = Boolean(saved.isActive);
        state.showOutlines = Boolean(saved.showOutlines);
        state.changes = saved.changes || {};
        state.valueIncrease = saved.valueIncrease || { 
            enabled: false, 
            increment: 1000,
            randomizer: false
        };
        state.valueChanges = saved.valueChanges || {};
        
        // Immediately notify all tabs after loading state
        if (state.isActive) {
            await notifyTabs();
        }
    } catch (e) {
        console.error('Error loading state:', e);
    }
}

// Save state with error handling
async function saveState() {
    try {
        await chrome.storage.local.set({
            isActive: state.isActive,
            showOutlines: state.showOutlines,
            changes: state.changes,
            valueIncrease: state.valueIncrease,
            valueChanges: state.valueChanges
        });
        return true;
    } catch (e) {
        console.error('Error saving state:', e);
        return false;
    }
}

// URL normalization
function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
    } catch (e) {
        return url;
    }
}

// Check if URL is injectable
function isInjectableUrl(url) {
    try {
        return url.startsWith('http://') || url.startsWith('https://');
    } catch (e) {
        return false;
    }
}

// Inject content script
async function injectContentScript(tabId, url) {
    if (!isInjectableUrl(url)) return false;

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
            injectImmediately: true
        });
        return true;
    } catch (e) {
        if (!e.message?.includes('cannot be scripted')) {
            console.error('Failed to inject content script:', e);
        }
        return false;
    }
}

// Apply changes to tab
async function applyChanges(tabId, url) {
    if (!state.isActive || !isInjectableUrl(url)) return false;

    const normalizedUrl = normalizeUrl(url);
    const changes = state.changes[normalizedUrl];
    const valueChanges = state.valueChanges[normalizedUrl];

    if (!changes && !valueChanges) return false;

    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'APPLY_CHANGES',
            changes: changes || {},
            valueChanges: valueChanges || {}
        });
        return true;
    } catch (e) {
        if (!e.message?.includes('receiving end does not exist')) {
            console.error('Error applying changes:', e);
        }
        return false;
    }
}

// Notify single tab
async function notifyTab(tabId, url) {
    if (!isInjectableUrl(url)) return false;

    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'STATE_CHANGED',
            isActive: state.isActive,
            showOutlines: state.showOutlines,
            valueIncrease: state.valueIncrease
        });
        
        if (state.isActive) {
            await applyChanges(tabId, url);
        }
        return true;
    } catch (e) {
        if (!e.message?.includes('receiving end does not exist')) {
            const injected = await injectContentScript(tabId, url);
            if (injected) {
                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: 'STATE_CHANGED',
                        isActive: state.isActive,
                        showOutlines: state.showOutlines,
                        valueIncrease: state.valueIncrease
                    });
                    
                    if (state.isActive) {
                        await applyChanges(tabId, url);
                    }
                    return true;
                } catch (err) {
                    console.error('Error after injection:', err);
                }
            }
        }
        return false;
    }
}

// Notify all tabs
async function notifyTabs() {
    try {
        const tabs = await chrome.tabs.query({
            url: ['http://*/*', 'https://*/*']
        });
        
        const updates = tabs.map(tab => 
            notifyTab(tab.id, tab.url)
        );
        
        await Promise.allSettled(updates);
        return true;
    } catch (e) {
        console.error('Error broadcasting state:', e);
        return false;
    }
}

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const url = sender?.tab?.url ? normalizeUrl(sender.tab.url) : '';
    
    const handleMessage = async () => {
        try {
            switch (request.type) {
                case 'PING':
                    return { success: true };

                case 'SAVE_CHANGES':
                    if (url && state.isActive) {
                        if (state.valueIncrease.enabled && request.isNumeric) {
                            const increment = state.valueIncrease.randomizer 
                                ? getRandomIncrement(state.valueIncrease.increment)
                                : state.valueIncrease.increment;
                            
                            state.valueChanges[url] = {
                                ...state.valueChanges[url],
                                [request.selector]: {
                                    baseValue: request.baseValue,
                                    currentValue: request.currentValue,
                                    increment: increment,
                                    timestamp: Date.now()
                                }
                            };
                        } else {
                            state.changes[url] = {
                                ...state.changes[url],
                                [request.selector]: {
                                    text: request.text,
                                    timestamp: Date.now()
                                }
                            };
                        }
                        await saveState();
                        return { success: true };
                    }
                    return { success: false };

                case 'GET_CHANGES':
                    return {
                        isActive: state.isActive,
                        showOutlines: state.showOutlines,
                        valueIncrease: state.valueIncrease,
                        changes: url ? state.changes[url] : {},
                        valueChanges: url ? state.valueChanges[url] : {}
                    };

                case 'TOGGLE_EXTENSION':
                    state.isActive = typeof request.state === 'boolean' ? request.state : !state.isActive;
                    if (!state.isActive) {
                        state.showOutlines = false;
                        state.valueIncrease.enabled = false;
                        state.valueIncrease.randomizer = false;
                        state.changes = {};
                        state.valueChanges = {};
                    }
                    if (await saveState()) {
                        await notifyTabs();
                        return {
                            success: true,
                            isActive: state.isActive,
                            showOutlines: state.showOutlines,
                            valueIncrease: state.valueIncrease
                        };
                    }
                    return { success: false };

                case 'TOGGLE_OUTLINES':
                    if (state.isActive) {
                        state.showOutlines = !state.showOutlines;
                        if (await saveState()) {
                            await notifyTabs();
                            return {
                                success: true,
                                isActive: state.isActive,
                                showOutlines: state.showOutlines,
                                valueIncrease: state.valueIncrease
                            };
                        }
                    }
                    return { success: false };

                case 'TOGGLE_VALUE_INCREASE':
                    if (state.isActive) {
                        state.valueIncrease.enabled = !state.valueIncrease.enabled;
                        if (!state.valueIncrease.enabled) {
                            state.valueIncrease.randomizer = false;
                        }
                        if (request.increment) {
                            state.valueIncrease.increment = request.increment;
                        }
                        if (await saveState()) {
                            await notifyTabs();
                            return {
                                success: true,
                                isActive: state.isActive,
                                showOutlines: state.showOutlines,
                                valueIncrease: state.valueIncrease
                            };
                        }
                    }
                    return { success: false };

                case 'TOGGLE_RANDOMIZER':
                    if (state.isActive && state.valueIncrease.enabled) {
                        state.valueIncrease.randomizer = !state.valueIncrease.randomizer;
                        if (await saveState()) {
                            await notifyTabs();
                            return {
                                success: true,
                                isActive: state.isActive,
                                showOutlines: state.showOutlines,
                                valueIncrease: state.valueIncrease
                            };
                        }
                    }
                    return { success: false };

                case 'UPDATE_INCREMENT':
                    if (state.isActive && state.valueIncrease.enabled) {
                        state.valueIncrease.increment = request.increment;
                        await saveState();
                        await notifyTabs();
                        return { success: true };
                    }
                    return { success: false };

                case 'GET_STATE':
                    return {
                        isActive: state.isActive,
                        showOutlines: state.showOutlines,
                        valueIncrease: state.valueIncrease
                    };

                case 'CLEAR_CHANGES':
                    if (url) {
                        delete state.changes[url];
                        delete state.valueChanges[url];
                        await saveState();
                        return { success: true };
                    }
                    return { success: false };
            }
        } catch (e) {
            console.error('Error handling message:', e);
            return { error: e.message };
        }
    };

    handleMessage().then(response => {
        if (response) {
            sendResponse(response);
        }
    });
    return true;
});

// Handle navigation events
chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId === 0 && isInjectableUrl(details.url)) {
        if (state.isActive) {
            await injectContentScript(details.tabId, details.url);
        }
    }
});

chrome.webNavigation.onDOMContentLoaded.addListener(async (details) => {
    if (details.frameId === 0 && isInjectableUrl(details.url)) {
        if (state.isActive) {
            await notifyTab(details.tabId, details.url);
        }
    }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url && isInjectableUrl(tab.url)) {
        if (state.isActive) {
            await injectContentScript(tabId, tab.url);
        }
    }
    
    if (changeInfo.status === 'complete' && tab.url && isInjectableUrl(tab.url)) {
        if (state.isActive) {
            await notifyTab(tabId, tab.url);
        }
    }
});

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await chrome.storage.local.clear();
    }
    await loadState();
});

// Load initial state
loadState();
