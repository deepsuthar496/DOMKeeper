document.addEventListener('DOMContentLoaded', async () => {
    const persistSwitch = document.getElementById('persistSwitch');
    const outlineContainer = document.getElementById('outlineContainer');
    const valueIncreaseContainer = document.getElementById('valueIncreaseContainer');
    const toggleSwitch = document.getElementById('toggleSwitch');
    const outlineSwitch = document.getElementById('outlineSwitch');
    const valueIncreaseSwitch = document.getElementById('valueIncreaseSwitch');
    const valueIncreaseOptions = document.getElementById('valueIncreaseOptions');
    const randomizerContainer = document.getElementById('randomizerContainer');
    const randomizerSwitch = document.getElementById('randomizerSwitch');
    const incrementValue = document.getElementById('incrementValue');

    // Update switch states and styling
    function updateSwitchStyles() {
        const extensionOff = !toggleSwitch.checked;
        
        // Handle outline switch
        outlineSwitch.disabled = extensionOff;
        if (extensionOff) {
            outlineContainer.setAttribute('data-disabled', 'true');
            outlineSwitch.checked = false;
        } else {
            outlineContainer.removeAttribute('data-disabled');
        }
        
        // Handle value increase switch
        valueIncreaseSwitch.disabled = extensionOff;
        if (extensionOff) {
            valueIncreaseContainer.setAttribute('data-disabled', 'true');
            valueIncreaseSwitch.checked = false;
            valueIncreaseOptions.style.display = 'none';
        } else {
            valueIncreaseContainer.removeAttribute('data-disabled');
            valueIncreaseOptions.style.display = valueIncreaseSwitch.checked ? 'flex' : 'none';
        }

        // Handle randomizer switch
        randomizerSwitch.disabled = extensionOff || !valueIncreaseSwitch.checked;
        if (extensionOff || !valueIncreaseSwitch.checked) {
            randomizerContainer.setAttribute('data-disabled', 'true');
            randomizerSwitch.checked = false;
        } else {
            randomizerContainer.removeAttribute('data-disabled');
        }
    }

    // Get initial state
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        if (response) {
            toggleSwitch.checked = response.isActive;
            outlineSwitch.checked = response.showOutlines;
            valueIncreaseSwitch.checked = response.valueIncrease?.enabled || false;
            randomizerSwitch.checked = response.valueIncrease?.randomizer || false;
            if (response.valueIncrease?.increment) {
                incrementValue.value = response.valueIncrease.increment;
            }
            updateSwitchStyles();
        }
    } catch (e) {
        console.error('Error getting initial state:', e);
    }

    // Handle persist changes toggle
    toggleSwitch.addEventListener('change', async () => {
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'TOGGLE_EXTENSION',
                state: toggleSwitch.checked
            });

            if (response && response.success) {
                outlineSwitch.checked = response.showOutlines;
                valueIncreaseSwitch.checked = response.valueIncrease?.enabled || false;
                randomizerSwitch.checked = response.valueIncrease?.randomizer || false;
                updateSwitchStyles();
            } else {
                toggleSwitch.checked = !toggleSwitch.checked;
            }
        } catch (e) {
            console.error('Error toggling extension:', e);
            toggleSwitch.checked = !toggleSwitch.checked;
        }
        updateSwitchStyles();
    });

    // Handle outline toggle
    outlineSwitch.addEventListener('change', async () => {
        if (!toggleSwitch.checked) {
            outlineSwitch.checked = false;
            return;
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'TOGGLE_OUTLINES'
            });

            if (response && response.success) {
                outlineSwitch.checked = response.showOutlines;
            } else {
                outlineSwitch.checked = !outlineSwitch.checked;
            }
        } catch (e) {
            console.error('Error toggling outlines:', e);
            outlineSwitch.checked = !outlineSwitch.checked;
        }
    });

    // Handle value increase toggle
    valueIncreaseSwitch.addEventListener('change', async () => {
        if (!toggleSwitch.checked) {
            valueIncreaseSwitch.checked = false;
            valueIncreaseOptions.style.display = 'none';
            return;
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'TOGGLE_VALUE_INCREASE',
                increment: parseInt(incrementValue.value, 10)
            });

            if (response && response.success) {
                valueIncreaseSwitch.checked = response.valueIncrease?.enabled || false;
                randomizerSwitch.checked = response.valueIncrease?.randomizer || false;
                valueIncreaseOptions.style.display = valueIncreaseSwitch.checked ? 'flex' : 'none';
                updateSwitchStyles();
            } else {
                valueIncreaseSwitch.checked = !valueIncreaseSwitch.checked;
                updateSwitchStyles();
            }
        } catch (e) {
            console.error('Error toggling value increase:', e);
            valueIncreaseSwitch.checked = !valueIncreaseSwitch.checked;
            updateSwitchStyles();
        }
    });

    // Handle randomizer toggle
    randomizerSwitch.addEventListener('change', async () => {
        if (!toggleSwitch.checked || !valueIncreaseSwitch.checked) {
            randomizerSwitch.checked = false;
            return;
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'TOGGLE_RANDOMIZER'
            });

            if (response && response.success) {
                randomizerSwitch.checked = response.valueIncrease?.randomizer || false;
            } else {
                randomizerSwitch.checked = !randomizerSwitch.checked;
            }
        } catch (e) {
            console.error('Error toggling randomizer:', e);
            randomizerSwitch.checked = !randomizerSwitch.checked;
        }
    });

    // Handle increment value changes
    incrementValue.addEventListener('change', async () => {
        if (!toggleSwitch.checked || !valueIncreaseSwitch.checked) return;
        
        const value = parseInt(incrementValue.value, 10);
        if (isNaN(value) || value < 1) {
            incrementValue.value = '1000';
            return;
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'UPDATE_INCREMENT',
                increment: value
            });

            if (!response?.success) {
                incrementValue.value = '1000';
            }
        } catch (e) {
            console.error('Error updating increment:', e);
            incrementValue.value = '1000';
        }
    });

    // Handle input field formatting
    incrementValue.addEventListener('focus', () => {
        if (incrementValue.value === '0') {
            incrementValue.value = '';
        }
    });

    incrementValue.addEventListener('blur', () => {
        const value = parseInt(incrementValue.value, 10);
        if (isNaN(value) || value < 1) {
            incrementValue.value = '1000';
        }
    });
});
