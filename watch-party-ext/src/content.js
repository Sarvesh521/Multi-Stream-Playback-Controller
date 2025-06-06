// my-watch-party-ext/src/content.js

(() => {
    'use strict';

    let CURRENT_SITE = null;
    let videoPlayerElement = null;
    let domObserver = null;
    let initialPlayerCheckDone = false;
    let extensionIsControllingPlayback = false; // Flag to prevent sending Ably messages for actions applied by the extension
    let isCurrentUserHost = false; // Is this tab the host? Updated by background.js
    let currentAblyClientId = null; // This extension's Ably client ID

    const hostname = window.location.hostname;
    if (hostname.includes("netflix.com")) {
        CURRENT_SITE = "NETFLIX";
    } else if (hostname.includes("hotstar.com")) {
        CURRENT_SITE = "HOTSTAR";
    }

    if (!CURRENT_SITE) {
        console.warn("WatchParty ContentScript: Unknown site. Player functions may be limited.");
    } else {
        console.log(`WatchParty ContentScript: ${CURRENT_SITE} site detected.`);
    }

    const SITE_CONFIG = {
        NETFLIX: {
            getVideoElement: () => {
                const videos = document.querySelectorAll('video');
                for (const video of videos) {
                    if (video.src && video.readyState > 0 && video.offsetHeight > 100 && video.offsetWidth > 100 && video.duration > 0 && !isNaN(video.duration)) {
                        return video;
                    }
                }
                if (videos.length > 0 && videos[0].duration > 0 && !isNaN(videos[0].duration)) return videos[0]; // Fallback
                return null;
            },
            // ... (other Netflix specific selectors/configs if needed) ...
            defaultSkipAmount: 10
        },
        HOTSTAR: {
            getVideoElement: () => {
                // Try more specific selectors first
                let video = document.querySelector('#video-container video, video.shaka-video-container, video[data-testid="video-element"]');
                if (video && video.src && video.readyState > 0 && video.duration > 0 && !isNaN(video.duration) && video.offsetHeight > 50) {
                    return video;
                }
                // Fallback to any prominent video element
                const videos = document.querySelectorAll('video');
                for (const v of videos) {
                    if (v.src && v.readyState > 0 && v.offsetHeight > 100 && v.offsetWidth > 100 && v.duration > 0 && !isNaN(v.duration)) {
                        return v;
                    }
                }
                return null;
            },
            // ... (other Hotstar specific selectors/configs if needed) ...
            defaultSkipAmount: 10
        }
        // Add other site configs here
    };

    const currentSiteConfig = CURRENT_SITE ? SITE_CONFIG[CURRENT_SITE] : null;

    function isElementVisible(element) {
        // ... (same as before)
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
    }
    
    function clickElement(selector) {
        // ... (same as before)
    }
    
    function clickHotstarNextEpisodeButton() {
        // ... (same as before)
    }


    // Called when a user directly interacts with the video player (play, pause)
    function handleUserVideoEvent(action) {
        if (extensionIsControllingPlayback || !videoPlayerElement) {
            console.log(`[${CURRENT_SITE}] User event '${action}' ignored. extensionIsControllingPlayback=${extensionIsControllingPlayback}, player=${!!videoPlayerElement}`);
            return;
        }
        
        if (isCurrentUserHost) {
            const payload = {
                site: CURRENT_SITE,
                action: action,
                time: videoPlayerElement.currentTime,
                // Optional: Add video duration if useful for new joiners
                // duration: videoPlayerElement.duration, 
                logMessage: `Host user initiated ${action} on ${CURRENT_SITE}. Time: ${videoPlayerElement.currentTime.toFixed(2)}`
            };
            console.log(`[${CURRENT_SITE} - HOST ACTION] Publishing:`, payload);
            chrome.runtime.sendMessage({
                type: "PUBLISH_PLAYER_ACTION_TO_ABLY",
                payload: payload
            });
        } else {
            // Non-hosts do not publish their local actions by default.
            // console.log(`[${CURRENT_SITE} - Non-Host User Action] ${action}. Not publishing.`);
        }
    }
    const handleVideoPlay = () => handleUserVideoEvent('play');
    const handleVideoPause = () => handleUserVideoEvent('pause');
    // Add more for seeked, etc. if desired, but be careful of event spam
    // const handleVideoSeeked = () => handleUserVideoEvent('seeked');


    function addVideoEventListeners(player) {
        if (!player) return;
        player.removeEventListener('play', handleVideoPlay);
        player.removeEventListener('pause', handleVideoPause);
        // player.removeEventListener('seeked', handleVideoSeeked);

        player.addEventListener('play', handleVideoPlay);
        player.addEventListener('pause', handleVideoPause);
        // player.addEventListener('seeked', handleVideoSeeked); // Be cautious with 'seeked' as it can fire rapidly
        console.log(`[${CURRENT_SITE}] Added play/pause event listeners to video element.`);
    }

    function attemptToFindPlayer() {
        if (videoPlayerElement && document.body.contains(videoPlayerElement) && videoPlayerElement.readyState > 0) {
            // Player exists and seems valid
            return;
        }
        if (!currentSiteConfig || typeof currentSiteConfig.getVideoElement !== 'function') {
            console.warn(`[${CURRENT_SITE}] No site config or getVideoElement function.`);
            return;
        }

        let foundPlayer = currentSiteConfig.getVideoElement();
        if (foundPlayer) {
            if (videoPlayerElement !== foundPlayer) {
                videoPlayerElement = foundPlayer;
                console.log(`[${CURRENT_SITE}] Video player element found/updated:`, videoPlayerElement);
                addVideoEventListeners(videoPlayerElement);
                 // When a new player is found, if this user is host, maybe send a sync pulse?
                if (isCurrentUserHost) {
                    // handleUserVideoEvent(videoPlayerElement.paused ? 'pause' : 'play'); // Send current state
                }
            }
            if (domObserver) { // If player found, stop observing
                domObserver.disconnect();
                domObserver = null;
                console.log(`[${CURRENT_SITE}] MutationObserver disconnected as player found.`);
            }
        } else {
            console.log(`[${CURRENT_SITE}] Video player not found on this attempt.`);
            if (!domObserver && document.readyState === "complete") { // Only start observer if not already running and page is loaded
                startObservingDOM();
            }
        }
        if (!initialPlayerCheckDone) initialPlayerCheckDone = true;
    }

    function startObservingDOM() {
        if (domObserver || !currentSiteConfig) return; // Don't start if already observing or no config
        console.log(`[${CURRENT_SITE}] Starting MutationObserver to find player.`);
        domObserver = new MutationObserver((mutations) => {
            // More targeted observation: check if video tags were added/changed
            let potentialPlayerChange = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                            potentialPlayerChange = true;
                        }
                    });
                    if (potentialPlayerChange) break;
                }
            }

            if (potentialPlayerChange || !videoPlayerElement) { // Re-check if player is still not found or potential change occurred
                attemptToFindPlayer();
            }
            // If player is found, attemptToFindPlayer will disconnect the observer.
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function updateHostStatus(isHost) {
        isCurrentUserHost = isHost;
        console.log(`[${CURRENT_SITE}] Host status for this tab is now: ${isCurrentUserHost}. My Ably ID: ${currentAblyClientId}`);
    }

    async function ensureAblyClientId() {
        if (currentAblyClientId) return currentAblyClientId;
        console.log(`[${CURRENT_SITE}] Requesting my Ably Client ID from background...`);
        try {
            const response = await chrome.runtime.sendMessage({ type: "GET_MY_CLIENT_ID" });
            if (response && response.clientId) {
                currentAblyClientId = response.clientId;
                console.log(`[${CURRENT_SITE}] Received my Ably Client ID: ${currentAblyClientId}`);
            } else {
                console.error(`[${CURRENT_SITE}] Failed to get Ably Client ID or invalid response.`, response);
            }
        } catch (error) {
            console.error(`[${CURRENT_SITE}] Error requesting Ably Client ID:`, error.message);
        }
        return currentAblyClientId;
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        (async () => { // Wrap in async IIFE to use await
            if (request.type !== "ABLY_CLIENT_ID_NOTIFICATION") { // For most messages, ensure we have our Ably ID
                await ensureAblyClientId();
            }

            if (request.type === 'SET_HOST_STATUS') {
                updateHostStatus(request.isHost);
                sendResponse({ status: "success", message: `Host status set to ${request.isHost}` });
            } else if (request.type === "ABLY_CLIENT_ID_NOTIFICATION") {
                currentAblyClientId = request.clientId;
                console.log(`[${CURRENT_SITE}] Notified of my Ably Client ID: ${currentAblyClientId}`);
                sendResponse({ status: "ok" });
            } else if (request.type === "ABLY_MESSAGE_FOR_CONTENT_SCRIPT") {
                const eventData = request.data; // This is the payload like { site, action, time }
                const senderAblyId = request.senderClientId;

                console.log(`[${CURRENT_SITE}] Received Ably event for CS. My AblyID: ${currentAblyClientId}, Sender AblyID: ${senderAblyId}, Action: ${eventData.action}, Time: ${eventData.time}`);
                console.log(`[${CURRENT_SITE}] Current host status (isCurrentUserHost): ${isCurrentUserHost}`);
                console.log(`[${CURRENT_SITE}] Video player element:`, videoPlayerElement);


                if (senderAblyId && currentAblyClientId && senderAblyId === currentAblyClientId) {
                    console.log(`[${CURRENT_SITE}] IGNORING OWN Ably message (Action: ${eventData.action}).`);
                    sendResponse({ status: "ignored_self" });
                    return;
                }

                // CRITICAL: NON-HOSTS SHOULD APPLY ACTIONS FROM OTHERS. HOSTS SHOULD NOT APPLY ACTIONS FROM OTHERS.
                if (isCurrentUserHost) {
                    console.log(`[${CURRENT_SITE}] This tab IS HOST. IGNORING incoming player control from other client (${senderAblyId}). Data:`, eventData);
                    sendResponse({ status: "ignored_as_host_received_external_command" });
                    return;
                }

                // At this point, this tab is NOT the host, and the message is NOT from self.
                // So, it should apply the action.
                console.log(`[${CURRENT_SITE} - RECEIVER] Applying Ably sync. Event:`, eventData);

                if (!videoPlayerElement) {
                    console.error(`[${CURRENT_SITE} - RECEIVER] Video player NOT FOUND. Cannot apply sync for action: ${eventData.action}. Attempting to find player now...`);
                    attemptToFindPlayer(); // Try to find it again
                    if (!videoPlayerElement) { // Check again after attempt
                         sendResponse({ status: "error", message: "Video player still not found after re-attempt." });
                         return;
                    }
                    console.log(`[${CURRENT_SITE} - RECEIVER] Found player after re-attempt. Proceeding with sync.`);
                }
                
                if (eventData.site && eventData.site.toLowerCase() !== CURRENT_SITE.toLowerCase()) {
                    console.warn(`[${CURRENT_SITE} - RECEIVER] Ignoring message for different site. Expected: ${CURRENT_SITE}, Got: ${eventData.site}`);
                    sendResponse({ status: "ignored_wrong_site" });
                    return;
                }

                extensionIsControllingPlayback = true; // Set flag
                try {
                    let appliedAction = false;
                    const targetTime = parseFloat(eventData.time);

                    if (eventData.action === "play") {
                        if (!isNaN(targetTime) && Math.abs(videoPlayerElement.currentTime - targetTime) > 1.5) { // Sync time if significantly different
                            console.log(`[${CURRENT_SITE} - RECEIVER] Adjusting time to ${targetTime.toFixed(2)} before play.`);
                            videoPlayerElement.currentTime = targetTime;
                        }
                        if(videoPlayerElement.paused) { // Only play if actually paused
                            await videoPlayerElement.play();
                            console.log(`[${CURRENT_SITE} - RECEIVER] Play command executed. Video time: ${videoPlayerElement.currentTime.toFixed(2)}`);
                        } else {
                            console.log(`[${CURRENT_SITE} - RECEIVER] Received play, but player already playing. Time (local/target): ${videoPlayerElement.currentTime.toFixed(2)} / ${targetTime.toFixed(2)}`);
                        }
                        appliedAction = true;
                    } else if (eventData.action === "pause") {
                        if(!videoPlayerElement.paused) { // Only pause if actually playing
                            videoPlayerElement.pause();
                            console.log(`[${CURRENT_SITE} - RECEIVER] Pause command executed.`);
                        } else {
                             console.log(`[${CURRENT_SITE} - RECEIVER] Received pause, but player already paused. Time (local/target): ${videoPlayerElement.currentTime.toFixed(2)} / ${targetTime.toFixed(2)}`);
                        }
                        // Always sync time on pause, as host might have paused at a specific point
                        if (!isNaN(targetTime)) {
                            console.log(`[${CURRENT_SITE} - RECEIVER] Setting time to ${targetTime.toFixed(2)} on pause.`);
                            videoPlayerElement.currentTime = targetTime;
                        }
                        appliedAction = true;
                    } else if (eventData.action === "seeked" || eventData.action === "skip") { // Treat 'skip' as a 'seeked' event
                        if (!isNaN(targetTime)) {
                            videoPlayerElement.currentTime = targetTime;
                            console.log(`[${CURRENT_SITE} - RECEIVER] Seek/Skip command executed. New time: ${targetTime.toFixed(2)}`);
                            appliedAction = true;
                        } else {
                            console.warn(`[${CURRENT_SITE} - RECEIVER] Invalid time for seek/skip:`, eventData.time);
                        }
                    }
                    // Add other actions like 'nextEpisodeTriggered' if needed

                    if (appliedAction) {
                        sendResponse({ status: "success", message: `Synced action: ${eventData.action}` });
                    } else {
                        console.warn(`[${CURRENT_SITE} - RECEIVER] Unknown action in Ably message or no action taken: ${eventData.action}`);
                        sendResponse({ status: "ignored_unknown_action" });
                    }

                } catch (e) {
                    console.error(`[${CURRENT_SITE} - RECEIVER] Error applying synced action '${eventData.action}':`, e);
                    sendResponse({ status: "error", message: `Error applying sync: ${e.message}` });
                } finally {
                    // Release control after a short delay to allow player to process
                    setTimeout(() => { extensionIsControllingPlayback = false; }, 300);
                }

            } else if (request.action) { // Commands from a popup (less relevant now, but keep for dev/testing)
                // ... (Your existing logic for popup commands - play, pause, skip, nextEpisode, getCurrentState)
                // Ensure this part is also robust if you still use it.
                console.log(`[${CURRENT_SITE}] Received direct action command: ${request.action}`);
                // This part would typically only be effective if isCurrentUserHost is true
                // or if it's a 'getCurrentState' request.
                if (!isCurrentUserHost && request.action !== 'getCurrentState') {
                    console.warn(`[${CURRENT_SITE}] Non-host received direct command '${request.action}', ignoring.`);
                    sendResponse({ status: "ignored_non_host_direct_command" });
                    return;
                }
                // Your existing switch statement for request.action here...
                 let responseMessage = "";
                switch (request.action) {
                    case 'play':
                    case 'pause':
                    case 'skip':
                        if (!videoPlayerElement) { sendResponse({ status: "error", message: "Video element not available." }); return; }
                        extensionIsControllingPlayback = true; 
                        if (request.action === 'play') {
                            videoPlayerElement.play()
                                .then(() => {
                                    handleUserVideoEvent('play'); // If host, this will publish
                                    sendResponse({ status: "success", message: `Playback started by extension` });
                                 })
                                .catch(e => sendResponse({ status: "error", message: `Error playing: ${e.message}` }));
                        } else if (request.action === 'pause') {
                            videoPlayerElement.pause();
                            handleUserVideoEvent('pause'); // If host, this will publish
                            sendResponse({ status: "success", message: `Playback paused by extension` });
                        } else if (request.action === 'skip') {
                            // ... (skip logic, then call handleUserVideoEvent('seeked') or similar)
                        }
                        setTimeout(() => { extensionIsControllingPlayback = false; }, 150);
                        return; 
                    case 'getCurrentState':
                        sendResponse({
                            status: "success",
                            isPlaying: videoPlayerElement ? !videoPlayerElement.paused : false,
                            currentTime: videoPlayerElement ? videoPlayerElement.currentTime : 0,
                            duration: videoPlayerElement ? videoPlayerElement.duration : 0,
                            site: CURRENT_SITE,
                            isHost: isCurrentUserHost,
                            ablyClientId: currentAblyClientId
                        });
                        return;
                    default:
                        sendResponse({ status: "error", message: `Unknown direct action: ${request.action}` });
                        return;
                }


            } else {
                // Optional: handle unknown message types
                // console.warn(`[${CURRENT_SITE}] Received unhandled message type:`, request.type);
            }
        })(); // Execute the async IIFE
        return true; // Crucial for asynchronous sendResponse
    });

    async function initializeScript() {
        console.log(`[${CURRENT_SITE}] Initializing content script...`);
        await ensureAblyClientId(); // Get client ID first

        // Get initial host status from background
        try {
            const response = await chrome.runtime.sendMessage({ type: "GET_HOST_STATUS_FROM_BACKGROUND" });
            if (response) {
                updateHostStatus(response.isHost);
            }
        } catch (e) {
            console.warn(`[${CURRENT_SITE}] Error getting initial host status:`, e.message);
        }
        
        // Initial attempt to find the player
        attemptToFindPlayer();

        // If player not found immediately, set up observer (if config exists)
        if (!videoPlayerElement && currentSiteConfig) {
            // Wait a bit for dynamic content to load before starting observer
            setTimeout(() => {
                if (!videoPlayerElement) { // Check again before starting observer
                    startObservingDOM();
                }
            }, 2000); // Increased delay
        }
        // Fallback checks if observer doesn't catch it or for SPA navigations
        setTimeout(attemptToFindPlayer, 3000);
        setTimeout(attemptToFindPlayer, 5000);
        setTimeout(attemptToFindPlayer, 10000); // A more patient check
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        initializeScript();
    } else {
        document.addEventListener('DOMContentLoaded', initializeScript, { once: true });
    }
})();