// background.js
import { publishPlayerAction, joinAndSubscribe, leaveRoom, connectToAbly, getAblyClientId } from './ably-service';

console.log("Background service worker started.");

let hostTabId = null;
let currentWatchPartyRoomId = null;

async function initializeAbly() {
    try {
        await connectToAbly();
        const clientId = getAblyClientId();
        if (clientId) {
            // Notify all content scripts of their Ably client ID
            chrome.tabs.query({}, (tabs) => {
                (tabs || []).forEach(tab => { // Add null check for tabs
                    if (tab.id && (tab.url?.includes("netflix.com") || tab.url?.includes("hotstar.com"))) {
                        chrome.tabs.sendMessage(tab.id, { type: "ABLY_CLIENT_ID_NOTIFICATION", clientId: clientId })
                            .catch(e => {/* Tab might not have content script or be closed */});
                    }
                });
            });
        }
    } catch (error) {
        console.error("Background: Failed to initialize Ably connection:", error);
    }
}

initializeAbly(); // Call on service worker startup

function handleAblyMessageFromRoom(receivedData, senderClientId) {
    console.log(`Background: Ably message received for room ${currentWatchPartyRoomId}, sender: ${senderClientId}. Forwarding... Data:`, receivedData);
    chrome.tabs.query({}, (tabs) => {
        (tabs || []).forEach(tab => { // Add null check for tabs
            if (tab.id && (tab.url?.includes("netflix.com") || tab.url?.includes("hotstar.com"))) {
                chrome.tabs.sendMessage(tab.id, {
                    type: "ABLY_MESSAGE_FOR_CONTENT_SCRIPT",
                    data: receivedData,
                    senderClientId: senderClientId
                }).catch(error => {
                    if (!(error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist"))) {
                        console.error(`Background: Error sending Ably message to tab ${tab.id}:`, error);
                    }
                });
            }
        });
    });
    chrome.runtime.sendMessage({type: "ABLY_MESSAGE_FOR_POPUP", data: receivedData, senderClientId: senderClientId})
       .catch(e => {/* Popup might not be open */});
}

function handlePresenceUpdate(participantCount) {
    console.log(`Background: Participant count for room ${currentWatchPartyRoomId} is ${participantCount}`);
    chrome.runtime.sendMessage({
        type: "PRESENCE_UPDATE_FOR_POPUP",
        data: {
            roomId: currentWatchPartyRoomId,
            participantCount: participantCount
        }
    }).catch(e => {/* Popup might not be open */});
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "PUBLISH_PLAYER_ACTION_TO_ABLY") {
        if (sender.tab && sender.tab.id === hostTabId && currentWatchPartyRoomId) {
            publishPlayerAction(currentWatchPartyRoomId, request.payload)
                .then(() => sendResponse({ status: "success", message: "Payload published to Ably." }))
                .catch(err => {
                    console.error("Background: Error publishing player action:", err);
                    sendResponse({ status: "error", message: "Failed to publish to Ably." });
                });
        } else {
            console.warn("Background: Publish request ignored. Not host or no room.", {tabId: sender.tab?.id, hostTabId, currentWatchPartyRoomId});
            sendResponse({ status: "ignored", message: "Not host or no room." });
        }
        return true;
    }
    else if (request.type === "SET_TAB_AS_HOST") {
        if (!currentWatchPartyRoomId) {
            sendResponse({ status: "error", message: "Cannot set host, not in a room." });
            return true;
        }
        const oldHostTabId = hostTabId;
        hostTabId = request.tabId;
        console.log(`Background: Tab ${hostTabId} is now host for room ${currentWatchPartyRoomId}.`);

        if (oldHostTabId && oldHostTabId !== hostTabId) {
            chrome.tabs.sendMessage(oldHostTabId, { type: 'SET_HOST_STATUS', isHost: false }).catch(e => console.warn("BG: Error informing old host.", e.message));
             chrome.runtime.sendMessage({ type: "HOST_STATUS_CHANGED_FOR_POPUP", data: { tabId: oldHostTabId, isHost: false, roomId: currentWatchPartyRoomId } }).catch(e => {});
        }
        if (hostTabId) {
            chrome.tabs.sendMessage(hostTabId, { type: 'SET_HOST_STATUS', isHost: true }).catch(e => console.warn("BG: Error informing new host.", e.message));
            chrome.runtime.sendMessage({ type: "HOST_STATUS_CHANGED_FOR_POPUP", data: { tabId: hostTabId, isHost: true, roomId: currentWatchPartyRoomId } }).catch(e => {});
        }
        sendResponse({ status: "success", message: "Host set." });
        return true;
    }
    else if (request.type === "GET_POPUP_INIT_STATUS") {
        if (currentWatchPartyRoomId && ablyInstance && ablyInstance.connection.state === 'connected') {
            const channel = ablyInstance.channels.get(CHANNEL_NAME_PREFIX + currentWatchPartyRoomId); // Get channel directly
            channel.presence.get().then(members => { // No need for activeChannel check here
                sendResponse({
                    roomId: currentWatchPartyRoomId,
                    isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                    ablyClientId: getAblyClientId(),
                    participantCount: members.length
                });
            }).catch(err => {
                console.error("Background: Error getting initial participant count for popup:", err);
                sendResponse({
                    roomId: currentWatchPartyRoomId,
                    isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                    ablyClientId: getAblyClientId(),
                    participantCount: 0
                });
            });
        } else {
            sendResponse({
                roomId: currentWatchPartyRoomId,
                isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                ablyClientId: getAblyClientId(),
                participantCount: 0
            });
        }
        return true; // Indicate async response
    }
    else if (request.type === "JOIN_WATCH_PARTY_ROOM") {
        const newRoomId = request.roomId;
        if (!newRoomId || String(newRoomId).trim() === "") {
            sendResponse({ status: "error", message: "Room ID cannot be empty." });
            return true;
        }
        
        const oldRoomId = currentWatchPartyRoomId;

        const joinLogic = () => {
            currentWatchPartyRoomId = newRoomId;
            hostTabId = null;
            proceedToJoin(newRoomId, sendResponse);
        };

        if (oldRoomId && oldRoomId !== newRoomId) {
            leaveRoom().then(() => {
                console.log(`Background: Left room ${oldRoomId} before joining ${newRoomId}`);
                joinLogic();
            }).catch(err => {
                console.error(`Background: Error leaving room ${oldRoomId}:`, err);
                joinLogic(); // Proceed even if leaving old room fails
            });
        } else {
            joinLogic(); // Handles both new join and re-joining the same room
        }
        return true;
    }
    else if (request.type === "GET_HOST_STATUS_FROM_BACKGROUND") {
        sendResponse({ isHost: sender.tab && sender.tab.id === hostTabId && !!currentWatchPartyRoomId });
        return true;
    }
    else if (request.type === "GET_MY_CLIENT_ID") {
        const clientId = getAblyClientId();
        if (clientId) {
            sendResponse({ clientId: clientId });
        } else {
            connectToAbly().then(instance => { // Attempt to connect if not already
                sendResponse({ clientId: getAblyClientId() });
            }).catch(err => {
                console.warn("Background: GET_MY_CLIENT_ID requested, but Ably connection failed.", err);
                sendResponse({ clientId: null });
            });
        }
        return true;
    }
});


