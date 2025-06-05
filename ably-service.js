// ably-service.js
import Ably from 'ably';

let ablyInstance = null;
let activeChannel = null;
export const ABLY_API_KEY = "FhmMCw._lReJg:fdi6BuZ7oiu8zceJloz0DLrOOu_C3BLaIxMqyeg34oM"; //
export const CHANNEL_NAME_PREFIX = "watch-party-"; // Export this
export const PLAYER_MESSAGE_NAME = "player-action";

let currentSubscribedRoomId = null;
let ablyClientId = null;
let presenceUpdateCallback = null;

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
    ablyClientId = generatedClientId;

    ablyInstance = new Ably.Realtime({ key: ABLY_API_KEY, clientId: generatedClientId });

    return new Promise((resolve, reject) => {
        ablyInstance.connection.on("connected", () => {
            ablyClientId = ablyInstance.auth.clientId;
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

// Function to get the current Ably instance, ensures connection
export async function getAblyInstance() {
    if (!ablyInstance || ablyInstance.connection.state !== 'connected') {
        return await connectToAbly();
    }
    return ablyInstance;
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
            presenceUpdateCallback(0);
        }
    }
}

export async function joinAndSubscribe(roomId, messageCallback, _presenceUpdateCallback) {
    const instance = await getAblyInstance();
    if (!instance) {
        console.error("AblyService: Connection attempt failed. Cannot join room.");
        return null;
    }

    if (_presenceUpdateCallback) {
        presenceUpdateCallback = _presenceUpdateCallback;
    }

    const newChannelName = CHANNEL_NAME_PREFIX + roomId;

    if (activeChannel && activeChannel.name === newChannelName && activeChannel.state === 'attached') {
        console.log(`AblyService: Already subscribed to ${newChannelName}. Re-attaching listeners.`);
        activeChannel.unsubscribe();
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (message) => {
             if (messageCallback && typeof messageCallback === 'function') {
                messageCallback(message.data, message.clientId);
            }
        });
        await activeChannel.presence.unsubscribe();
        await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
        updateLocalParticipantCount();
        return activeChannel;
    }

    if (activeChannel && activeChannel.name !== newChannelName) {
        try {
            console.log(`AblyService: Detaching from old channel ${activeChannel.name}`);
            await activeChannel.presence.unsubscribe();
            await activeChannel.detach();
            activeChannel.unsubscribe();
            console.log(`AblyService: Detached and unsubscribed from ${activeChannel.name}`);
        } catch (detachError) {
            console.warn("AblyService: Error detaching from old channel:", detachError);
        }
        activeChannel = null;
    }
    
    currentSubscribedRoomId = roomId;
    activeChannel = instance.channels.get(newChannelName); // Use instance here
    console.log(`AblyService: Getting channel ${newChannelName}`);

    try {
        await activeChannel.attach();
        console.log(`AblyService: Channel ${newChannelName} attached.`);
        
        activeChannel.unsubscribe();
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (message) => {
            if (messageCallback && typeof messageCallback === 'function') {
                messageCallback(message.data, message.clientId);
            }
        });
        console.log(`AblyService: Successfully subscribed to channel '${activeChannel.name}' for message '${PLAYER_MESSAGE_NAME}'.`);

        await activeChannel.presence.unsubscribe();
        await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
        await activeChannel.presence.enter();
        return activeChannel;
    } catch (err) {
        console.error(`AblyService: Error subscribing/attaching to channel '${newChannelName}':`, err);
        activeChannel = null; 
        currentSubscribedRoomId = null;
        return null; 
    }
}

export async function publishPlayerAction(roomId, payload) {
    const instance = await getAblyInstance(); // Ensure connection
    if (!instance) {
        console.error("AblyService: Connection attempt failed. Cannot publish.");
        return;
    }

    if (!activeChannel || currentSubscribedRoomId !== roomId || activeChannel.name !== (CHANNEL_NAME_PREFIX + roomId) || activeChannel.state !== 'attached') {
        console.warn(`AblyService: Not properly connected/subscribed to room ${roomId}. Attempting to join/rejoin.`);
        const channel = await joinAndSubscribe(roomId, () => {}, presenceUpdateCallback);
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
                presenceUpdateCallback(0);
            }
        }
    } else {
        console.log("AblyService: No active channel to leave.");
    }
}

// Initial connection attempt
connectToAbly().catch(err => console.error("Initial Ably connection failed in ably-service", err));