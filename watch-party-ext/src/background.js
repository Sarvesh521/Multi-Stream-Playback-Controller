// my-watch-party-ext/src/background.js
import { publishPlayerAction, joinAndSubscribe, leaveRoom, connectToAbly, getAblyClientId, PLAYER_MESSAGE_NAME } from './ably-service';

console.log("Background service worker v1.6 (verified structure) started.");

const REACT_APP_URL = "http://localhost:5173"; // No trailing slash

let hostTabId = null;
let currentWatchPartyRoomId = null; // Room ID the EXTENSION is part of

async function initializeAbly() {
    try {
        await connectToAbly(); // Establishes connection for the extension
        const clientId = getAblyClientId();
        console.log("Background: Extension Ably client initialized. Client ID:", clientId);
        // Notify content scripts on Netflix/Hotstar about the extension's Ably client ID
        chrome.tabs.query({url: ["*://*.netflix.com/*", "*://*.hotstar.com/*"]}, (tabs) => {
            (tabs || []).forEach(tab => {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, { type: "ABLY_CLIENT_ID_NOTIFICATION", clientId: clientId })
                        .catch(e => {/* ignore if tab not listening or closed */});
                }
            });
        });
    } catch (error) {
        console.error("Background: Failed to initialize Ably connection for extension:", error);
    }
}
initializeAbly();

chrome.action.onClicked.addListener(async (tab) => {
    console.log("Extension icon clicked.");
    let urlToOpen = REACT_APP_URL;
    const queryParams = new URLSearchParams();

    if (currentWatchPartyRoomId) {
        queryParams.set('roomId', currentWatchPartyRoomId);
        const currentHostTabId = hostTabId; 
        if (currentHostTabId) {
            try {
                const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTabs[0] && activeTabs[0].id === currentHostTabId) {
                    queryParams.set('isHost', 'true'); 
                }
            } catch (e) { console.warn("Error checking active tab for host status on icon click", e); }
        }
    }
    const extAblyId = getAblyClientId(); 
    if (extAblyId) {
        queryParams.set('extensionAblyId', extAblyId);
    }
    
    const queryString = queryParams.toString();
    if (queryString) {
        urlToOpen += `?${queryString}`;
    }

    console.log("Opening React app with URL:", urlToOpen);

    const reactAppUrlPattern = `${REACT_APP_URL}/*`;
    chrome.tabs.query({ url: reactAppUrlPattern }, (existingTabs) => {
        if (chrome.runtime.lastError) {
            console.error("Error querying for React app tabs:", chrome.runtime.lastError.message);
            chrome.tabs.create({ url: urlToOpen }); 
            return;
        }
        if (existingTabs && existingTabs.length > 0 && existingTabs[0].id) {
            chrome.tabs.update(existingTabs[0].id, { active: true, url: urlToOpen }).then(() => {
                if (existingTabs[0].windowId) {
                    chrome.windows.update(existingTabs[0].windowId, { focused: true });
                }
            }).catch(e => {
                console.warn("Error updating/focusing existing React app tab, creating new. Error:", e.message);
                chrome.tabs.create({ url: urlToOpen });
            });
        } else {
            chrome.tabs.create({ url: urlToOpen });
        }
    });
});