function proceedToJoin(roomId, sendResponse) {
    joinAndSubscribe(roomId, handleAblyMessageFromRoom, handlePresenceUpdate)
        .then((channel) => {
            if (channel) {
                console.log(`Background: Successfully joined and subscribed to Ably room: ${roomId}`);
                sendResponse({ status: "success", message: `Joined Room: ${roomId}`, roomId: roomId });
                chrome.runtime.sendMessage({ type: "ROOM_STATUS_CHANGED_FOR_POPUP", data: { roomId: roomId, isHost: false } });
            } else {
                throw new Error("Channel could not be established or already processing.");
            }
        })
        .catch(err => {
            console.error(`Background: Failed to join Ably room ${roomId}:`, err);
            if (currentWatchPartyRoomId === roomId) { // Only nullify if it's the room we attempted to join
                currentWatchPartyRoomId = null;
            }
            sendResponse({ status: "error", message: `Failed to join Ably room: ${err.message}` });
        });
}


chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabId === hostTabId) {
        console.log(`Background: Host tab ${tabId} (Room: ${currentWatchPartyRoomId}) was closed. Clearing host status.`);
        const oldRoomId = currentWatchPartyRoomId;
        hostTabId = null;
        
        if (oldRoomId) {
            publishPlayerAction(oldRoomId, { action: "host_left", message: "Host has left the party." });
            chrome.runtime.sendMessage({ type: "HOST_STATUS_CHANGED_FOR_POPUP", data: { tabId: tabId, isHost: false, roomId: oldRoomId } }).catch(e => {});
        }
    }
});