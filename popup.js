// popup.js
document.addEventListener('DOMContentLoaded', function () {
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const skipForwardBtn = document.getElementById('skipForwardBtn');
    const skipBackwardBtn = document.getElementById('skipBackwardBtn');
    const nextEpisodeBtn = document.getElementById('nextEpisodeBtn');
    const setHostBtn = document.getElementById('setHostBtn');
    const roomIdInput = document.getElementById('roomIdInput');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const statusMessageEl = document.getElementById('statusMessage');
    const roomStatusEl = document.getElementById('roomStatusEl');
    const participantCountEl = document.getElementById('participantCountEl');

    let currentTabId = null;
    let currentTabUrl = null;
    let currentActiveSite = null;
    let isCurrentlyHost = false;
    let currentRoom = null;

    function setStatus(element, text, isError = false) {
        if (element) {
            element.textContent = text;
            element.style.color = isError ? 'red' : (element.id === 'roomStatusEl' || element.id === 'participantCountEl' ? '#555' : '#333');
        }
    }

    function updatePlayerControlsUI(isPlaying = false) {
        if (playBtn && pauseBtn) {
            playBtn.style.display = isPlaying ? 'none' : 'inline-block';
            pauseBtn.style.display = isPlaying ? 'inline-block' : 'none';
        }
    }
    
    function updateHostButtonUI(isHost, inRoom) {
        if (setHostBtn) {
            if (inRoom) {
                setHostBtn.textContent = isHost ? "You are Host" : "Set as Host";
                setHostBtn.disabled = isHost;
            } else {
                setHostBtn.textContent = "Set as Host";
                setHostBtn.disabled = true;
            }
        }
    }

    function updateParticipantCountUI(count) {
        if (participantCountEl) {
            participantCountEl.textContent = (typeof count === 'number') ? `Participants: ${count}` : `Participants: -`;
        }
    }

    function updateGeneralUI(activeSite, inRoom, isHost, participantCount = 0) {
        currentActiveSite = activeSite;
        isCurrentlyHost = isHost;
        currentRoom = inRoom && roomIdInput ? roomIdInput.value : null;

        const mediaButtons = [playBtn, pauseBtn, skipForwardBtn, skipBackwardBtn, nextEpisodeBtn];
        const canControlMedia = activeSite && inRoom;

        mediaButtons.forEach(btn => { if (btn) btn.disabled = !canControlMedia; });
        
        if (!inRoom) {
            setStatus(roomStatusEl, "Not in a room. Enter ID to join/create.");
            setStatus(statusMessageEl, "Join a room to start.");
            updateParticipantCountUI('-'); 
            if(roomIdInput) roomIdInput.value = "";
        } else {
            setStatus(roomStatusEl, `Room: ${roomIdInput.value || 'Connected'}`);
            updateParticipantCountUI(participantCount);
            if (!activeSite) {
                setStatus(statusMessageEl, "Navigate to Netflix/Hotstar.");
            } else {
                // Initial state check should be done after confirming room and site
                sendCommandToContentScript({ action: "getCurrentState" });
            }
        }
        updateHostButtonUI(isHost, inRoom);
        if (joinRoomBtn) joinRoomBtn.disabled = false;
    }


    function getActiveSiteFromUrl(url) {
        if (!url) return null;
        if (url.includes("netflix.com")) return "Netflix";
        if (url.includes("hotstar.com")) return "Hotstar";
        return null;
    }

    // Initial UI setup
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id && tabs[0].url) {
            currentTabId = tabs[0].id;
            currentTabUrl = tabs[0].url;
            const site = getActiveSiteFromUrl(currentTabUrl);

            chrome.runtime.sendMessage({ type: "GET_POPUP_INIT_STATUS", tabId: currentTabId }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Popup: Error getting initial status:", chrome.runtime.lastError.message);
                    updateGeneralUI(site, false, false, 0);
                    setStatus(roomStatusEl, "Error: " + chrome.runtime.lastError.message, true);
                    return;
                }
                if (response) {
                    currentRoom = response.roomId;
                    isCurrentlyHost = response.isHost;
                    if(response.roomId && roomIdInput) roomIdInput.value = response.roomId;
                    
                    updateGeneralUI(site, !!response.roomId, response.isHost, response.participantCount === undefined ? (response.roomId ? 0 : '-') : response.participantCount);

                    if (!response.roomId) {
                        setStatus(statusMessageEl, "Join a room to start.");
                    } else if (response.roomId && !site) {
                         setStatus(statusMessageEl, "Navigate to Netflix/Hotstar to control playback.");
                    }
                    // getCurrentState is called within updateGeneralUI if conditions are met
                } else {
                    updateGeneralUI(site, false, false, 0);
                    setStatus(statusMessageEl, "Could not get status from background.", true);
                }
            });
        } else {
            updateGeneralUI(null, false, false, 0);
            setStatus(statusMessageEl, "No active tab found.", true);
        }
    });

    function sendCommandToContentScript(commandDetails) {
        if (!currentTabId) {
            setStatus(statusMessageEl, "No active tab identified.", true);
            return;
        }
        
        // Allow getCurrentState even if not on a media site (e.g., for host status update)
        if (!currentActiveSite && commandDetails.action !== 'getCurrentState' && commandDetails.action !== 'setHostStatus') {
            setStatus(statusMessageEl, "Not on a supported page (Netflix/Hotstar).", true);
            return;
        }

        const messagePayload = { ...commandDetails, site: currentActiveSite ? currentActiveSite.toLowerCase() : null };

        chrome.tabs.sendMessage(currentTabId, messagePayload, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`Popup: Error sending '${messagePayload.action}' to tab ${currentTabId}:`, chrome.runtime.lastError.message);
                // Check if the error is due to the tab not having a content script or being closed
                if (!chrome.runtime.lastError.message.includes("Receiving end does not exist") && 
                    !chrome.runtime.lastError.message.includes("Could not establish connection")) {
                    setStatus(statusMessageEl, `Error: ${chrome.runtime.lastError.message}`, true);
                } else if (currentActiveSite) {
                     setStatus(statusMessageEl, `Error with ${currentActiveSite}. Reload tab?`, true);
                } else {
                    setStatus(statusMessageEl, "Not on a supported page, or script not ready.", true);
                }
            } else if (response) {
                setStatus(statusMessageEl, response.message || `Action: ${messagePayload.action} - ${response.status}`);
                if (response.status === "success") {
                    if (commandDetails.action === 'play') updatePlayerControlsUI(true, currentActiveSite);
                    if (commandDetails.action === 'pause') updatePlayerControlsUI(false, currentActiveSite);
                    if (commandDetails.action === 'getCurrentState' && response.isPlaying !== undefined) {
                        updatePlayerControlsUI(response.isPlaying, response.site);
                        // updateHostButtonUI(response.isHost, !!currentRoom); // Let background handle this via HOST_STATUS_CHANGED
                    }
                } else if (response.status === "error") {
                    setStatus(statusMessageEl, `Error: ${response.message}`, true);
                }
            } else {
                 setStatus(statusMessageEl, `No response from content script. Ensure you are on Netflix/Hotstar.`, true);
            }
        });
    }

    if (playBtn) playBtn.addEventListener('click', () => sendCommandToContentScript({ action: 'play' }));
    if (pauseBtn) pauseBtn.addEventListener('click', () => sendCommandToContentScript({ action: 'pause' }));
    if (skipForwardBtn) skipForwardBtn.addEventListener('click', () => sendCommandToContentScript({ action: 'skip', value: 10 }));
    if (skipBackwardBtn) skipBackwardBtn.addEventListener('click', () => sendCommandToContentScript({ action: 'skip', value: -10 }));
    if (nextEpisodeBtn) nextEpisodeBtn.addEventListener('click', () => sendCommandToContentScript({ action: 'nextEpisode' }));

    if (joinRoomBtn && roomIdInput) {
        joinRoomBtn.addEventListener('click', () => {
            const roomId = roomIdInput.value.trim();
            if (roomId) {
                setStatus(roomStatusEl, `Joining ${roomId}...`);
                joinRoomBtn.disabled = true;
                setHostBtn.disabled = true;
                chrome.runtime.sendMessage({ type: 'JOIN_WATCH_PARTY_ROOM', roomId: roomId }, (response) => {
                    joinRoomBtn.disabled = false; // Re-enable after attempt
                    if (chrome.runtime.lastError || (response && response.status === 'error')) {
                        const errorMsg = chrome.runtime.lastError?.message || response?.message || "Unknown error joining room.";
                        console.error("Popup: Error joining room:", errorMsg);
                        setStatus(roomStatusEl, `Error: ${errorMsg}`, true);
                        updateGeneralUI(currentActiveSite, false, false, 0); // Reset UI to not-in-room state
                    } else if (response && response.status === 'success') {
                        currentRoom = response.roomId; // Use roomId from response
                        roomIdInput.value = currentRoom; // Update input field
                        setStatus(roomStatusEl, `Joined Room: ${currentRoom}`);
                        updateGeneralUI(currentActiveSite, true, false, 0); // Assume not host, count will update
                        // Participant count will be updated via PRESENCE_UPDATE_FOR_POPUP
                    }
                });
            } else {
                setStatus(roomStatusEl, "Please enter a Room ID.", true);
            }
        });
    }

    if (setHostBtn) {
        setHostBtn.addEventListener('click', () => {
            if (currentTabId && currentRoom) {
                setHostBtn.disabled = true;
                chrome.runtime.sendMessage({ type: 'SET_TAB_AS_HOST', tabId: currentTabId, roomId: currentRoom }, (response) => {
                    if (chrome.runtime.lastError || (response && response.status === 'error')) {
                        const errorMsg = chrome.runtime.lastError?.message || response?.message || "Error setting host.";
                        console.error("Popup: Error setting host:", errorMsg);
                        setStatus(statusMessageEl, `Error: ${errorMsg}`, true);
                        // Only re-enable if it's not already host (which would be updated by background)
                        if (!isCurrentlyHost) setHostBtn.disabled = false;
                    } else if (response && response.status === 'success') {
                        setStatus(statusMessageEl, "You are now the Host!");
                        isCurrentlyHost = true; // Optimistically update
                        updateHostButtonUI(true, true);
                    } else {
                         if (!isCurrentlyHost) setHostBtn.disabled = false;
                    }
                });
            } else if (!currentRoom) {
                setStatus(statusMessageEl, "You must join a room first to become host.", true);
            } else {
                setStatus(statusMessageEl, "Could not identify current tab.", true);
            }
        });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("Popup received message:", request);
        if (request.type === "LIVE_PLAYER_STATE_UPDATE_FOR_POPUP") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id === request.data.tabId) {
                    updatePlayerControlsUI(request.data.isPlaying, request.data.site);
                }
            });
        } else if (request.type === "HOST_STATUS_CHANGED_FOR_POPUP") {
            // Update host status if this tab is the one affected OR if room ID matches (for host leaving scenarios)
            if (currentRoom && request.data.roomId === currentRoom) {
                 isCurrentlyHost = (request.data.tabId === currentTabId && request.data.isHost);
                 updateHostButtonUI(isCurrentlyHost, true); // true because we are in a room
                 if (isCurrentlyHost) {
                     setStatus(statusMessageEl, "You are now the Host!");
                 } else if (request.data.tabId === currentTabId && !request.data.isHost) {
                     // This specific tab was host but is no longer
                     setStatus(statusMessageEl, "You are no longer the Host.");
                 } else if (request.data.tabId !== currentTabId && !request.data.isHost && hostTabId === request.data.tabId) {
                    // Another tab was host and left, current tab is not the new host
                    setStatus(statusMessageEl, "Host has changed or left.");
                 }
            }
        } else if (request.type === "ROOM_STATUS_CHANGED_FOR_POPUP") {
            const inRoom = !!request.data.roomId;
            currentRoom = request.data.roomId; // Update currentRoom
            isCurrentlyHost = inRoom && request.data.isHost && (request.data.tabId === currentTabId); // Re-evaluate host status

            if (inRoom) {
                setStatus(roomStatusEl, `Room: ${request.data.roomId}`);
                if(roomIdInput) roomIdInput.value = request.data.roomId;
                // Fetch initial participant count when room status changes
                chrome.runtime.sendMessage({ type: "GET_POPUP_INIT_STATUS", tabId: currentTabId }, (response) => {
                    if (response && response.participantCount !== undefined) {
                        updateParticipantCountUI(response.participantCount);
                    } else {
                        updateParticipantCountUI(0); // Default if count not available
                    }
                });
            } else {
                setStatus(roomStatusEl, "Not in a room.");
                if(roomIdInput) roomIdInput.value = "";
                updateParticipantCountUI('-');
            }
            updateGeneralUI(currentActiveSite, inRoom, isCurrentlyHost, inRoom ? (participantCountEl.textContent.split(': ')[1] || 0) : 0);
            // If just joined a room and on a supported site, refresh player state
            if (inRoom && currentActiveSite) {
                sendCommandToContentScript({ action: "getCurrentState" });
            }

        } else if (request.type === "PRESENCE_UPDATE_FOR_POPUP") {
            if (request.data.roomId === currentRoom) { // Ensure update is for the current room
                updateParticipantCountUI(request.data.participantCount);
            }
        } else if (request.type === "ABLY_MESSAGE_FOR_POPUP") {
            console.log("Popup received Ably message for popup:", request.data);
        }
        // It's good practice to return true if you intend to use sendResponse asynchronously,
        // but since all branches here call sendResponse synchronously or not at all,
        // it's not strictly necessary for this particular listener's structure.
        // However, to be safe and allow for future async operations, return true.
        return true;
    });
});