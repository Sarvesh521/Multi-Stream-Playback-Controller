// content.js

(() => {
    'use strict';

    let CURRENT_SITE = null;
    let videoPlayerElement = null;
    let domObserver = null;
    let initialPlayerCheckDone = false;
    let extensionIsControllingPlayback = false;
    let isCurrentUserHost = false;
    let currentAblyClientId = null;

    const hostname = window.location.hostname;
    if (hostname.includes("netflix.com")) {
        CURRENT_SITE = "NETFLIX";
    } else if (hostname.includes("hotstar.com")) {
        CURRENT_SITE = "HOTSTAR";
    }

    if (!CURRENT_SITE) {
        console.warn("Multi-Site Controller: Unknown site (player functions may be limited).");
    } else {
        console.log(`Multi-Site Controller: ${CURRENT_SITE} site detected.`);
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
                if (videos.length > 0 && videos[0].duration > 0 && !isNaN(videos[0].duration)) return videos[0];
                return null;
            },
            getSkipTargetElement: () => videoPlayerElement || document.querySelector('.watch-video--player-view') || document.body,
            nextEpisodeSelectors: [
                '[data-uia="next-episode"]',
                '[aria-label="Next Episode"]',
                '[data-uia="control-next-episode"]'
            ],
            defaultSkipAmount: 10
        },
        HOTSTAR: {
            getVideoElement: () => {
                let video = document.querySelector('#video-container video');
                if (video && video.src && video.readyState > 0 && video.duration > 0 && !isNaN(video.duration) && video.offsetHeight > 50) {
                    return video;
                }
                const videos = document.querySelectorAll('video');
                for (const v of videos) {
                    if (v.src && v.readyState > 0 && v.offsetHeight > 100 && v.offsetWidth > 100 && v.duration > 0 && !isNaN(v.duration)) {
                        return v;
                    }
                }
                return null;
            },
            getSkipTargetElement: () => videoPlayerElement || document.querySelector('#video-container') || document.querySelector('div[data-testid="player-space-container"]') || document.body,
            nextEpisodeSelectors: [
                'button[data-testid="player-menu"][navigationtype="DEFAULT"]',
                'button._3Voy-4gADg6kugv53pvF7U',
                'div[data-testid="up-next-tile"]',
                'div[class*="up-next-card"] button',
                'article[aria-label*="Play Next episode"]',
                'div[role="button"][aria-label*="Play Next" i]',
                'button[aria-label*="Next Episode" i]',
            ],
            defaultSkipAmount: 10
        }
    };

    const currentSiteConfig = CURRENT_SITE ? SITE_CONFIG[CURRENT_SITE] : null;

    function isElementVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
    }

    function clickElement(selector) {
        try {
            const element = document.querySelector(selector);
            if (element && typeof element.click === 'function' && isElementVisible(element)) {
                console.log(`[${CURRENT_SITE || 'ContentScript'}] Clicking element with selector: ${selector}`, element);
                element.click();
                return true;
            }
        } catch (e) {
            console.error(`[${CURRENT_SITE || 'ContentScript'}] Error clicking element (${selector}):`, e);
        }
        return false;
    }

    function clickHotstarNextEpisodeButton() {
        const playerMenuButtons = document.querySelectorAll('button[data-testid="player-menu"]');
        for (const button of playerMenuButtons) {
            const icon = button.querySelector('i.icon-next-line');
            const textElement = button.querySelector('.player-menu-label p');
            if (icon && textElement && textElement.textContent.trim().toLowerCase() === "next episode" && isElementVisible(button)) {
                console.log(`[HOTSTAR] Found and clicking specific control bar Next Episode button:`, button);
                button.click();
                return true;
            }
        }
        return false;
    }

    function handleVideoEvent(action) {
        if (extensionIsControllingPlayback || !videoPlayerElement) return;
        
        // Only host should publish player actions
        if (isCurrentUserHost) {
            const messageToPublish = `User initiated ${action} on ${CURRENT_SITE}. Time: ${videoPlayerElement.currentTime.toFixed(2)}`;
            console.log(`[Host Action] ${messageToPublish}`);
            chrome.runtime.sendMessage({
                type: "PUBLISH_PLAYER_ACTION_TO_ABLY",
                payload: {
                    site: CURRENT_SITE,
                    action: action,
                    time: videoPlayerElement.currentTime,
                    logMessage: messageToPublish
                }
            });
        } else {
            // console.log(`[Participant Action] User initiated ${action}, but not host. Not publishing.`);
        }
    }
    const handleVideoPlay = () => handleVideoEvent('play');
    const handleVideoPause = () => handleVideoEvent('pause');

    function addVideoEventListeners(player) {
        if (!player) return;
        player.removeEventListener('play', handleVideoPlay);
        player.removeEventListener('pause', handleVideoPause);
        player.addEventListener('play', handleVideoPlay);
        player.addEventListener('pause', handleVideoPause);
        console.log(`[${CURRENT_SITE}] Added play/pause event listeners to video element.`);
    }

    function attemptToFindPlayer() {
        if (videoPlayerElement || !currentSiteConfig || typeof currentSiteConfig.getVideoElement !== 'function') return;
        let foundPlayer = currentSiteConfig.getVideoElement();
        if (foundPlayer) {
            if (videoPlayerElement !== foundPlayer) {
                videoPlayerElement = foundPlayer;
                console.log(`[${CURRENT_SITE}] Video player element found/updated:`, videoPlayerElement);
                addVideoEventListeners(videoPlayerElement);
            }
            initialPlayerCheckDone = true;
            if (domObserver) {
                domObserver.disconnect();
                domObserver = null;
                console.log(`[${CURRENT_SITE}] MutationObserver disconnected as player found.`);
            }
        } else if (!initialPlayerCheckDone) {
            initialPlayerCheckDone = true;
        }
    }

    function startObservingDOM() {
        if (domObserver || videoPlayerElement || !currentSiteConfig) return;
        domObserver = new MutationObserver(() => {
            if (!videoPlayerElement) {
                attemptToFindPlayer();
            } else if (domObserver) {
                domObserver.disconnect();
                domObserver = null;
            }
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
        console.log(`[${CURRENT_SITE}] MutationObserver started.`);
    }

    function updateHostStatus(isHost) {
        isCurrentUserHost = isHost;
        console.log(`[ContentScript] Host status updated to: ${isCurrentUserHost}`);
    }

    async function ensureAblyClientId() {
        if (!currentAblyClientId) {
            console.log("[ContentScript] Ably Client ID not set, requesting from background...");
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ type: "GET_MY_CLIENT_ID" }, (res) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(res);
                        }
                    });
                });
                if (response && response.clientId) {
                    currentAblyClientId = response.clientId;
                    console.log(`[ContentScript] Received My Ably Client ID: ${currentAblyClientId}`);
                } else {
                    console.error("[ContentScript] Failed to get Ably Client ID from background or response was invalid.");
                }
            } catch (error) {
                console.error("[ContentScript] Error requesting Ably Client ID:", error);
            }
        }
        return currentAblyClientId;
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        (async () => {
            if (request.type !== "ABLY_CLIENT_ID_NOTIFICATION") {
                await ensureAblyClientId();
            }

            if (request.type === 'SET_HOST_STATUS') { // Changed from request.action
                if (typeof request.isHost === 'boolean') {
                    updateHostStatus(request.isHost);
                    sendResponse({ status: "success", isHost: isCurrentUserHost, message: `Host status for this tab is now ${isCurrentUserHost}` });
                } else {
                    sendResponse({ status: "error", message: "Invalid host status value." });
                }
            } else if (request.type === "ABLY_CLIENT_ID_NOTIFICATION" && request.clientId) {
                currentAblyClientId = request.clientId;
                console.log(`[ContentScript] My Ably Client ID is: ${currentAblyClientId} (received via notification)`);
                sendResponse({ status: "ok", message: "Client ID noted." });
            } else if (request.type === "ABLY_MESSAGE_FOR_CONTENT_SCRIPT") {
                const eventData = request.data;
                const senderClientId = request.senderClientId;

                console.log(`[${CURRENT_SITE}] Received Ably message. My ID: ${currentAblyClientId}, Sender ID: ${senderClientId}`);

                if (senderClientId && currentAblyClientId && senderClientId === currentAblyClientId) {
                    console.log(`[${CURRENT_SITE}] Ignoring own Ably message (action: ${eventData.action})`);
                    sendResponse({ status: "ignored_self" });
                    return;
                }
                if (isCurrentUserHost) {
                    console.log(`[${CURRENT_SITE}] Host received Ably message from another client (ClientId: ${senderClientId}), ignoring player controls. Data:`, eventData);
                    sendResponse({ status: "ignored_host_role" });
                    return;
                }

                console.log(`[${CURRENT_SITE}] Syncing from Ably (sender: ${senderClientId}):`, eventData);
                if (eventData.logMessage) {
                    console.log(`Message from Host (${senderClientId}): ${eventData.logMessage}`);
                }

                if (videoPlayerElement && eventData.site && eventData.site.toLowerCase() === CURRENT_SITE.toLowerCase()) {
                    extensionIsControllingPlayback = true;
                    try {
                        if (eventData.action === "play") {
                            if (eventData.time !== undefined) videoPlayerElement.currentTime = eventData.time;
                            await videoPlayerElement.play(); // Use await for play()
                            console.log(`[${CURRENT_SITE}] Play command executed.`);
                        } else if (eventData.action === "pause") {
                            videoPlayerElement.pause();
                            console.log(`[${CURRENT_SITE}] Pause command executed.`);
                            if (eventData.time !== undefined) videoPlayerElement.currentTime = eventData.time;
                        } else if (eventData.action === "skip" && eventData.time !== undefined) {
                            videoPlayerElement.currentTime = eventData.time;
                            console.log(`[${CURRENT_SITE}] Skip command executed to ${eventData.time}.`);
                        } else if (eventData.action === "nextEpisodeTriggered" && currentSiteConfig) {
                            let clicked = false;
                            if (CURRENT_SITE === "HOTSTAR" && clickHotstarNextEpisodeButton()) clicked = true;
                            if (!clicked && currentSiteConfig.nextEpisodeSelectors) {
                                for (const selector of currentSiteConfig.nextEpisodeSelectors) { if (clickElement(selector)) { clicked = true; break; } }
                            }
                            console.log(clicked ? `[${CURRENT_SITE}] Synced: Triggered Next Episode.` : `[${CURRENT_SITE}] Synced: Failed to trigger Next Episode.`);
                        }
                        sendResponse({ status: "success", message: "Synced action: " + eventData.action });
                    } catch (e) {
                        console.error(`[${CURRENT_SITE}] Error applying synced action:`, e);
                        sendResponse({ status: "error", message: "Error applying sync." });
                    } finally {
                        setTimeout(() => { extensionIsControllingPlayback = false; }, 200);
                    }
                } else if (!videoPlayerElement) {
                    sendResponse({ status: "error", message: "Video player not found for sync." });
                } else {
                    sendResponse({ status: "ignored", message: "Sync message not for this site." });
                }
            } else if (request.action) { // Handling commands from popup
                if (!currentSiteConfig && request.action !== 'getCurrentState') {
                    sendResponse({ status: "error", message: `Site config not found for ${CURRENT_SITE} for action: ${request.action}` });
                    return;
                }
                if (!videoPlayerElement && ['play', 'pause', 'skip'].includes(request.action)) {
                    attemptToFindPlayer();
                    if (!videoPlayerElement) {
                        sendResponse({ status: "error", message: `Video element not found on ${CURRENT_SITE}.` });
                        return;
                    }
                }

                let responseMessage = "";
                switch (request.action) {
                    case 'play':
                    case 'pause':
                    case 'skip':
                        if (!videoPlayerElement) { sendResponse({ status: "error", message: "Video element not available." }); return; }
                        extensionIsControllingPlayback = true; // Set before action
                        if (request.action === 'play') {
                            videoPlayerElement.play()
                                .then(() => sendResponse({ status: "success", message: `Playback started by extension` }))
                                .catch(e => sendResponse({ status: "error", message: `Error playing: ${e.message}` }));
                        } else if (request.action === 'pause') {
                            videoPlayerElement.pause();
                            sendResponse({ status: "success", message: `Playback paused by extension` });
                        } else if (request.action === 'skip') {
                            const val = Number(request.value);
                            if (isNaN(val)) { sendResponse({ status: "error", message: "Invalid skip value." }); }
                            else {
                                videoPlayerElement.currentTime += val;
                                responseMessage = `Skipped ${val}s. New time: ${videoPlayerElement.currentTime.toFixed(2)}`;
                                sendResponse({ status: "success", message: responseMessage, newTime: videoPlayerElement.currentTime });
                            }
                        }
                        // Call handleVideoEvent manually for host to publish the action
                        if (isCurrentUserHost) {
                            handleVideoEvent(request.action);
                        }
                        setTimeout(() => { extensionIsControllingPlayback = false; }, 150);
                        return; // sendResponse is handled in promises or directly

                    case 'nextEpisode':
                        let clicked = false;
                        responseMessage = `Next Episode element not found.`;
                        if (currentSiteConfig && currentSiteConfig.nextEpisodeSelectors) {
                            if (CURRENT_SITE === "HOTSTAR") {
                                if (clickHotstarNextEpisodeButton()) clicked = true;
                            }
                            if (!clicked) {
                                for (const sel of currentSiteConfig.nextEpisodeSelectors) {
                                    if (clickElement(sel)) { clicked = true; break; }
                                }
                            }
                        }
                        if (clicked) responseMessage = `Triggered Next Episode on ${CURRENT_SITE}.`;

                        if (clicked && isCurrentUserHost) {
                            chrome.runtime.sendMessage({
                                type: "PUBLISH_PLAYER_ACTION_TO_ABLY",
                                payload: {
                                    site: CURRENT_SITE,
                                    action: "nextEpisodeTriggered",
                                    logMessage: `Host triggered Next Episode on ${CURRENT_SITE}`
                                }
                            });
                        }
                        sendResponse({ status: clicked ? "success" : "error", message: responseMessage });
                        return;

                    case 'getCurrentState':
                        sendResponse({
                            status: "success",
                            isPlaying: videoPlayerElement ? !videoPlayerElement.paused : false,
                            currentTime: videoPlayerElement ? videoPlayerElement.currentTime : 0,
                            duration: videoPlayerElement ? videoPlayerElement.duration : 0,
                            site: CURRENT_SITE,
                            isHost: isCurrentUserHost
                        });
                        return;
                    default:
                        sendResponse({ status: "error", message: `Unknown action: ${request.action}` });
                        return;
                }
            } else {
                return false; // Important if not sending a response for all message types
            }

        })(); // Execute the async IIFE
        return true; // Crucial for asynchronous sendResponse
    });


    async function initializeScript() {
        if (CURRENT_SITE) {
            attemptToFindPlayer();
            if (!videoPlayerElement) {
                startObservingDOM();
                setTimeout(() => { if (!videoPlayerElement) attemptToFindPlayer(); }, 2500);
                setTimeout(() => { if (!videoPlayerElement && !domObserver) startObservingDOM(); }, 3000);
                setTimeout(() => { if (!videoPlayerElement) attemptToFindPlayer(); }, 5500);
            }
        }
        // Request initial host status and client ID from background
        await ensureAblyClientId(); // Get client ID first

        chrome.runtime.sendMessage({ type: "GET_HOST_STATUS_FROM_BACKGROUND" }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("ContentScript: Error getting initial host status:", chrome.runtime.lastError.message);
            } else if (response) {
                updateHostStatus(response.isHost);
            }
        });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        initializeScript();
    } else {
        document.addEventListener('DOMContentLoaded', initializeScript);
    }
})();