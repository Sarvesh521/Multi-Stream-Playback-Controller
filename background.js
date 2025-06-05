// background.js
import { 
    publishPlayerAction, 
    joinAndSubscribe, 
    leaveRoom, 
    connectToAbly, 
    getAblyClientId,
    getAblyInstance, // Import the new getter
    CHANNEL_NAME_PREFIX // Import this constant
} from './ably-service';

console.log("Background service worker started.");

let hostTabId = null;
let currentWatchPartyRoomId = null;

async function initializeAbly() {
    try {
        await connectToAbly(); // This still establishes the initial connection
        const clientId = getAblyClientId();
        if (clientId) {
            chrome.tabs.query({}, (tabs) => {
                (tabs || []).forEach(tab => {
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

initializeAbly();

function handleAblyMessageFromRoom(receivedData, senderClientId) {
    console.log(`Background: Ably message received for room ${currentWatchPartyRoomId}, sender: ${senderClientId}. Forwarding... Data:`, receivedData);
    chrome.tabs.query({}, (tabs) => {
        (tabs || []).forEach(tab => {
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
    // Wrap the message handling in an async IIFE to use await
    (async () => {
        if (request.type === "PUBLISH_PLAYER_ACTION_TO_ABLY") {
            if (sender.tab && sender.tab.id === hostTabId && currentWatchPartyRoomId) {
                try {
                    await publishPlayerAction(currentWatchPartyRoomId, request.payload);
                    sendResponse({ status: "success", message: "Payload published to Ably." });
                } catch (err) {
                    console.error("Background: Error publishing player action:", err);
                    sendResponse({ status: "error", message: "Failed to publish to Ably." });
                }
            } else {
                console.warn("Background: Publish request ignored. Not host or no room.", {tabId: sender.tab?.id, hostTabId, currentWatchPartyRoomId});
                sendResponse({ status: "ignored", message: "Not host or no room." });
            }
        }
        else if (request.type === "SET_TAB_AS_HOST") {
            if (!currentWatchPartyRoomId) {
                sendResponse({ status: "error", message: "Cannot set host, not in a room." });
                return; // No need for return true if sendResponse is synchronous
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
        }
        else if (request.type === "GET_POPUP_INIT_STATUS") {
            try {
                const instance = await getAblyInstance(); // Ensure Ably is connected
                if (currentWatchPartyRoomId && instance && instance.connection.state === 'connected') {
                    const channel = instance.channels.get(CHANNEL_NAME_PREFIX + currentWatchPartyRoomId);
                    const members = await channel.presence.get();
                    sendResponse({
                        roomId: currentWatchPartyRoomId,
                        isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                        ablyClientId: getAblyClientId(),
                        participantCount: members.length
                    });
                } else {
                    sendResponse({
                        roomId: currentWatchPartyRoomId,
                        isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                        ablyClientId: getAblyClientId(), // May be null if not connected yet
                        participantCount: 0
                    });
                }
            } catch (err) {
                console.error("Background: Error in GET_POPUP_INIT_STATUS (Ably connection or presence):", err);
                sendResponse({
                    roomId: currentWatchPartyRoomId,
                    isHost: (request.tabId === hostTabId && !!currentWatchPartyRoomId),
                    ablyClientId: getAblyClientId(),
                    participantCount: 0,
                    error: "Failed to get full status from Ably."
                });
            }
        }
        else if (request.type === "JOIN_WATCH_PARTY_ROOM") {
            const newRoomId = request.roomId;
            if (!newRoomId || String(newRoomId).trim() === "") {
                sendResponse({ status: "error", message: "Room ID cannot be empty." });
                return; // No need for return true
            }
            
            const oldRoomId = currentWatchPartyRoomId;

            const joinLogic = async () => { // Make joinLogic async
                currentWatchPartyRoomId = newRoomId;
                hostTabId = null;
                try {
                    await proceedToJoin(newRoomId, sendResponse); // await the async function
                } catch (e) {
                    // sendResponse is handled within proceedToJoin's catch
                    console.error("Background: Error during joinLogic call to proceedToJoin", e);
                }
            };

            if (oldRoomId && oldRoomId !== newRoomId) {
                try {
                    await leaveRoom();
                    console.log(`Background: Left room ${oldRoomId} before joining ${newRoomId}`);
                    await joinLogic();
                } catch (err_1) {
                    console.error(`Background: Error leaving room ${oldRoomId}:`, err_1);
                    await joinLogic(); // Proceed even if leaving old room fails
                }
            } else {
                await joinLogic(); // Handles both new join and re-joining the same room
            }
        }
        else if (request.type === "GET_HOST_STATUS_FROM_BACKGROUND") {
            sendResponse({ isHost: sender.tab && sender.tab.id === hostTabId && !!currentWatchPartyRoomId });
        }
        else if (request.type === "GET_MY_CLIENT_ID") {
            try {
                await connectToAbly(); // Ensure connection
                const clientId = getAblyClientId();
                sendResponse({ clientId: clientId });
            } catch (err_2) {
                console.warn("Background: GET_MY_CLIENT_ID requested, but Ably connection failed.", err_2);
                sendResponse({ clientId: null });
            }
        }
        // If no specific handler matched or if sendResponse was already called,
        // it's fine. Returning true only if sendResponse is meant to be async.
        // Most handlers here are becoming async due to Ably operations.
    })(); // Immediately invoke the async function
    return true; // Crucial for all async operations within the listener
});


async function proceedToJoin(roomId, sendResponse) { // Make this async too
    try {
        const channel = await joinAndSubscribe(roomId, handleAblyMessageFromRoom, handlePresenceUpdate);
        if (channel) {
            console.log(`Background: Successfully joined and subscribed to Ably room: ${roomId}`);
            sendResponse({ status: "success", message: `Joined Room: ${roomId}`, roomId: roomId });
            chrome.runtime.sendMessage({ type: "ROOM_STATUS_CHANGED_FOR_POPUP", data: { roomId: roomId, isHost: false } });
        } else {
            throw new Error("Channel could not be established or already processing.");
        }
    } catch (err) {
        console.error(`Background: Failed to join Ably room ${roomId}:`, err);
        if (currentWatchPartyRoomId === roomId) {
            currentWatchPartyRoomId = null;
        }
        sendResponse({ status: "error", message: `Failed to join Ably room: ${err.message || 'Unknown error'}` });
    }
}


chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => { // Make listener async
    if (tabId === hostTabId) {
        console.log(`Background: Host tab ${tabId} (Room: ${currentWatchPartyRoomId}) was closed. Clearing host status.`);
        const oldRoomId = currentWatchPartyRoomId;
        hostTabId = null;
        
        if (oldRoomId) {
            try {
                await publishPlayerAction(oldRoomId, { action: "host_left", message: "Host has left the party." });
            } catch (e) {
                console.error("Background: Error publishing host_left message", e);
            }
            chrome.runtime.sendMessage({ type: "HOST_STATUS_CHANGED_FOR_POPUP", data: { tabId: tabId, isHost: false, roomId: oldRoomId } }).catch(e => {});
        }
    }
});