// Ably Message Handler for messages received by THIS EXTENSION's Ably client
function handleExtensionAblyMessages(ablyMessage, senderAblyClientId) { // Expects full Ably message object
    console.log(
        `Background (Ably): Received message for EXTENSION. Name: "${ablyMessage.name}", Data:`,
        ablyMessage.data, "Sender Ably ClientID:", senderAblyClientId, "My Ext ClientID:", getAblyClientId()
    );

    if (ablyMessage.name === PLAYER_MESSAGE_NAME) { 
        const playerActionData = ablyMessage.data; // This is { site, action, time, logMessage }
        
        // Don't forward if this extension instance itself sent the message (already handled by content script)
        if (senderAblyClientId === getAblyClientId()) {
            // console.log("Background (Ably): Ignoring own published player action.");
            // Actually, even if it's own, other tabs might need it if they aren't the host.
            // The content script's ABLY_MESSAGE_FOR_CONTENT_SCRIPT handler also has a senderClientId check.
        }

        console.log("Background (Ably): Forwarding player action to content scripts:", playerActionData);
        chrome.tabs.query({url: ["*://*.netflix.com/*", "*://*.hotstar.com/*"]}, (tabs) => {
            (tabs || []).forEach(tab => {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: "ABLY_MESSAGE_FOR_CONTENT_SCRIPT", 
                        data: playerActionData,
                        senderClientId: senderAblyClientId 
                    }).catch(e => { /* ignore if tab not listening or closed */ });
                }
            });
        });
    }
    // Handle other Ably message names here if the extension's Ably client needs to react to them directly
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background (Runtime): Received message. Type:", request.type, "Payload:", request.payload, "From:", sender.tab ? `Tab ${sender.tab.id} (${sender.tab.url?.substring(0,50)})` : "Extension internal");

    switch (request.type) {
        case "PUBLISH_PLAYER_ACTION_TO_ABLY":
            if (sender.tab && sender.tab.id === hostTabId && currentWatchPartyRoomId) {
                publishPlayerAction(currentWatchPartyRoomId, request.payload)
                    .then(() => sendResponse({ status: "success", message: "Payload published to Ably." }))
                    .catch(err => {
                        console.error("Background: Error publishing player action:", err);
                        sendResponse({ status: "error", message: "Failed to publish to Ably." });
                    });
            } else {
                sendResponse({ status: "ignored", message: "Not host or no room." });
            }
            return true;

        case "GET_HOST_STATUS_FROM_BACKGROUND":
            sendResponse({ isHost: sender.tab && sender.tab.id === hostTabId && !!currentWatchPartyRoomId });
            return false;

        case "GET_MY_CLIENT_ID":
            sendResponse({ clientId: getAblyClientId() });
            return false;

        case "REACT_APP_GET_INITIAL_STATUS":
            console.log("Background: React App requested initial status.");
            sendResponse({
                status: "success",
                payload: {
                    message: "Initial status from extension.",
                    roomId: currentWatchPartyRoomId,
                    isHostSet: !!hostTabId,
                    extensionAblyId: getAblyClientId()
                }
            });
            return false;

        case "REACT_APP_JOIN_ROOM":
            const newRoomId = request.payload.roomId;
            if (!newRoomId || String(newRoomId).trim() === "") {
                sendResponse({ status: "error", message: "Room ID cannot be empty." });
                return true; 
            }
            console.log(`Background: React App requested extension to join room: ${newRoomId}`);
            const oldRoomId = currentWatchPartyRoomId;
            const prospectiveRoomId = newRoomId.trim();

            const doJoinLogic = () => {
                currentWatchPartyRoomId = prospectiveRoomId;
                joinAndSubscribe(currentWatchPartyRoomId, handleExtensionAblyMessages, null)
                    .then(channel => {
                        if (channel) {
                            console.log(`Background: Extension successfully joined Ably room: ${currentWatchPartyRoomId}`);
                            sendResponse({ status: "success", roomId: currentWatchPartyRoomId, message: `Extension joined room ${currentWatchPartyRoomId}` });
                            informWebApp({ type: "EXTENSION_ROOM_JOINED", payload: { roomId: currentWatchPartyRoomId } });
                        } else {
                            throw new Error("Ably channel could not be established by extension.");
                        }
                    })
                    .catch(err => {
                        console.error(`Background: Extension failed to join Ably room ${prospectiveRoomId}:`, err);
                        if(currentWatchPartyRoomId === prospectiveRoomId) currentWatchPartyRoomId = oldRoomId;
                        sendResponse({ status: "error", message: `Extension failed to join room: ${err.message}` });
                        informWebApp({ type: "EXTENSION_ROOM_JOIN_FAILED", payload: { roomId: prospectiveRoomId, error: err.message } });
                    });
            };

            if (currentWatchPartyRoomId === prospectiveRoomId) {
                console.log("Background: Extension already in room", currentWatchPartyRoomId);
                sendResponse({ status: "success", roomId: currentWatchPartyRoomId, message: "Extension already in room." });
                informWebApp({ type: "EXTENSION_ROOM_JOINED", payload: { roomId: currentWatchPartyRoomId } });
            } else if (oldRoomId && oldRoomId !== prospectiveRoomId) {
                leaveRoom().finally(doJoinLogic);
            } else { 
                doJoinLogic();
            }
            return true;

        case "REACT_APP_DESIGNATE_HOST_SESSION":
            const { roomId: roomToHostIn } = request.payload;
            if (!currentWatchPartyRoomId || currentWatchPartyRoomId !== roomToHostIn) {
                console.warn("Background: DESIGNATE_HOST request from React for wrong/no room. Ext room:", currentWatchPartyRoomId, "Req room:", roomToHostIn);
                sendResponse({ status: "error", message: "Extension not in the specified room or room mismatch." });
                informWebApp({ type: "EXTENSION_HOST_SET_FAILED", payload: { roomId: roomToHostIn, reason: "Extension not in the specified room.", isHostSet: !!hostTabId } });
                return true;
            }

            console.log(`Background: React App requests to designate a host for room ${currentWatchPartyRoomId}.`);
            chrome.tabs.query({url: ["*://*.netflix.com/*", "*://*.hotstar.com/*"]}, (mediaTabs) => {
                if (chrome.runtime.lastError) {
                    console.error("BG: Error querying media tabs for DESIGNATE_HOST:", chrome.runtime.lastError.message);
                    sendResponse({ status: "error", message: "Could not query media tabs."});
                    informWebApp({ type: "EXTENSION_HOST_SET_FAILED", payload: { roomId: currentWatchPartyRoomId, reason: "Error querying media tabs.", isHostSet: !!hostTabId } });
                    return;
                }

                if (mediaTabs && mediaTabs.length > 0) {
                    const potentialHostTab = mediaTabs[0]; 
                    
                    if (potentialHostTab.id) {
                        const oldHostTabId = hostTabId;
                        hostTabId = potentialHostTab.id;
                        console.log(`Background: Media Tab ${hostTabId} (URL: ${potentialHostTab.url}) is now host for room ${currentWatchPartyRoomId}, triggered by React App.`);

                        if (oldHostTabId && oldHostTabId !== hostTabId) {
                            chrome.tabs.sendMessage(oldHostTabId, { type: 'SET_HOST_STATUS', isHost: false }).catch(e => {/*ignore*/});
                        }
                        chrome.tabs.sendMessage(hostTabId, { type: 'SET_HOST_STATUS', isHost: true }).catch(e => {/*ignore*/});
                        
                        sendResponse({ status: "success", message: `Host set to tab ${hostTabId} for room ${currentWatchPartyRoomId}` });
                        informWebApp({ type: "EXTENSION_HOST_SET", payload: { roomId: currentWatchPartyRoomId, hostTabId: hostTabId, hostUrl: potentialHostTab.url, isHostSet: true } });
                    } else {
                        sendResponse({ status: "error", message: "Found media tab has no ID." });
                        informWebApp({ type: "EXTENSION_HOST_SET_FAILED", payload: { roomId: currentWatchPartyRoomId, reason: "Found media tab invalid.", isHostSet: !!hostTabId } });
                    }
                } else {
                    console.warn("Background: DESIGNATE_HOST: No open Netflix/Hotstar tabs found.");
                    sendResponse({ status: "error", message: "No open Netflix or Hotstar tabs found to set as host." });
                    informWebApp({ type: "EXTENSION_HOST_SET_FAILED", payload: { roomId: currentWatchPartyRoomId, reason: "No open Netflix/Hotstar tabs.", isHostSet: !!hostTabId } });
                }
            });
            return true;

        case "REACT_APP_LEAVE_ROOM":
            const { roomId: roomToLeave } = request.payload;
            if (currentWatchPartyRoomId && currentWatchPartyRoomId === roomToLeave) {
                leaveRoom().then(() => {
                    const prevHost = hostTabId;
                    hostTabId = null;
                    currentWatchPartyRoomId = null;
                    console.log("Background: Extension left room", roomToLeave);
                    sendResponse({status: "success", message: "Extension left room."});
                    informWebApp({ type: "EXTENSION_LEFT_ROOM", payload: { roomId: roomToLeave, wasHost: !!prevHost, isHostSet: false } });
                });
            } else {
                sendResponse({status: "ignored", message: "Extension not in that room or no room to leave."});
            }
            return true;

        case "SET_TAB_AS_HOST": 
            if (!currentWatchPartyRoomId) {
                sendResponse({ status: "error", message: "Cannot set host, extension not in a room." });
                return true;
            }
            const newHostTabIdInternal = request.tabId; 
            if (hostTabId !== newHostTabIdInternal && newHostTabIdInternal) { 
                const oldHostTabIdInternal = hostTabId;
                hostTabId = newHostTabIdInternal;
                console.log(`Background: Host tab ID updated internally to ${hostTabId}. Old: ${oldHostTabIdInternal}`);
                if (oldHostTabIdInternal) {
                    chrome.tabs.sendMessage(oldHostTabIdInternal, { type: 'SET_HOST_STATUS', isHost: false }).catch(e => {});
                }
            }
            if (hostTabId) {
                 console.log(`Background: Updating content script for host tab ${hostTabId} in room ${currentWatchPartyRoomId}.`);
                 chrome.tabs.sendMessage(hostTabId, { type: 'SET_HOST_STATUS', isHost: true }).catch(e => {});
                 sendResponse({ status: "success", message: `Host tab ${hostTabId} status processed.` });
                 informWebApp({ type: "EXTENSION_HOST_SET", payload: { roomId: currentWatchPartyRoomId, hostTabId: hostTabId, isHostSet: true } });
            } else {
                sendResponse({ status: "error", message: "No host tab ID available to set status (internal)." });
                 informWebApp({ type: "EXTENSION_HOST_SET_FAILED", payload: { roomId: currentWatchPartyRoomId, reason: "No host tab ID internally.", isHostSet: false } });
            }
            return true;

        default:
            console.warn("Background: Unhandled runtime message type:", request.type);
            sendResponse({ status: "unhandled", message: `Unknown message type: ${request.type}`}); // Important to send a response for unhandled
            return false; // If not async, return false or nothing. If async in some branches, true.
                          // Since some branches are async, default to true, but ensure unhandled sends sync response.
    }
});

