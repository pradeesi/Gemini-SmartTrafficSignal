// static/js/main.js - Incorporates new logic for Smart Direction A in AI Mode
(function() {
    // --- Constants ---
    // REMOVED: CAMERA_GREEN_BASE_TIME_MS, CAMERA_GREEN_MAX_TIME_MS - Now use settings
    const TIMER_HIGHLIGHT_CLASS = 'camera-controlled-light';
    const AI_HIGHLIGHT_CLASS = 'ai-mode-highlight';
    const AI_HALO_GREEN_CLASS = 'ai-halo-effect--green';
    const AI_HALO_RED_CLASS = 'ai-halo-effect--red'; // Keep for potential future use
    const AI_HALO_AMBER_CLASS = 'ai-halo-effect--amber';
    const LIVE_TIMER_UPDATE_INTERVAL_MS = 1000;
    const TRAFFIC_LIGHT_ALL_RED_DELAY_MS = 1000;
    const DEFAULT_API_CALLS_PER_MINUTE = 6; // Fallback if setting is invalid
    const DEFAULT_GREEN_LIGHT_DURATION_MS = 3000; // Fallback
    const DEFAULT_YELLOW_LIGHT_DURATION_MS = 1000; // Fallback
    const DEFAULT_MAX_TIME_SMART_A_MS = 10000; // Fallback (10 seconds)

    // --- DOM Element References ---
    const cameraFeedImg = document.getElementById('cameraFeedImg');
    const analysisStatus = document.getElementById('analysisStatus');
    const analysisSpinner = document.getElementById('analysisSpinner');
    const cameraError = document.getElementById('cameraError');
    const analysisErrorDiv = document.getElementById('analysisError');
    const analysisDataDiv = document.getElementById('analysisData');
    const resultsPlaceholder = document.getElementById('resultsPlaceholder');
    const vehiclesPresentSpan = document.getElementById('vehiclesPresent');
    const carCountSpan = document.getElementById('carCount');
    const bikeCountSpan = document.getElementById('bikeCount');
    const truckCountSpan = document.getElementById('truckCount');
    const busCountSpan = document.getElementById('busCount');
    const unknownCountSpan = document.getElementById('unknownCount');
    const lastUpdateTimestamp = document.getElementById('lastUpdateTimestamp');
    const currentModeSpan = document.getElementById('currentMode');
    const currentRateSpan = document.getElementById('currentRate'); // Will now show calls/min
    const processErrorSpan = document.getElementById('processError');
    const lightElements = {
        A: { red: document.getElementById('light-A-red'), yellow: document.getElementById('light-A-yellow'), green: document.getElementById('light-A-green') },
        B: { red: document.getElementById('light-B-red'), yellow: document.getElementById('light-B-yellow'), green: document.getElementById('light-B-green') },
        C: { red: document.getElementById('light-C-red'), yellow: document.getElementById('light-C-yellow'), green: document.getElementById('light-C-green') },
        D: { red: document.getElementById('light-D-red'), yellow: document.getElementById('light-D-yellow'), green: document.getElementById('light-D-green') }
    };
    const lightGroupElements = {
        A: document.getElementById('light-group-A'),
        B: document.getElementById('light-group-B'),
        C: document.getElementById('light-group-C'),
        D: document.getElementById('light-group-D')
    };
    const timerElements = {
        A: document.getElementById('timer-A'),
        B: document.getElementById('timer-B'),
        C: document.getElementById('timer-C'),
        D: document.getElementById('timer-D')
    };
    const trafficDirections = ['A', 'B', 'C', 'D'];
    const modeToggle = document.getElementById('modeToggle');
    const modeToggleLabel = document.getElementById('modeToggleLabel');
    const aiModeSectionsDiv = document.getElementById('ai-mode-sections');
    const directionALabel = document.getElementById('direction-A-label');
    // *** References for LLM Log Card ***
    const llmResponsePlaceholder = document.getElementById('llmResponsePlaceholder');
    const llmLogContainer = document.getElementById('llmLogContainer');
    const llmApiDuration = document.getElementById('llmApiDuration');

    // --- State Variables ---
    let analysisTimeoutId = null; // ID for the next scheduled analysis call (setTimeout)
    let isAnalysisInProgress = false; // Flag to prevent concurrent calls
    let currentSettings = {
        mode: 'Image',
        apiCallsPerMinute: DEFAULT_API_CALLS_PER_MINUTE,
        resolution: 'default',
        cropArea: {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
        greenLightDurationMs: DEFAULT_GREEN_LIGHT_DURATION_MS,
        yellowLightDurationMs: DEFAULT_YELLOW_LIGHT_DURATION_MS,
        maxTimeSmartA_Ms: DEFAULT_MAX_TIME_SMART_A_MS, // Added new setting
        isCameraRunning: false,
        aiBackendMode: 'NONE',
        aiModelName: 'N/A'
    };
    let isSmartModeActive = false;
    let trafficLightTimerId = null;
    let currentTrafficLightState = null;
    let latestVehiclesPresent = "False"; // Default to false
    let smartAMaxTimerId = null; // Timer for max duration of A_GREEN in AI mode
    let isInitialized = false;
    let lastGreenDirection = null; // Keep track of last green
    let cycleStartTimes = { A: 0, B: 0, C: 0, D: 0 }; // Track when each direction went green
    let lastDisplayedDurations = { A: null, B: null, C: null, D: null };
    let gemini_model = false; // Flag indicating if AI model is available
    let highlightDirection = null; // Which direction's group to highlight
    let liveTimerIntervalId = null; // Interval for updating displayed timer
    let lastAnalysisErrorTime = 0; // Track time of last analysis error for A_GREEN logic
    // ** References for one-time event listeners **
    let firstFrameLoadListener = null;
    let firstFrameErrorListener = null;


    // --- Utility Functions ---
    function displayError(element, message) { if (element) { element.textContent = message; element.style.display = 'block'; } }
    function clearError(element) { if (element) { element.textContent = ''; element.style.display = 'none'; } }
    function showSpinner(spinnerElement) { if (spinnerElement) spinnerElement.style.display = 'inline-block'; }
    function hideSpinner(spinnerElement) { if (spinnerElement) spinnerElement.style.display = 'none'; }
    function updateStatus(statusText) { if (analysisStatus) { analysisStatus.textContent = statusText; } }
    function displayProcessError(message) { if (processErrorSpan) { processErrorSpan.textContent = message; setTimeout(() => { if (processErrorSpan) processErrorSpan.textContent = ''; }, 5000); } }
    function updateDirectionALabel() { if (directionALabel) { directionALabel.textContent = isSmartModeActive ? "Direction A (Smart)" : "Direction A"; } else { console.warn("Direction A label element not found."); } }

    function updateToggleLabel() {
        const isChecked = isSmartModeActive;
        const toggleLabelText = isChecked ? 'AI Mode' : 'Timer Mode';
        if (modeToggleLabel) { modeToggleLabel.textContent = toggleLabelText; }
        if (analysisStatus && !analysisStatus.textContent.includes('Starting') && !analysisStatus.textContent.includes('Stopping') && !analysisStatus.textContent.includes('Failed') && !analysisStatus.textContent.includes('Error')) {
             updateStatus(isChecked ? 'AI Mode Active' : 'Timer Mode Active');
        }
    }
    function syncToggleState() {
        if (modeToggle) { modeToggle.checked = isSmartModeActive; }
        updateToggleLabel();
        updateDirectionALabel();
        if (aiModeSectionsDiv) {
            // Use 'flex' when visible to help with alignment of columns
            aiModeSectionsDiv.style.display = isSmartModeActive ? 'flex' : 'none';
        }
    }

    function addLogEntry(message, type = 'info') {
        if (!llmLogContainer) return;
        if (llmResponsePlaceholder && llmResponsePlaceholder.style.display !== 'none') { llmResponsePlaceholder.style.display = 'none'; }
        const entry = document.createElement('div');
        entry.classList.add('log-entry', `log-entry-${type}`);
        const timestamp = new Date().toLocaleTimeString([], { hour12: false });
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'log-timestamp';
        timestampSpan.style.color = 'var(--log-timestamp-color)';
        timestampSpan.textContent = `[${timestamp}] `;
        entry.appendChild(timestampSpan);
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (type === 'success') { messageSpan.style.color = currentTheme === 'dark' ? '#4ade80' : '#198754'; }
        else if (type === 'error') { messageSpan.style.color = currentTheme === 'dark' ? '#ff7b8a' : '#dc3545'; messageSpan.style.fontWeight = 'bold'; }
        else if (type === 'info') { messageSpan.style.color = currentTheme === 'dark' ? '#adb5bd' : '#6c757d'; }
        entry.appendChild(messageSpan);
        llmLogContainer.appendChild(entry);
        llmLogContainer.scrollTop = llmLogContainer.scrollHeight;
    }

    function clearAnalysisDisplay() {
        if (analysisDataDiv) analysisDataDiv.style.display = 'none';
        if (analysisErrorDiv) clearError(analysisErrorDiv);
        if (resultsPlaceholder) {
            resultsPlaceholder.style.display = 'block';
            resultsPlaceholder.textContent = isSmartModeActive ? 'Waiting for analysis...' : 'Toggle to AI Mode for analysis.';
        }
        if (lastUpdateTimestamp) lastUpdateTimestamp.textContent = 'Never';
        latestVehiclesPresent = "False"; // Reset state
        if (llmLogContainer) llmLogContainer.innerHTML = '';
        if (llmResponsePlaceholder) {
            llmResponsePlaceholder.style.display = 'block';
            llmResponsePlaceholder.textContent = isSmartModeActive ? 'Waiting for LLM activity...' : 'Toggle to AI Mode to see LLM activity.';
        }
        if (llmApiDuration) llmApiDuration.textContent = 'N/A';
        lastAnalysisErrorTime = 0; // Reset error time tracker
    }

    // Only update parsed results, raw response is handled by addLogEntry
    function updateResultsDisplay(parsedData) {
        if (!isSmartModeActive) return; // Don't update if not in AI mode

        const previousVehiclesPresent = latestVehiclesPresent; // Store previous state

        if (analysisDataDiv && resultsPlaceholder) {
            if (parsedData && typeof parsedData === 'object' && parsedData !== null) {
                resultsPlaceholder.style.display = 'none';
                analysisDataDiv.style.display = 'block';
                clearError(analysisErrorDiv);
                latestVehiclesPresent = parsedData.Vehicles_Present || "False"; // Update state
                vehiclesPresentSpan.textContent = latestVehiclesPresent === "True" ? "Yes" : "No";
                vehiclesPresentSpan.className = latestVehiclesPresent === "True" ? "fw-bold text-danger" : "fw-bold text-success";
                carCountSpan.textContent = parsedData.Cars ?? 'N/A';
                bikeCountSpan.textContent = parsedData.Bikes ?? 'N/A';
                truckCountSpan.textContent = parsedData.Trucks ?? 'N/A';
                busCountSpan.textContent = parsedData.Buses ?? 'N/A';
                unknownCountSpan.textContent = parsedData.Unknown ?? 'N/A';
                lastUpdateTimestamp.textContent = new Date().toLocaleString();

                // --- Rule 2b: No Vehicles Detected while A is Green ---
                // If vehicles disappeared while A was green, force cycle
                if (currentTrafficLightState === 'A_GREEN' && latestVehiclesPresent === "False" && previousVehiclesPresent === "True") {
                    console.log("Rule 2b: Vehicles cleared during A_GREEN. Forcing cycle.");
                    addLogEntry("Vehicles cleared, cycling Direction A.", 'info');
                    forceCycleFromA('NO_VEHICLES'); // Pass reason
                }
            } else {
                if (analysisDataDiv) analysisDataDiv.style.display = 'none';
                if (resultsPlaceholder) {
                    resultsPlaceholder.style.display = 'block';
                    resultsPlaceholder.textContent = 'Received invalid analysis data.';
                }
                if (analysisErrorDiv) clearError(analysisErrorDiv);
                latestVehiclesPresent = "False"; // Assume false if data is bad
            }
        } else {
            latestVehiclesPresent = "False"; // Assume false if elements are missing
        }
    }

     function updateFooterInfo() {
         if (currentModeSpan) currentModeSpan.textContent = currentSettings.mode || 'Unknown';
         if (currentRateSpan) {
             const rate = currentSettings.apiCallsPerMinute || DEFAULT_API_CALLS_PER_MINUTE;
             currentRateSpan.textContent = `${rate}/min`;
         }
     }

     function formatJsonLog(text) {
        if (!text || typeof text !== 'string') return text || '(Empty Response)';
        let cleanedText = text.trim();
        if (cleanedText.startsWith("```json")) { cleanedText = cleanedText.substring(7).trim(); }
        else if (cleanedText.startsWith("```")) { cleanedText = cleanedText.substring(3).trim(); }
        if (cleanedText.endsWith("```")) { cleanedText = cleanedText.substring(0, cleanedText.length - 3).trim(); }
        if (cleanedText.startsWith("{") && cleanedText.endsWith("}")) {
            try { const jsonObj = JSON.parse(cleanedText); return JSON.stringify(jsonObj); }
            catch (e) { /* ignore parse error, return cleaned text */ }
        }
        return cleanedText;
    }

    // --- Traffic Light Control Functions ---
     function setAllLightsRed() {
        trafficDirections.forEach(dir => {
            const lights = lightElements[dir];
            if (lights) {
                if (lights.red && !lights.red.classList.contains('active')) lights.red.classList.add('active');
                if (lights.yellow && lights.yellow.classList.contains('active')) lights.yellow.classList.remove('active');
                if (lights.green && lights.green.classList.contains('active')) lights.green.classList.remove('active');
            }
        });
    }
    function setLightState(direction, color) {
        setAllLightsRed(); // Start by setting all red
        const lights = lightElements[direction];
        if (!lights) { console.error(`Invalid direction: ${direction}`); return; }

        // If setting green or yellow, ensure red is off for that direction
        if ((color === 'yellow' || color === 'green') && lights.red && lights.red.classList.contains('active')) {
             lights.red.classList.remove('active');
        }
        // Activate the target color
        const lightEl = lights[color];
        if (lightEl) {
             if (!lightEl.classList.contains('active')) lightEl.classList.add('active');
        } else {
             console.error(`Invalid color element '${color}' for ${direction}, defaulting to red.`);
             if (lights.red && !lights.red.classList.contains('active')) lights.red.classList.add('active'); // Ensure red is on if color is invalid
        }
    }
    function updateActiveLightBorder(directionToHighlight) {
        const timerHighlightClass = TIMER_HIGHLIGHT_CLASS;
        const aiHighlightClass = AI_HIGHLIGHT_CLASS;
        trafficDirections.forEach(dir => {
            const groupElement = lightGroupElements[dir];
            if (groupElement) {
                groupElement.classList.remove(timerHighlightClass, aiHighlightClass);
                if (dir === directionToHighlight) {
                    // Only use AI highlight for Direction A when in Smart Mode
                    if (dir === 'A' && isSmartModeActive) {
                        groupElement.classList.add(aiHighlightClass);
                    } else {
                        // Use Timer highlight for A in Timer Mode, or for B/C/D always
                        groupElement.classList.add(timerHighlightClass);
                    }
                }
            } else { console.warn(`Light group element ${dir} not found during border update.`); }
        });
    }

    // --- MODIFIED: Renamed and simplified ---
    function clearSmartATimers() {
        if (smartAMaxTimerId) {
            clearTimeout(smartAMaxTimerId);
            smartAMaxTimerId = null;
            console.log("Cleared Smart A Max Timer.");
        }
    }

    // --- MODIFIED: Force cycle for A_GREEN (AI Mode) ---
    function forceCycleFromA(reason = 'UNKNOWN') {
        console.log(`Forcing cycle from A_GREEN (AI Mode). Reason: ${reason}`);
        if (currentTrafficLightState === 'A_GREEN' && isSmartModeActive) {
             clearSmartATimers(); // Clear any running max timer
             advanceTrafficLights('A_YELLOW'); // Move immediately to yellow
        } else {
            console.log(`forceCycleFromA ignored (State: ${currentTrafficLightState}, Mode: ${isSmartModeActive ? 'AI' : 'Timer'}).`);
        }
    }
    // --- REMOVED checkBaseTimeExpired - Logic integrated into analysis result and error handling ---

    function resetTimerLabel(direction) {
        if (timerElements[direction]) {
             timerElements[direction].textContent = '0 Sec';
             lastDisplayedDurations[direction] = 0;
        }
    }
    function resetAllTimerLabels() {
        trafficDirections.forEach(dir => resetTimerLabel(dir));
        cycleStartTimes = { A: 0, B: 0, C: 0, D: 0 };
    }
    function updateTimerLabel(direction, durationMs) {
        if (!timerElements[direction] || durationMs < 0) return;
        const durationSec = Math.round(durationMs / 1000);
        if (durationSec !== lastDisplayedDurations[direction]) {
            timerElements[direction].textContent = `${durationSec} Sec`;
            lastDisplayedDurations[direction] = durationSec;
        }
    }
    function updateActiveTimerDisplay() {
        if (highlightDirection && cycleStartTimes[highlightDirection] > 0) {
             const elapsedMs = Date.now() - cycleStartTimes[highlightDirection];
             updateTimerLabel(highlightDirection, elapsedMs);
        }
    }

    // --- Traffic Light State Machine ---
    function advanceTrafficLights(newState) {
        if (!isInitialized) { console.warn("advanceTrafficLights aborted: not initialized."); return; }
        if (trafficLightTimerId) { clearTimeout(trafficLightTimerId); trafficLightTimerId = null; } // Clear previous timer

        // Clear Smart A timers if leaving A_GREEN in AI mode
        if (currentTrafficLightState === 'A_GREEN' && isSmartModeActive && newState !== 'A_GREEN') {
            clearSmartATimers();
        }

        const now = Date.now();
        let completedDirection = null; // Track which direction's timer label to finalize
        if (newState === 'ALL_RED_BEFORE_B' && cycleStartTimes.A > 0) completedDirection = 'A';
        else if (newState === 'ALL_RED_BEFORE_C' && cycleStartTimes.B > 0) completedDirection = 'B';
        else if (newState === 'ALL_RED_BEFORE_D' && cycleStartTimes.C > 0) completedDirection = 'C';
        else if (newState === 'ALL_RED_BEFORE_A' && cycleStartTimes.D > 0) completedDirection = 'D';

        // Update the timer label for the direction that just finished its green/yellow cycle
        if (completedDirection && cycleStartTimes[completedDirection]) {
            const durationMs = now - cycleStartTimes[completedDirection];
            updateTimerLabel(completedDirection, durationMs);
            cycleStartTimes[completedDirection] = 0; // Reset start time
        }

        currentTrafficLightState = newState; // Update current state
        let nextState = null;
        let delay = 0;
        // Get durations from settings, with fallbacks
        let greenDuration = currentSettings.greenLightDurationMs || DEFAULT_GREEN_LIGHT_DURATION_MS;
        let yellowDuration = currentSettings.yellowLightDurationMs || DEFAULT_YELLOW_LIGHT_DURATION_MS;
        let maxTimeSmartA = currentSettings.maxTimeSmartA_Ms || DEFAULT_MAX_TIME_SMART_A_MS;

        console.log(`Advancing to state: ${newState} (Mode: ${isSmartModeActive ? 'AI' : 'Timer'})`);

        try {
            switch (newState) {
                // --- Direction A Logic ---
                case 'A_GREEN':
                    resetTimerLabel('A'); // Reset display timer
                    highlightDirection = 'A';
                    cycleStartTimes.A = now; // Record start time for A
                    if (isSmartModeActive) {
                        // Analysis should have ideally run during D_GREEN. Check result now.
                        if (latestVehiclesPresent !== "True") {
                            console.log("Rule 1b: No vehicles detected on A. Skipping green, going to yellow.");
                            addLogEntry("No vehicles detected on A, skipping green.", 'info');
                            setLightState('A', 'yellow');
                            delay = yellowDuration;
                            nextState = 'ALL_RED_BEFORE_B';
                        } else {
                            console.log("Rule 1a: Vehicles detected on A. Turning green.");
                            addLogEntry("Vehicles detected on A, turning green.", 'info');
                            setLightState('A', 'green');
                            clearSmartATimers();
                            console.log(`Setting max timer for A_GREEN: ${maxTimeSmartA}ms`);
                            smartAMaxTimerId = setTimeout(() => {
                                console.log("Rule 2a: Max time expired for A_GREEN.");
                                addLogEntry("Max time expired for Direction A.", 'info');
                                forceCycleFromA('MAX_TIME');
                            }, maxTimeSmartA);
                            nextState = null; // Wait for analysis/timer
                            delay = 0;
                            // Ensure analysis resumes if it was paused
                            scheduleNextAnalysis(false); // Resume analysis loop
                        }
                    } else {
                        // Timer Mode
                        setLightState('A', 'green');
                        delay = greenDuration;
                        nextState = 'A_YELLOW';
                    }
                    break;

                case 'A_YELLOW':
                    setLightState('A', 'yellow');
                    highlightDirection = 'A';
                    delay = yellowDuration;
                    nextState = 'ALL_RED_BEFORE_B';
                    clearSmartATimers(); // Ensure timers cleared
                    // *** MODIFICATION: Stop analysis when A turns yellow ***
                    if (isSmartModeActive) {
                        console.log("State A_YELLOW: Cancelling analysis.");
                        addLogEntry("Direction A yellow, pausing analysis.", 'info');
                        cancelNextAnalysis();
                    }
                    break;

                case 'ALL_RED_BEFORE_B':
                    setAllLightsRed();
                    highlightDirection = 'A';
                    delay = TRAFFIC_LIGHT_ALL_RED_DELAY_MS;
                    nextState = 'B_GREEN';
                    // Analysis remains cancelled from A_YELLOW state
                    break;

                // --- Directions B, C ---
                case 'B_GREEN': resetTimerLabel('B'); setLightState('B', 'green'); highlightDirection = 'B'; cycleStartTimes.B = now; delay = greenDuration; nextState = 'B_YELLOW'; break;
                case 'B_YELLOW': setLightState('B', 'yellow'); highlightDirection = 'B'; delay = yellowDuration; nextState = 'ALL_RED_BEFORE_C'; break;
                case 'ALL_RED_BEFORE_C': setAllLightsRed(); highlightDirection = 'B'; delay = TRAFFIC_LIGHT_ALL_RED_DELAY_MS; nextState = 'C_GREEN'; break;
                case 'C_GREEN': resetTimerLabel('C'); setLightState('C', 'green'); highlightDirection = 'C'; cycleStartTimes.C = now; delay = greenDuration; nextState = 'C_YELLOW'; break;
                case 'C_YELLOW': setLightState('C', 'yellow'); highlightDirection = 'C'; delay = yellowDuration; nextState = 'ALL_RED_BEFORE_D'; break;
                case 'ALL_RED_BEFORE_D': setAllLightsRed(); highlightDirection = 'C'; delay = TRAFFIC_LIGHT_ALL_RED_DELAY_MS; nextState = 'D_GREEN'; break;

                // --- Direction D ---
                case 'D_GREEN':
                    resetTimerLabel('D');
                    setLightState('D', 'green');
                    highlightDirection = 'D';
                    cycleStartTimes.D = now;
                    delay = greenDuration;
                    nextState = 'D_YELLOW';
                    // *** MODIFICATION: Start analysis when D turns green ***
                    if (isSmartModeActive) {
                        console.log("State D_GREEN: Scheduling analysis restart.");
                        addLogEntry("Direction D green, resuming analysis.", 'info');
                        scheduleNextAnalysis(false); // Restart analysis loop
                    }
                    break;
                case 'D_YELLOW': setLightState('D', 'yellow'); highlightDirection = 'D'; delay = yellowDuration; nextState = 'ALL_RED_BEFORE_A'; break;
                case 'ALL_RED_BEFORE_A': setAllLightsRed(); highlightDirection = 'D'; delay = TRAFFIC_LIGHT_ALL_RED_DELAY_MS; nextState = 'A_GREEN'; break;

                default:
                    console.error(`Invalid state encountered: ${newState}. Resetting to all red.`);
                    setAllLightsRed();
                    highlightDirection = null;
                    resetAllTimerLabels();
                    clearSmartATimers();
                     // Ensure analysis is cancelled in error state
                    if (isSmartModeActive) cancelNextAnalysis();
                    return;
            }
        } catch (error) {
            console.error(`Error during state switch logic for ${newState}:`, error);
            setAllLightsRed(); highlightDirection = null; clearSmartATimers();
            // Ensure analysis is cancelled in error state
            if (isSmartModeActive) cancelNextAnalysis();
            return;
        }

        // Update visual cues (border, halo) - Logic from previous correction
        const lightGroupA = lightGroupElements.A;
        if (lightGroupA) {
             lightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_AMBER_CLASS);
             if (isSmartModeActive) {
                 const isControlConsideredA = (newState === 'A_GREEN' || newState === 'A_YELLOW' || newState === 'ALL_RED_BEFORE_B');
                 if (newState === 'A_GREEN') {
                     lightGroupA.classList.add(AI_HALO_GREEN_CLASS);
                 } else if (!isControlConsideredA) {
                     lightGroupA.classList.add(AI_HALO_AMBER_CLASS);
                 }
             }
        } else { console.warn("Light group element A not found for halo update."); }
        updateActiveLightBorder(highlightDirection);

        // Schedule the next state transition if needed
        if (nextState && delay > 0) {
            trafficLightTimerId = setTimeout(() => {
                if (currentTrafficLightState === newState) {
                    advanceTrafficLights(nextState);
                } else {
                    console.log(`Skipping scheduled transition from ${newState} to ${nextState}. Current state is now ${currentTrafficLightState}.`);
                }
            }, delay);
        }
    } // --- End advanceTrafficLights ---


    // --- Camera Feed Handling ---
     function refreshVideoStream() {
        console.log("Attempting to refresh video stream...");
        if (cameraFeedImg) {
             const timestamp = new Date().getTime();
             const baseSrc = cameraFeedImg.src.split("?")[0];
             const newSrc = baseSrc + "?t=" + timestamp;
             cameraFeedImg.src = newSrc;
             console.log("Video stream source updated to:", newSrc);
             if (cameraError) cameraError.style.display = 'none';
             cameraFeedImg.style.display = 'block';
        } else {
            console.warn("refreshVideoStream called but cameraFeedImg element not found.");
        }
    }
     if (cameraFeedImg) {
         cameraFeedImg.onerror = function() {
             console.error("Error loading camera feed image.");
             displayError(cameraError, 'Error loading video stream from server.');
             cameraFeedImg.style.display = 'none';
             updateStatus('Video Error');
             if (isSmartModeActive && currentTrafficLightState === 'A_GREEN') {
                 console.warn("Video error occurred during A_GREEN. Checking standard green time...");
                 const elapsedGreenTime = Date.now() - (cycleStartTimes.A || Date.now());
                 if (elapsedGreenTime >= (currentSettings.greenLightDurationMs || DEFAULT_GREEN_LIGHT_DURATION_MS)) {
                    console.log("Rule 2c (Video Error): Standard green time met. Forcing cycle.");
                    addLogEntry("Video Error during A_GREEN (standard time met), forcing cycle.", "error");
                    forceCycleFromA('VIDEO_ERROR_TIMEOUT');
                 } else {
                    console.log("Rule 2c (Video Error): Standard green time not met. Allowing max timer to proceed.");
                    addLogEntry("Video Error during A_GREEN (standard time not met).", "error");
                 }
             }
         };
         cameraFeedImg.onload = function() {
             console.log("Camera feed image loaded successfully.");
             clearError(cameraError);
             cameraFeedImg.style.display = 'block';
             if (analysisStatus && analysisStatus.textContent === 'Video Error') {
                  updateStatus(isSmartModeActive ? 'AI Mode Active' : 'Timer Mode Active');
             }
         };
     }


    // --- Analysis Logic & Scheduling ---
    async function triggerAnalysis() {
        // Prevent analysis if not in AI mode, AI model not ready, already in progress, or offline
        // Also check if current state allows analysis (i.e., not paused during A_YELLOW/A_RED)
        const analysisAllowedStates = ['D_GREEN', 'D_YELLOW', 'ALL_RED_BEFORE_A', 'A_GREEN', 'B_GREEN', 'B_YELLOW', 'ALL_RED_BEFORE_C', 'C_GREEN', 'C_YELLOW', 'ALL_RED_BEFORE_D'];
        if (!isSmartModeActive || !gemini_model || isAnalysisInProgress || !navigator.onLine || !analysisAllowedStates.includes(currentTrafficLightState)) {
             if (!isSmartModeActive) console.log("Analysis trigger skipped: AI mode not active.");
             if (!gemini_model) console.log("Analysis trigger skipped: AI model not ready.");
             if (isAnalysisInProgress) console.warn("Analysis trigger skipped: Previous analysis still in progress.");
             if (!navigator.onLine) {
                 console.warn("Analysis trigger skipped: Browser is offline.");
                 displayProcessError("Offline - Cannot perform analysis.");
                 updateStatus("Offline");
                 addLogEntry("Offline - Cannot perform analysis.", "error");
                 // scheduleNextAnalysis(false, true); // Schedule next attempt after delay? Maybe not if offline.
                 // Rule 2c check for Offline during A_GREEN remains relevant
                 if (currentTrafficLightState === 'A_GREEN') { /* ... (existing offline check) ... */ }
             }
              if (!analysisAllowedStates.includes(currentTrafficLightState)) {
                 console.log(`Analysis trigger skipped: Current state (${currentTrafficLightState}) does not allow analysis.`);
                 // Don't reschedule automatically here, scheduleNextAnalysis is called from D_GREEN
             }
             isAnalysisInProgress = false;
             return;
        }

        // --- Start Analysis ---
        isAnalysisInProgress = true;
        showSpinner(analysisSpinner);
        console.log(`Triggering analysis (State: ${currentTrafficLightState})...`);
        addLogEntry("Calling LLM API...", 'info');

        let startTime = performance.now();
        let rawResponseText = null;
        let responseJson = null;
        let parsedData = null;
        let apiErrorOccurred = false;
        let responseOk = false;
        let isQuotaError = false;
        let statusToSetOnError = 'Analysis Error';

        try {
            const response = await fetch('/api/analyze', { method: 'POST' });
            responseOk = response.ok;
            rawResponseText = await response.text();
            try { responseJson = JSON.parse(rawResponseText); } catch (e) { responseJson = null; }

            const loggableResponseText = responseJson?.raw_response || rawResponseText || '(Empty Response Body)';
            const formattedLogText = formatJsonLog(loggableResponseText);

            if (responseOk) {
                addLogEntry(formattedLogText, 'success');
            } else {
                addLogEntry(formattedLogText, 'error'); // Log error response content
            }

            if (!responseOk) {
                 apiErrorOccurred = true;
                 lastAnalysisErrorTime = Date.now(); // Record error time
                 let errorMessage;

                 if (response.status === 429 && responseJson?.quota_error) {
                     isQuotaError = true;
                     errorMessage = responseJson.quota_error;
                     statusToSetOnError = 'API Quota Exceeded';
                 } else if (response.status === 409) { // Camera stopped mid-analysis
                     errorMessage = responseJson?.error || "Camera stopped during analysis request.";
                     statusToSetOnError = 'Camera Stopped';
                     // If camera stops, we likely shouldn't reschedule analysis
                     apiErrorOccurred = true; // Ensure error handling treats this seriously
                 } else if (response.status === 503 && responseJson?.error?.includes("AI backend not available")) {
                     errorMessage = responseJson.error;
                     statusToSetOnError = 'AI Backend Error';
                 } else if (response.status === 503) { // Other 503 (e.g., AI call failed)
                     errorMessage = responseJson?.error || "AI analysis backend failed.";
                     statusToSetOnError = 'AI Analysis Error';
                 } else if (response.status === 502) { // Bad gateway (parse error on backend)
                     errorMessage = responseJson?.error || "Invalid response from AI backend.";
                     statusToSetOnError = 'AI Response Error';
                 } else {
                     errorMessage = responseJson?.error || formattedLogText || response.statusText;
                     statusToSetOnError = `API Error (${response.status})`;
                 }

                 const fullErrorMsg = `${statusToSetOnError}: ${errorMessage}`;
                 console.error("Analysis API Error:", fullErrorMsg, "Raw:", rawResponseText);
                 displayError(analysisErrorDiv, fullErrorMsg);
                 addLogEntry(fullErrorMsg, 'error'); // Log specific error
                 updateStatus(statusToSetOnError);
                 updateResultsDisplay(null); // Clear results

                 // If camera stopped, prevent rescheduling implicitly by apiErrorOccurred flag
                 if (statusToSetOnError === 'Camera Stopped') {
                    console.warn("Camera stopped during analysis, analysis loop halted.");
                 }

            } else {
                // Success Path
                clearError(analysisErrorDiv);
                if (responseJson !== null) {
                    parsedData = responseJson;
                    console.log("Analysis successful (parsed):", parsedData);
                    let displayData = { ...parsedData }; delete displayData.raw_response;
                    updateResultsDisplay(displayData); // Update results card (triggers Rule 2b if needed)
                } else {
                     apiErrorOccurred = true; // Treat non-JSON success as an error
                     lastAnalysisErrorTime = Date.now();
                     const parseErrorMsg = "Received non-JSON success response from backend.";
                     console.error(parseErrorMsg, "\nRaw text:", rawResponseText);
                     displayError(analysisErrorDiv, parseErrorMsg);
                     addLogEntry(parseErrorMsg, 'error');
                     updateResultsDisplay(null);
                     statusToSetOnError = 'Response Format Error';
                     updateStatus(statusToSetOnError);
                }
            }
        } catch (error) {
            // Network or fetch-related errors
            apiErrorOccurred = true;
            responseOk = false;
            lastAnalysisErrorTime = Date.now();
            const networkErrorMsg = `Network Error: ${error.message}`;
            console.error("Network or fetch error during analysis:", error);
            displayError(analysisErrorDiv, networkErrorMsg);
            addLogEntry(networkErrorMsg, 'error');
            updateResultsDisplay(null);
            statusToSetOnError = "Network Error";
            updateStatus(statusToSetOnError);
        } finally {
            hideSpinner(analysisSpinner);
            const elapsedTime = performance.now() - startTime;
            if (llmApiDuration) llmApiDuration.textContent = `${(elapsedTime / 1000).toFixed(3)} Sec`;

            // --- Rule 2c: API/Logical Errors during A_GREEN ---
            if (apiErrorOccurred && currentTrafficLightState === 'A_GREEN' && isSmartModeActive) {
                 const elapsedGreenTime = Date.now() - (cycleStartTimes.A || Date.now());
                 const standardGreenTime = currentSettings.greenLightDurationMs || DEFAULT_GREEN_LIGHT_DURATION_MS;
                 if (elapsedGreenTime >= standardGreenTime) {
                     console.log(`Rule 2c (API Error - ${statusToSetOnError}): Standard green time met (${elapsedGreenTime}ms >= ${standardGreenTime}ms). Forcing cycle.`);
                     addLogEntry(`API Error during A_GREEN (standard time met), forcing cycle.`, "error");
                     forceCycleFromA('API_ERROR_TIMEOUT');
                 } else {
                     console.log(`Rule 2c (API Error - ${statusToSetOnError}): Standard green time not met (${elapsedGreenTime}ms < ${standardGreenTime}ms). Allowing max timer.`);
                     addLogEntry(`API Error during A_GREEN (standard time not met).`, "error");
                 }
            }

            isAnalysisInProgress = false; // Mark as finished *before* scheduling next

            // Schedule next analysis ONLY if AI mode is active AND no critical error occurred (like camera stopping)
            // The scheduling itself will be triggered again from D_GREEN state by advanceTrafficLights
            // We only need to schedule the *next* immediate call if analysis is allowed in the current state
            if (isSmartModeActive && !apiErrorOccurred && analysisAllowedStates.includes(currentTrafficLightState)) {
                 scheduleNextAnalysis(false, apiErrorOccurred); // Schedule next regular call (force delay on error)
            } else if (apiErrorOccurred) {
                 console.log(`Not scheduling next analysis due to error (${statusToSetOnError}) or disallowed state.`);
            } else {
                 console.log("Not scheduling next analysis as current state does not allow it or AI mode is off.");
            }
        }
     }


     function removeFirstFrameListeners() {
         if (firstFrameLoadListener && cameraFeedImg) { cameraFeedImg.removeEventListener('load', firstFrameLoadListener); firstFrameLoadListener = null; }
         if (firstFrameErrorListener && cameraFeedImg) { cameraFeedImg.removeEventListener('error', firstFrameErrorListener); firstFrameErrorListener = null; }
     }
     function scheduleNextAnalysis(useStartupCheck = false, forceMinDelay = false) {
        if (analysisTimeoutId) { clearTimeout(analysisTimeoutId); analysisTimeoutId = null; }
        removeFirstFrameListeners(); // Ensure listeners are removed before scheduling

        // Double check conditions before scheduling the timeout
        const analysisAllowedStates = ['D_GREEN', 'D_YELLOW', 'ALL_RED_BEFORE_A', 'A_GREEN', 'B_GREEN', 'B_YELLOW', 'ALL_RED_BEFORE_C', 'C_GREEN', 'C_YELLOW', 'ALL_RED_BEFORE_D'];
        if (!isSmartModeActive || !analysisAllowedStates.includes(currentTrafficLightState)) {
            console.log(`Not scheduling analysis: AI mode off or current state (${currentTrafficLightState}) prevents it.`);
            isAnalysisInProgress = false; return;
        }
        isAnalysisInProgress = false; // Ensure flag is reset

        const callsPerMinute = currentSettings.apiCallsPerMinute > 0 ? currentSettings.apiCallsPerMinute : DEFAULT_API_CALLS_PER_MINUTE;
        const minDelayMs = Math.max(500, 60000 / callsPerMinute); // Ensure minimum 0.5s delay

        // Startup check is usually only needed once when AI mode starts
        if (useStartupCheck && cameraFeedImg) {
            console.log("Performing startup check for first frame...");
            if (cameraFeedImg.complete && cameraFeedImg.naturalWidth > 0) {
                console.log("First frame already loaded. Scheduling analysis immediately.");
                analysisTimeoutId = setTimeout(triggerAnalysis, 0);
            } else {
                console.log("First frame not loaded yet. Attaching listeners...");
                addLogEntry("Waiting for first camera frame...", 'info');
                firstFrameLoadListener = () => {
                    console.log("First frame loaded via event listener. Scheduling analysis.");
                    addLogEntry("First frame received.", 'info');
                    removeFirstFrameListeners();
                    // Check state again *after* frame loads, before scheduling
                     if (isSmartModeActive && analysisAllowedStates.includes(currentTrafficLightState)) {
                        analysisTimeoutId = setTimeout(triggerAnalysis, 0);
                     } else {
                         console.log("State changed or AI mode off after first frame loaded, not scheduling analysis.");
                     }
                };
                firstFrameErrorListener = () => {
                    console.error("Error loading first frame via event listener.");
                    addLogEntry("Error loading camera stream.", 'error');
                    removeFirstFrameListeners();
                    // Schedule a delayed attempt even on error, but check state again
                    if (isSmartModeActive && analysisAllowedStates.includes(currentTrafficLightState)) {
                         console.log(`Scheduling fallback analysis trigger in ${minDelayMs}ms due to frame load error.`);
                         analysisTimeoutId = setTimeout(triggerAnalysis, minDelayMs);
                    } else {
                         console.log("State changed or AI mode off after frame load error, not scheduling analysis.");
                    }
                };
                cameraFeedImg.addEventListener('load', firstFrameLoadListener, { once: true });
                cameraFeedImg.addEventListener('error', firstFrameErrorListener, { once: true });
            }
        } else {
            // Regular scheduling: Use minDelayMs if forced, otherwise 0 (immediate)
            const delayMs = forceMinDelay ? minDelayMs : 0;
            if (delayMs > 0) console.log(`Scheduling next analysis trigger after forced delay: ${delayMs.toFixed(0)}ms`);
            else console.log(`Scheduling next analysis trigger.`);
            analysisTimeoutId = setTimeout(triggerAnalysis, delayMs);
        }
     }
     function cancelNextAnalysis() {
        if (analysisTimeoutId) { clearTimeout(analysisTimeoutId); analysisTimeoutId = null; console.log("Pending analysis timeout cancelled."); }
        removeFirstFrameListeners(); // Ensure listeners are removed
        isAnalysisInProgress = false; // Reset flag
     }

    // --- Toggle Switch Handler ---
    async function handleToggleChange(event, internalCall = false) {
        const lightGroupA = lightGroupElements.A;
        const shouldBeSmartMode = modeToggle.checked;

        if (shouldBeSmartMode === isSmartModeActive && !internalCall) return; // No change needed

        isSmartModeActive = shouldBeSmartMode;
        syncToggleState(); // Update labels and visibility
        clearAnalysisDisplay(); // Clear results and logs

        if (shouldBeSmartMode) {
            // --- Turn ON AI Mode ---
            console.log("Attempting to turn ON AI Mode...");
            resetAllTimerLabels(); // Reset display timers
            showSpinner(analysisSpinner);
            if(resultsPlaceholder) resultsPlaceholder.textContent = 'Starting camera...';
            if(llmResponsePlaceholder) llmResponsePlaceholder.textContent = 'Starting camera...';
            addLogEntry("AI Mode activated. Starting camera...", 'info');
            updateStatus('Starting Camera...');

            try {
                const startResponse = await fetch('/api/camera/start', { method: 'POST' });
                if (!startResponse.ok) { const err = await startResponse.json(); throw new Error(err.error || `Failed start camera (${startResponse.status})`); }
                addLogEntry("Camera started successfully.", 'info');
                await loadInitialSettingsAndSync(false); // Reload settings (don't restart lights yet)
                refreshVideoStream(); // Refresh feed

                if (!gemini_model) {
                    console.warn("AI Backend is not available."); updateStatus("AI Mode (No Backend)");
                    displayError(analysisErrorDiv, "AI Backend not available."); addLogEntry("AI Backend not available. Analysis disabled.", 'error');
                } else {
                    console.log("AI Backend available. Preparing for analysis."); updateStatus('AI Mode Active');
                    addLogEntry("AI Backend ready.", 'info');
                    // Analysis will be started by advanceTrafficLights when state allows (e.g., D_GREEN)
                }
                // Start/Restart light cycle in the new mode
                console.log("Restarting/Syncing traffic light cycle in AI mode.");
                 // Start cycle; analysis scheduling is handled within advanceTrafficLights
                advanceTrafficLights(currentTrafficLightState || 'A_GREEN');

                if(analysisStatus && !analysisStatus.textContent.includes('Failed') && !analysisStatus.textContent.includes('Error')) { hideSpinner(analysisSpinner); }

            } catch (error) {
                 console.error("ERROR turning ON AI Mode:", error);
                 displayProcessError(`ERROR: ${error.message}. Check logs.`); updateStatus('AI Mode Failed!');
                 addLogEntry(`ERROR starting AI Mode: ${error.message}`, 'error');
                 isSmartModeActive = false; syncToggleState(); // Revert toggle state
                 if (lightGroupA) { lightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_RED_CLASS, AI_HALO_AMBER_CLASS); }
                 resetAllTimerLabels(); cancelNextAnalysis(); hideSpinner(analysisSpinner); clearSmartATimers();
                 console.log("Fallback: Restarting traffic light cycle in Timer mode after AI failure.");
                 advanceTrafficLights(currentTrafficLightState || 'A_GREEN'); // Resume or start at A in Timer mode
            }
        } else {
             // --- Turn OFF AI Mode ---
             console.log("Turning OFF AI Mode...");
             resetAllTimerLabels(); // Reset display timers
             if (lightGroupA) { lightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_RED_CLASS, AI_HALO_AMBER_CLASS); } // Remove halo
             cancelNextAnalysis(); // Stop pending analysis calls
             clearSmartATimers(); // Clear AI-specific timers
             hideSpinner(analysisSpinner);
             updateStatus('Stopping Camera...');
             addLogEntry("AI Mode deactivated. Stopping camera...", 'info');

             try {
                 const stopResponse = await fetch('/api/camera/stop', { method: 'POST' });
                 if (!stopResponse.ok) { const err = await stopResponse.json(); console.error(`Error stopping camera: ${err.error || stopResponse.status}`); displayProcessError("Warn: Backend camera stop failed."); addLogEntry(`Error stopping camera: ${err.error || stopResponse.status}`, 'error'); }
                 else { console.log("Camera stop request acknowledged."); addLogEntry("Camera stopped successfully.", 'info'); }
             } catch (e) { console.error(`Network error stopping camera: ${e.message}`, e); displayProcessError("Network error stopping camera."); addLogEntry(`Network error stopping camera: ${e.message}`, 'error'); }
             finally {
                  updateStatus('Timer Mode Active');
                  refreshVideoStream(); // Refresh feed (should show placeholder)
                  console.log("Restarting/Syncing traffic light cycle in Timer mode.");
                  advanceTrafficLights(currentTrafficLightState || 'A_GREEN'); // Resume or start at A in Timer mode
             }
        }
    }

    // --- Initialization ---
    async function loadInitialSettingsAndSync(startLights = true) {
        console.log("Loading initial settings...");
        const lightGroupA = lightGroupElements.A;
        if (lightGroupA) lightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_RED_CLASS, AI_HALO_AMBER_CLASS);

        try {
             const response = await fetch('/api/settings');
             if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
             const loadedSettings = await response.json();
             console.log("Initial settings received:", loadedSettings);

             // Ensure essential settings have fallbacks
             currentSettings = {
                 ...currentSettings, // Keep defaults if backend fails
                 ...loadedSettings,
                 apiCallsPerMinute: loadedSettings.apiCallsPerMinute > 0 ? loadedSettings.apiCallsPerMinute : DEFAULT_API_CALLS_PER_MINUTE,
                 greenLightDurationMs: loadedSettings.greenLightDurationMs > 0 ? loadedSettings.greenLightDurationMs : DEFAULT_GREEN_LIGHT_DURATION_MS,
                 yellowLightDurationMs: loadedSettings.yellowLightDurationMs > 0 ? loadedSettings.yellowLightDurationMs : DEFAULT_YELLOW_LIGHT_DURATION_MS,
                 maxTimeSmartA_Ms: loadedSettings.maxTimeSmartA_Ms > 0 ? loadedSettings.maxTimeSmartA_Ms : DEFAULT_MAX_TIME_SMART_A_MS
             };

             isSmartModeActive = currentSettings.isCameraRunning === true;
             gemini_model = currentSettings.aiBackendMode !== 'NONE';

             updateFooterInfo();
             syncToggleState(); // Reflect loaded state in UI

             if (!gemini_model){
                 console.warn("AI Backend is not configured or failed initialization."); updateStatus('AI Disabled');
                 if(modeToggle) modeToggle.disabled = true; displayError(analysisErrorDiv, "AI backend not configured. AI Mode unavailable.");
                 addLogEntry("AI Backend not available. AI Mode disabled.", "error");
                 isSmartModeActive = false; syncToggleState(); // Force Timer mode UI
             } else if (isSmartModeActive) {
                 console.log("Starting in AI Mode (Camera Running)."); updateStatus('AI Mode Active');
                 addLogEntry("Initialized in AI Mode. Camera running.", "info");
                 // Analysis scheduling is now handled by advanceTrafficLights
             } else {
                 console.log("Starting in Timer Mode (Camera Stopped)."); updateStatus('Timer Mode Active');
                 addLogEntry("Initialized in Timer Mode. Camera stopped.", "info");
             }

             refreshVideoStream(); // Refresh feed

             if (startLights && !currentTrafficLightState) {
                 console.log("Starting initial traffic light cycle after settings load.");
                 advanceTrafficLights('A_GREEN'); // Start the cycle
             }

        } catch (error) {
            console.error("Error fetching initial settings:", error);
            const initErrMsg = `Failed to load settings: ${error.message}. Using defaults.`;
            displayError(analysisErrorDiv, initErrMsg); addLogEntry(initErrMsg, "error");
            isSmartModeActive = false; // Default to timer mode on error
            // Apply default settings for critical durations
            currentSettings.apiCallsPerMinute = DEFAULT_API_CALLS_PER_MINUTE;
            currentSettings.greenLightDurationMs = DEFAULT_GREEN_LIGHT_DURATION_MS;
            currentSettings.yellowLightDurationMs = DEFAULT_YELLOW_LIGHT_DURATION_MS;
            currentSettings.maxTimeSmartA_Ms = DEFAULT_MAX_TIME_SMART_A_MS;
            updateFooterInfo(); syncToggleState(); updateStatus("Settings Error");
            if (lightGroupA) lightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_RED_CLASS, AI_HALO_AMBER_CLASS);
            if (startLights && !currentTrafficLightState) {
                console.log("Starting initial traffic light cycle in fallback Timer Mode (Settings Error).");
                advanceTrafficLights('A_GREEN'); // Start cycle even with settings error
            }
        } finally {
             hideSpinner(analysisSpinner);
        }
    }
    function initialize() {
         console.log('Attempting Initialization...');
        if (isInitialized) { console.log("Already initialized."); return };

        const essentialElements = [ modeToggle, analysisStatus, lightElements?.A?.red, timerElements?.A, aiModeSectionsDiv, lightGroupElements?.A, cameraFeedImg, directionALabel, llmLogContainer, llmResponsePlaceholder, llmApiDuration, analysisDataDiv, resultsPlaceholder, analysisErrorDiv ];
        const missingElements = essentialElements.filter(el => !el);
        if (missingElements.length > 0) { const missingIds = essentialElements.map((el, index) => el ? null : [ 'modeToggle', 'analysisStatus', 'light-A-red (in lightElements)', 'timer-A', 'ai-mode-sections', 'light-group-A', 'cameraFeedImg', 'direction-A-label', 'llmLogContainer', 'llmResponsePlaceholder', 'llmApiDuration', 'analysisData', 'resultsPlaceholder', 'analysisError' ][index]).filter(Boolean); console.error("CRITICAL: Essential UI elements missing. Initialization aborted. Missing:", missingIds); document.body.innerHTML = `<div class="alert alert-danger m-5" role="alert"><strong>Initialization Error:</strong> Critical UI components failed to load (Missing: ${missingIds.join(', ')}). Please refresh.</div>`; return; }
         console.log('Essential elements found.');

         isSmartModeActive = false; // Start assuming timer mode
         setAllLightsRed(); updateActiveLightBorder(null); highlightDirection = null;
         resetAllTimerLabels(); clearAnalysisDisplay();
         updateStatus('Initializing...'); updateDirectionALabel();

         const initialLightGroupA = lightGroupElements.A;
         if (initialLightGroupA) initialLightGroupA.classList.remove(AI_HALO_GREEN_CLASS, AI_HALO_RED_CLASS, AI_HALO_AMBER_CLASS);

         try {
            if(modeToggle) { modeToggle.addEventListener('change', handleToggleChange); console.log("Toggle listener attached."); }
            else { throw new Error("modeToggle element not found for listener attachment."); }
         } catch (error) { console.error("CRITICAL: Failed to attach toggle listener.", error); updateStatus("Init Failed (Listener Error)"); return; }

         isInitialized = true;
         console.log("Initialization flag set. Loading settings and starting systems...");

         if (liveTimerIntervalId) clearInterval(liveTimerIntervalId);
         liveTimerIntervalId = setInterval(updateActiveTimerDisplay, LIVE_TIMER_UPDATE_INTERVAL_MS); // Start live timer updates
         console.log("Live timer update interval started.");

         loadInitialSettingsAndSync(true).catch(initError => { // Load settings and start lights
             console.error("Initialization failed during async settings load:", initError);
             updateStatus("Initialization Failed (Async Error)"); addLogEntry(`Initialization failed: ${initError.message}`, "error");
             hideSpinner(analysisSpinner);
             if (!currentTrafficLightState) {
                  console.log("Attempting fallback light cycle start after init error.");
                  advanceTrafficLights('A_GREEN'); // Attempt to start lights even if settings fail
             }
         });
    }
    // Initialize on DOMContentLoaded or immediately if already loaded
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initialize); }
    else { initialize(); }

})(); // End of IIFE