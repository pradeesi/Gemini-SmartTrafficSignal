// static/js/settings.js
// Wrap everything in an IIFE to avoid polluting the global scope
(function() {
    // --- DOM Element References ---
    const settingsForm = document.getElementById('settingsForm');
    const modeSelect = document.getElementById('modeSelect');
    const resolutionSelect = document.getElementById('resolutionSelect');
    const saveStatus = document.getElementById('saveStatus');
    const settingsFeedImg = document.getElementById('settingsFeedImg');
    const cropContainer = document.getElementById('cropContainer');
    const cropOverlay = document.getElementById('cropOverlay');
    const settingsCameraError = document.getElementById('settingsCameraError');
    const cropXInput = document.getElementById('cropX');
    const cropYInput = document.getElementById('cropY');
    const cropWInput = document.getElementById('cropW');
    const cropHInput = document.getElementById('cropH');
    const greenDurationInput = document.getElementById('greenDurationInput');
    const yellowDurationInput = document.getElementById('yellowDurationInput');
    // *** Reference for API rate limit input ***
    const apiCallsPerMinuteInput = document.getElementById('apiCallsPerMinuteInput');
    // *** START: Reference for new Max Time Smart A input ***
    const maxTimeSmartAInput = document.getElementById('maxTimeSmartAInput');
    // *** END: Reference for new Max Time Smart A input ***


    // --- State Variables ---
    let currentSettings = {}; // Cache for loaded settings
    let isDragging = false;   // Flag for mouse dragging state
    let dragStartX, dragStartY; // Mouse position when drag starts
    // Note: IS_CAMERA_RUNNING is a global const defined in the HTML <script> tag

    // --- Utility Functions ---
    function displayStatus(message, isError = false) {
        if(!saveStatus) return; // Element check
        saveStatus.textContent = message;
        saveStatus.className = isError ? 'ms-2 text-danger' : 'ms-2 text-success';
        // Clear status message after a delay
        setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 4000);
    }

    // --- Settings Load/Save ---
    async function loadSettings() {
        console.log('Loading settings...');
        // *** MODIFIED: Added new input to required elements check ***
        const requiredElements = [
            modeSelect, apiCallsPerMinuteInput, resolutionSelect,
            cropXInput, cropYInput, cropWInput, cropHInput,
            greenDurationInput, yellowDurationInput, maxTimeSmartAInput // Added maxTimeSmartAInput
        ];
        if (requiredElements.some(el => !el)) {
             // Find which elements are missing for better debugging
             const missing = requiredElements.map((el, i) => el ? null : ['modeSelect', 'apiCallsPerMinuteInput', 'resolutionSelect', 'cropXInput', 'cropYInput', 'cropWInput', 'cropHInput', 'greenDurationInput', 'yellowDurationInput', 'maxTimeSmartAInput'][i]).filter(Boolean);
             console.error("Cannot load settings: One or more form elements not found:", missing);
             displayStatus("Initialization Error: Form elements missing", true);
             return;
        }
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
            currentSettings = await response.json();
            console.log('Settings loaded:', currentSettings);

            // Populate form fields
            modeSelect.value = currentSettings.mode || 'Image';
            apiCallsPerMinuteInput.value = currentSettings.apiCallsPerMinute || 6; // Use new default
            resolutionSelect.value = currentSettings.resolution || 'default';

            greenDurationInput.value = currentSettings.greenLightDurationMs ? (currentSettings.greenLightDurationMs / 1000) : 3;
            yellowDurationInput.value = currentSettings.yellowLightDurationMs ? (currentSettings.yellowLightDurationMs / 1000) : 1;

            // *** START: Populate new field ***
            maxTimeSmartAInput.value = currentSettings.maxTimeSmartA_Ms ? (currentSettings.maxTimeSmartA_Ms / 1000) : 10; // Default 10 seconds
            // *** END: Populate new field ***


            // Populate hidden crop inputs AND update overlay visuals
            if (currentSettings.cropArea) {
                 cropXInput.value = currentSettings.cropArea.x ?? 0.0;
                 cropYInput.value = currentSettings.cropArea.y ?? 0.0;
                 cropWInput.value = currentSettings.cropArea.w ?? 1.0;
                 cropHInput.value = currentSettings.cropArea.h ?? 1.0;
                 if (IS_CAMERA_RUNNING) {
                    updateCropOverlayVisuals();
                 }
            } else {
                console.warn("cropArea data missing from settings response.");
                 cropXInput.value = 0.0; cropYInput.value = 0.0; cropWInput.value = 1.0; cropHInput.value = 1.0;
                 if (IS_CAMERA_RUNNING) updateCropOverlayVisuals();
            }

        } catch (error) {
            console.error('Failed to load settings:', error);
            displayStatus(`Failed to load settings: ${error.message}`, true);
        }
    }

    async function saveSettings(event) {
        event.preventDefault(); // Prevent default form submission
        console.log('Saving settings...');
        displayStatus('Saving...');

         // *** MODIFIED: Added new input to required elements check ***
        const requiredElements = [
            modeSelect, apiCallsPerMinuteInput, resolutionSelect,
            cropXInput, cropYInput, cropWInput, cropHInput,
            greenDurationInput, yellowDurationInput, maxTimeSmartAInput // Added maxTimeSmartAInput
        ];
        if (requiredElements.some(el => !el)) {
            const missing = requiredElements.map((el, i) => el ? null : ['modeSelect', 'apiCallsPerMinuteInput', 'resolutionSelect', 'cropXInput', 'cropYInput', 'cropWInput', 'cropHInput', 'greenDurationInput', 'yellowDurationInput', 'maxTimeSmartAInput'][i]).filter(Boolean);
            console.error("Cannot save settings: One or more form elements not found:", missing);
            displayStatus("Save Error: Form elements missing", true);
            return;
        }

        // Read values from form
        const settingsToSave = {
            mode: modeSelect.value,
            apiCallsPerMinute: parseInt(apiCallsPerMinuteInput.value) || 6, // Use new default
            resolution: resolutionSelect.value || 'default',
            cropArea: {
                x: parseFloat(cropXInput.value) || 0.0,
                y: parseFloat(cropYInput.value) || 0.0,
                w: parseFloat(cropWInput.value) || 1.0,
                h: parseFloat(cropHInput.value) || 1.0,
            },
            greenLightDurationSec: parseFloat(greenDurationInput.value) || 3,
            yellowLightDurationSec: parseFloat(yellowDurationInput.value) || 1,
            // *** START: Read new field value ***
            maxTimeSmartA_Sec: parseFloat(maxTimeSmartAInput.value) || 10 // Default 10 seconds
            // *** END: Read new field value ***
        };

        // --- Frontend Validation ---
        if (settingsToSave.apiCallsPerMinute < 1 || settingsToSave.apiCallsPerMinute > 60) { // Example range
             displayStatus('API Calls per Minute must be between 1 and 60.', true);
             return;
        }

        const crop = settingsToSave.cropArea;
        if (crop.x < 0 || crop.x > 1 || crop.y < 0 || crop.y > 1 || crop.w <= 0 || crop.w > 1 || crop.h <= 0 || crop.h > 1 || (crop.x + crop.w) > 1.001 || (crop.y + crop.h) > 1.001){
             displayStatus('Invalid crop dimensions (must be between 0 and 1, width/height > 0).', true);
             return;
        }
        if (settingsToSave.greenLightDurationSec <= 0) {
            displayStatus('Green light duration must be positive.', true);
            return;
        }
         if (settingsToSave.yellowLightDurationSec <= 0) {
            displayStatus('Yellow light duration must be positive.', true);
            return;
        }
        // *** START: Validate new field ***
        if (settingsToSave.maxTimeSmartA_Sec < 5 || settingsToSave.maxTimeSmartA_Sec > 300) { // Example range (5s to 5min)
            displayStatus('Max Time for Smart A must be between 5 and 300 seconds.', true);
            return;
        }
        // *** END: Validate new field ***
        // --- End Validation ---

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settingsToSave),
            });
            const result = await response.json();
            if (!response.ok) { throw new Error(result.error || `HTTP error! status: ${response.status}`); }

            console.log('Settings saved successfully:', settingsToSave);
            // Update local cache
            currentSettings = {
                ...currentSettings,
                mode: settingsToSave.mode,
                apiCallsPerMinute: settingsToSave.apiCallsPerMinute,
                resolution: settingsToSave.resolution,
                cropArea: settingsToSave.cropArea,
                greenLightDurationMs: settingsToSave.greenLightDurationSec * 1000,
                yellowLightDurationMs: settingsToSave.yellowLightDurationSec * 1000,
                // *** START: Update cache with new field (in ms) ***
                maxTimeSmartA_Ms: settingsToSave.maxTimeSmartA_Sec * 1000
                // *** END: Update cache with new field (in ms) ***
            }
            displayStatus('Settings saved. Changes will apply on next analysis cycle or traffic light cycle.', false); // Modified message slightly

        } catch (error) {
            console.error('Failed to save settings:', error);
            displayStatus(`Failed to save settings: ${error.message}`, true);
        }
    }

    // --- Cropping UI Logic ---
    function updateCropOverlayVisuals() { if (!IS_CAMERA_RUNNING || !settingsFeedImg || !cropOverlay || !settingsFeedImg.complete || settingsFeedImg.naturalWidth === 0) { if (cropOverlay) cropOverlay.style.display = 'none'; return; } if (cropOverlay) cropOverlay.style.display = 'block'; try { const imgRect = settingsFeedImg.getBoundingClientRect(); const containerRect = cropContainer.getBoundingClientRect(); if (imgRect.width === 0 || imgRect.height === 0 || containerRect.width === 0 || containerRect.height === 0) { if (cropOverlay) cropOverlay.style.display = 'none'; console.warn("Cannot update overlay, image or container has zero dimensions."); return; } const relX = parseFloat(cropXInput.value); const relY = parseFloat(cropYInput.value); const relW = parseFloat(cropWInput.value); const relH = parseFloat(cropHInput.value); if (isNaN(relX) || isNaN(relY) || isNaN(relW) || isNaN(relH) || relW <= 0 || relH <= 0) { console.warn("Invalid relative crop values, hiding overlay."); if (cropOverlay) cropOverlay.style.display = 'none'; return; } const pixelX = relX * imgRect.width; const pixelY = relY * imgRect.height; const pixelW = relW * imgRect.width; const pixelH = relH * imgRect.height; const offsetX = imgRect.left - containerRect.left; const offsetY = imgRect.top - containerRect.top; cropOverlay.style.left = `${offsetX + pixelX}px`; cropOverlay.style.top = `${offsetY + pixelY}px`; cropOverlay.style.width = `${pixelW}px`; cropOverlay.style.height = `${pixelH}px`; } catch (e) { console.error("Error updating crop overlay visuals:", e); if (cropOverlay) cropOverlay.style.display = 'none'; } }
    function handleMouseDown(event) { if (!IS_CAMERA_RUNNING) { console.log("handleMouseDown ignored: Camera is stopped."); return; } event.preventDefault(); if (!cropContainer || !cropOverlay || !settingsFeedImg) { console.error("handleMouseDown: Missing essential cropping elements."); return; } if (!settingsFeedImg.complete || settingsFeedImg.naturalWidth === 0) { console.warn("handleMouseDown ignored: Image not fully loaded."); return; } console.log("handleMouseDown start"); isDragging = true; cropOverlay.style.cursor = 'grabbing'; const containerRect = cropContainer.getBoundingClientRect(); dragStartX = event.clientX - containerRect.left; dragStartY = event.clientY - containerRect.top; cropOverlay.style.left = `${dragStartX}px`; cropOverlay.style.top = `${dragStartY}px`; cropOverlay.style.width = '0px'; cropOverlay.style.height = '0px'; cropOverlay.style.display = 'block'; if (cropXInput) cropXInput.value = "0.0"; if (cropYInput) cropYInput.value = "0.0"; if (cropWInput) cropWInput.value = "0.0"; if (cropHInput) cropHInput.value = "0.0"; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp); }
    function handleMouseMove(event) { if (!isDragging || !IS_CAMERA_RUNNING) return; if (!cropContainer || !cropOverlay || !settingsFeedImg) return; if (!settingsFeedImg.complete || settingsFeedImg.naturalWidth === 0) return; const containerRect = cropContainer.getBoundingClientRect(); const imgRect = settingsFeedImg.getBoundingClientRect(); if (imgRect.width === 0 || imgRect.height === 0) return; const currentX = event.clientX - containerRect.left; const currentY = event.clientY - containerRect.top; const imgOffsetX = imgRect.left - containerRect.left; const imgOffsetY = imgRect.top - containerRect.top; let newLeftPixel = Math.min(dragStartX, currentX); let newTopPixel = Math.min(dragStartY, currentY); let newWidthPixel = Math.abs(currentX - dragStartX); let newHeightPixel = Math.abs(currentY - dragStartY); newLeftPixel = Math.max(imgOffsetX, newLeftPixel); newTopPixel = Math.max(imgOffsetY, newTopPixel); if (newLeftPixel + newWidthPixel > imgOffsetX + imgRect.width) { newWidthPixel = imgOffsetX + imgRect.width - newLeftPixel; } if (newTopPixel + newHeightPixel > imgOffsetY + imgRect.height) { newHeightPixel = imgOffsetY + imgRect.height - newTopPixel; } newWidthPixel = Math.max(0, newWidthPixel); newHeightPixel = Math.max(0, newHeightPixel); cropOverlay.style.left = `${newLeftPixel}px`; cropOverlay.style.top = `${newTopPixel}px`; cropOverlay.style.width = `${newWidthPixel}px`; cropOverlay.style.height = `${newHeightPixel}px`; let relX = imgRect.width > 0 ? ((newLeftPixel - imgOffsetX) / imgRect.width) : 0; let relY = imgRect.height > 0 ? ((newTopPixel - imgOffsetY) / imgRect.height) : 0; let relW = imgRect.width > 0 ? (newWidthPixel / imgRect.width) : 0; let relH = imgRect.height > 0 ? (newHeightPixel / imgRect.height) : 0; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); relW = Math.max(0, Math.min(1, relW)); relH = Math.max(0, Math.min(1, relH)); if (relX + relW > 1) relW = 1 - relX; if (relY + relH > 1) relH = 1 - relY; if(cropXInput) cropXInput.value = relX.toFixed(4); if(cropYInput) cropYInput.value = relY.toFixed(4); if(cropWInput) cropWInput.value = relW.toFixed(4); if(cropHInput) cropHInput.value = relH.toFixed(4); }
    function handleMouseUp() { if (!isDragging) return; isDragging = false; if (cropOverlay) cropOverlay.style.cursor = 'grab'; document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); console.log(`Crop drag end: x=${cropXInput?.value}, y=${cropYInput?.value}, w=${cropWInput?.value}, h=${cropHInput?.value}`); }


    // --- Camera Feed Error Handling ---
    if (settingsFeedImg) { settingsFeedImg.onerror = () => { console.error('Error loading MJPEG stream for settings.'); if (settingsCameraError) { settingsCameraError.textContent = 'Error loading video stream.'; settingsCameraError.style.display = 'block'; } if (settingsFeedImg) settingsFeedImg.style.display = 'none'; if (cropOverlay) cropOverlay.style.display = 'none'; }; settingsFeedImg.onload = () => { console.log("Settings feed image loaded or finished loading attempt."); if (settingsCameraError) settingsCameraError.style.display = 'none'; if(IS_CAMERA_RUNNING) { setTimeout(updateCropOverlayVisuals, 100); } else { if (cropOverlay) cropOverlay.style.display = 'none'; } }; } else { console.error("Settings feed image element not found on initial load."); }


    // --- Initialization ---
    function initializeSettingsPage() {
        console.log('Initializing settings page...');
        // *** MODIFIED: Added new input to required elements check ***
        const requiredElements = [
             settingsForm, modeSelect, apiCallsPerMinuteInput, resolutionSelect,
             cropContainer, greenDurationInput, yellowDurationInput, cropXInput,
             cropYInput, cropWInput, cropHInput, maxTimeSmartAInput // Added maxTimeSmartAInput
        ];
        if (requiredElements.some(el => !el)) {
            const missing = requiredElements.map((el, i) => el ? null : ['settingsForm', 'modeSelect', 'apiCallsPerMinuteInput', 'resolutionSelect', 'cropContainer', 'greenDurationInput', 'yellowDurationInput', 'cropXInput', 'cropYInput', 'cropWInput', 'cropHInput', 'maxTimeSmartAInput'][i]).filter(Boolean);
            console.error("Cannot initialize settings page: Essential elements missing:", missing);
            displayStatus("Page Initialization Failed!", true);
            return;
        }

        loadSettings(); // Load settings first

        settingsForm.addEventListener('submit', saveSettings);
        // No longer need change listener for modeSelect related to frameRate

        if (IS_CAMERA_RUNNING) {
             console.log("Camera running, enabling cropping interactions.");
             if (cropContainer) {
                cropContainer.style.cursor = 'crosshair';
                cropContainer.addEventListener('mousedown', handleMouseDown);
             }
        } else {
             console.log("Camera stopped, cropping interactions disabled.");
             if(cropContainer) cropContainer.style.cursor = 'not-allowed';
             if(cropOverlay) cropOverlay.style.display = 'none';
        }

         window.addEventListener('resize', () => {
             if (IS_CAMERA_RUNNING) {
                 updateCropOverlayVisuals();
             }
         });

         if (settingsFeedImg) {
             settingsFeedImg.addEventListener('load', () => {
                 if (IS_CAMERA_RUNNING) {
                      setTimeout(updateCropOverlayVisuals, 100);
                 }
             });
         }
         console.log("Settings page initialization complete.");
    }

    // Run initialization when the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSettingsPage);
    } else {
        initializeSettingsPage(); // DOM already ready
    }

})(); // End of IIFE