function informWebApp(messagePayload) {
    const reactAppUrlPattern = `${REACT_APP_URL}/*`;
    chrome.tabs.query({ url: reactAppUrlPattern }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error("Background: Error querying for React App tabs:", chrome.runtime.lastError.message, "Pattern:", reactAppUrlPattern);
            return;
        }
        if (tabs && tabs.length > 0 && tabs[0].id) {
            const targetTabId = tabs[0].id;
            chrome.tabs.sendMessage(targetTabId, {
                source: "WATCH_PARTY_BACKGROUND",
                type: messagePayload.type,
                payload: messagePayload.payload
            }).catch(err => console.warn("Background: Could not send message to webapp-cs. Tab ID:", targetTabId, "Error:", err.message, "Payload type:", messagePayload.type));
        } else {
            // console.log("Background: No React App tab found to inform.");
        }
    });
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === hostTabId) {
        console.log(`Background: Host tab ${tabId} (Room: ${currentWatchPartyRoomId}) was closed. Clearing host status.`);
        const oldRoomId = currentWatchPartyRoomId;
        hostTabId = null;
        if (oldRoomId) {
            publishPlayerAction(oldRoomId, { action: "host_left", message: "Host has left the party." });
            informWebApp({ type: "EXTENSION_HOST_LEFT", payload: { roomId: oldRoomId, isHostSet: false } });
        }
    }
});