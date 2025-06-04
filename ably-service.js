// ably-service.js
import Ably from 'ably';

let ablyInstance = null;
let activeChannel = null;
const ABLY_API_KEY = "FhmMCw._lReJg:fdi6BuZ7oiu8zceJloz0DLrOOu_C3BLaIxMqyeg34oM"; // <<< REPLACE WITH YOUR ACTUAL KEY
const CHANNEL_NAME_PREFIX = "watch-party-";
const PLAYER_MESSAGE_NAME = "player-action";

let currentSubscribedRoomId = null;
let ablyClientId = null;
let presenceUpdateCallback = null; // Callback to notify about presence changes

export async function connectToAbly() {
    if (ablyInstance && ablyInstance.connection.state === 'connected') {
        console.log("AblyService: Already connected.");
        return ablyInstance;
    }
    if (ablyInstance && (ablyInstance.connection.state === 'connecting' || ablyInstance.connection.state === 'initialized')) {
        console.log("AblyService: Connection in progress, waiting...");
        return ablyInstance.connection.once('connected');
    }

    console.log("AblyService: Connecting to Ably...");
    const generatedClientId = `ext-client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    // Store the generated ID immediately, it will be updated by Ably's assigned ID on connection
    ablyClientId = generatedClientId;

    ablyInstance = new Ably.Realtime({ key: ABLY_API_KEY, clientId: generatedClientId });

    return new Promise((resolve, reject) => {
        ablyInstance.connection.on("connected", () => {
            ablyClientId = ablyInstance.auth.clientId; // Update with actual clientId from Ably
            console.log(`AblyService: Connected to Ably successfully! Client ID: ${ablyClientId}`);
            resolve(ablyInstance);
        });
        ablyInstance.connection.on("failed", (err) => {
            console.error("AblyService: Connection failed:", err);
            ablyInstance = null; activeChannel = null; currentSubscribedRoomId = null; ablyClientId = null;
            reject(err);
        });
        ablyInstance.connection.on("closed", () => {
            console.log("AblyService: Connection closed.");
            ablyInstance = null; activeChannel = null; currentSubscribedRoomId = null; ablyClientId = null;
        });
        ablyInstance.connection.on("disconnected", () => {
            console.warn("AblyService: Disconnected. Ably SDK will attempt to auto-reconnect.");
        });
    });
}

export function getAblyClientId() {
    return ablyClientId;
}

async function updateLocalParticipantCount() {
    if (activeChannel && presenceUpdateCallback && typeof presenceUpdateCallback === 'function') {
        try {
            const members = await activeChannel.presence.get();
            presenceUpdateCallback(members.length);
        } catch (err) {
            console.error("AblyService: Error getting presence members:", err);
            presenceUpdateCallback(0); // Or handle error appropriately
        }
    }
}

export async function joinAndSubscribe(roomId, messageCallback, _presenceUpdateCallback) {
    if (!ablyInstance || ablyInstance.connection.state !== 'connected') {
        try {
            console.log("AblyService: Not connected, attempting to connect before joining room.");
            await connectToAbly();
            if (!ablyInstance || ablyInstance.connection.state !== 'connected') {
                console.error("AblyService: Connection attempt failed. Cannot join room.");
                return null;
            }
        } catch (err) {
            console.error("AblyService: Failed to connect before joining room.", err);
            return null;
        }
    }

    if (_presenceUpdateCallback) {
        presenceUpdateCallback = _presenceUpdateCallback; // Store the callback
    }

    const newChannelName = CHANNEL_NAME_PREFIX + roomId;

    if (activeChannel && activeChannel.name === newChannelName && activeChannel.state === 'attached') {
        console.log(`AblyService: Already subscribed to ${newChannelName}. Re-attaching listeners.`);
        activeChannel.unsubscribe(); // Unsubscribe all listeners first
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (message) => {
             if (messageCallback && typeof messageCallback === 'function') {
                messageCallback(message.data, message.clientId);
            }
        });
        // Re-subscribe to presence events
        await activeChannel.presence.unsubscribe(); // Clear previous presence listeners
        await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
        updateLocalParticipantCount(); // Initial count
        return activeChannel;
    }

    if (activeChannel && activeChannel.name !== newChannelName) { // If on a different channel
        try {
            console.log(`AblyService: Detaching from old channel ${activeChannel.name}`);
            await activeChannel.presence.unsubscribe(); // Unsubscribe from presence
            await activeChannel.detach();
            activeChannel.unsubscribe();
            console.log(`AblyService: Detached and unsubscribed from ${activeChannel.name}`);
        } catch (detachError) {
            console.warn("AblyService: Error detaching from old channel:", detachError);
        }
        activeChannel = null;
    }
    
    currentSubscribedRoomId = roomId;
    activeChannel = ablyInstance.channels.get(newChannelName);
    console.log(`AblyService: Getting channel ${newChannelName}`);

    try {
        await activeChannel.attach();
        console.log(`AblyService: Channel ${newChannelName} attached.`);
        
        activeChannel.unsubscribe(); // Clear any existing subscriptions on this new channel instance
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (message) => {
            // console.log(`AblyService: Message received on ${activeChannel.name}:`, message.data);
            if (messageCallback && typeof messageCallback === 'function') {
                messageCallback(message.data, message.clientId); // Pass clientId
            }
        });
        console.log(`AblyService: Successfully subscribed to channel '${activeChannel.name}' for message '${PLAYER_MESSAGE_NAME}'.`);

        // Subscribe to presence events
        await activeChannel.presence.unsubscribe(); // Clear previous presence listeners for this channel name
        await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
        // Enter presence for the current client
        await activeChannel.presence.enter(); // This will trigger an 'enter' event, and thus updateLocalParticipantCount
        // updateParticipantCount(); // No longer strictly needed here as enter() will trigger it.

        return activeChannel;
    } catch (err) {
        console.error(`AblyService: Error subscribing/attaching to channel '${newChannelName}':`, err);
        activeChannel = null; 
        currentSubscribedRoomId = null;
        return null; 
    }
}

export async function publishPlayerAction(roomId, payload) {
    if (!ablyInstance || ablyInstance.connection.state !== 'connected') {
        console.warn(`AblyService: Not connected. Attempting to connect before publishing.`);
        try {
            await connectToAbly();
            if (!ablyInstance || ablyInstance.connection.state !== 'connected') {
                console.error("AblyService: Connection attempt failed. Cannot publish.");
                return;
            }
        } catch (err) {
            console.error("AblyService: Failed to connect before publishing.", err);
            return;
        }
    }

    if (!activeChannel || currentSubscribedRoomId !== roomId || activeChannel.name !== (CHANNEL_NAME_PREFIX + roomId) || activeChannel.state !== 'attached') {
        console.warn(`AblyService: Not properly connected/subscribed to room ${roomId}. Attempting to join/rejoin.`);
        const channel = await joinAndSubscribe(roomId, () => {}, presenceUpdateCallback); // Pass existing presenceUpdateCallback
        if (!channel) {
            console.error(`AblyService: Still no channel for room ${roomId} after attempt. Cannot publish.`);
            return;
        }
    }
    
    if (!activeChannel || activeChannel.name !== (CHANNEL_NAME_PREFIX + roomId) || activeChannel.state !== 'attached') {
        console.error(`AblyService: Critical error - activeChannel not correctly set or attached for room ${roomId}. Cannot publish.`);
        return;
    }

    try {
        console.log(`AblyService: Publishing to channel '${activeChannel.name}', message name '${PLAYER_MESSAGE_NAME}':`, payload);
        await activeChannel.publish(PLAYER_MESSAGE_NAME, payload);
    } catch (err) {
        console.error("AblyService: Error publishing message:", err);
    }
}

export async function leaveRoom() {
    if (activeChannel) {
        const channelName = activeChannel.name;
        try {
            console.log(`AblyService: Leaving presence and detaching from channel ${channelName}`);
            // Unsubscribe first to stop receiving messages immediately
            activeChannel.unsubscribe();
            await activeChannel.presence.unsubscribe();
            await activeChannel.presence.leave(); 
            await activeChannel.detach();
            console.log(`AblyService: Successfully detached and unsubscribed from ${channelName}.`);
        } catch (err) {
            console.error(`AblyService: Error leaving room/detaching from channel ${channelName}:`, err);
        } finally {
            activeChannel = null;
            currentSubscribedRoomId = null;
            if (presenceUpdateCallback) {
                presenceUpdateCallback(0); // Notify UI that participant count is 0
            }
            // presenceUpdateCallback = null; // Don't nullify here, it might be needed if rejoining the same room later
        }
    } else {
        console.log("AblyService: No active channel to leave.");
    }
}

// Initial connection attempt
connectToAbly().catch(err => console.error("Initial Ably connection failed in ably-service", err));