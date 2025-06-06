// my-watch-party-ext/src/ably-service.js
import Ably from 'ably';

let ablyInstance = null;
let activeChannel = null;
// Make sure this key is active and has publish/subscribe/presence capabilities for the channels.
export const ABLY_API_KEY = "FhmMCw._lReJg:fdi6BuZ7oiu8zceJloz0DLrOOu_C3BLaIxMqyeg34oM"; 
export const CHANNEL_NAME_PREFIX = "watch-party-";
export const PLAYER_MESSAGE_NAME = "player-action"; // For video sync messages

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
        ablyInstance.connection.on("disconnected", (reason) => {
            console.warn("AblyService: Disconnected. Ably SDK will attempt to auto-reconnect.", reason);
        });
    });
}

export async function getAblyInstance() {
    if (!ablyInstance || !['connected', 'connecting', 'initialized'].includes(ablyInstance.connection.state)) {
        console.log("AblyService: Instance not ready or disconnected, attempting to connect/reconnect.");
        return await connectToAbly();
    }
    if (ablyInstance.connection.state === 'connecting' || ablyInstance.connection.state === 'initialized') {
        console.log("AblyService: Waiting for existing connection to complete in getAblyInstance.");
        await ablyInstance.connection.once('connected');
    }
    return ablyInstance;
}

export function getAblyClientId() {
    return ablyClientId;
}

async function updateLocalParticipantCount() {
    if (activeChannel && presenceUpdateCallback && typeof presenceUpdateCallback === 'function') {
        try {
            if (activeChannel.state === 'attached') {
                const members = await activeChannel.presence.get();
                presenceUpdateCallback(members.length);
            } else {
                console.warn("AblyService: updateLocalParticipantCount called but channel not attached.");
                presenceUpdateCallback(0);
            }
        } catch (err) {
            console.error("AblyService: Error getting presence members:", err);
            if (presenceUpdateCallback) presenceUpdateCallback(0);
        }
    }
}

export async function joinAndSubscribe(roomId, messageCallback, _presenceUpdateCallbackForBackground) {
    const instance = await getAblyInstance();
    if (!instance || instance.connection.state !== 'connected') {
        console.error("AblyService: Ably not connected. Cannot join room.");
        return null;
    }

    if (_presenceUpdateCallbackForBackground) {
        presenceUpdateCallback = _presenceUpdateCallbackForBackground;
    }

    const newChannelName = CHANNEL_NAME_PREFIX + roomId;

    if (activeChannel && activeChannel.name === newChannelName && activeChannel.state === 'attached') {
        console.log(`AblyService: Already attached to ${newChannelName}. Re-checking listeners.`);
        activeChannel.unsubscribe();
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (ablyMessageObject) => {
             if (messageCallback && typeof messageCallback === 'function') {
                console.log("AblyService (re-subscribe): Passing full Ably message to callback:", ablyMessageObject);
                messageCallback(ablyMessageObject, ablyMessageObject.clientId); // Pass WHOLE Ably message
            }
        });
        console.log(`AblyService: Re-subscribed to ${PLAYER_MESSAGE_NAME} on ${newChannelName}`);
        if (presenceUpdateCallback) {
            await activeChannel.presence.unsubscribe();
            await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
            updateLocalParticipantCount();
        }
        return activeChannel;
    }

    if (activeChannel && activeChannel.name !== newChannelName) {
        console.log(`AblyService: Switching channels. Detaching from old channel ${activeChannel.name}`);
        try {
            if (presenceUpdateCallback) await activeChannel.presence.unsubscribe();
            // Check state before detaching, might already be detached or failed
            if (['attached', 'attaching', 'suspended'].includes(activeChannel.state)) {
                 await activeChannel.detach();
            }
            activeChannel.unsubscribe();
            console.log(`AblyService: Detached and unsubscribed from ${activeChannel.name}`);
        } catch (detachError) {
            console.warn("AblyService: Error detaching from old channel:", detachError);
        }
        activeChannel = null;
    }
    
    currentSubscribedRoomId = roomId;
    console.log(`AblyService: Getting channel ${newChannelName}`);
    activeChannel = instance.channels.get(newChannelName);

    try {
        console.log(`AblyService: Attaching to channel ${newChannelName}...`);
        await activeChannel.attach();
        console.log(`AblyService: Channel ${newChannelName} attached.`);
        
        activeChannel.unsubscribe(); 
        // Subscribe only to PLAYER_MESSAGE_NAME for Ably messages handled by the extension's Ably client
        await activeChannel.subscribe(PLAYER_MESSAGE_NAME, (ablyMessageObject) => {
            console.log(`AblyService (initial subscribe): Received Ably message. Name=${ablyMessageObject.name}, ClientId=${ablyMessageObject.clientId}, Data=`, ablyMessageObject.data);
            if (messageCallback && typeof messageCallback === 'function') {
                console.log("AblyService (initial subscribe): Passing full Ably message to callback:", ablyMessageObject);
                messageCallback(ablyMessageObject, ablyMessageObject.clientId); // Pass WHOLE Ably message
            }
        });
        console.log(`AblyService: Successfully subscribed to '${PLAYER_MESSAGE_NAME}' on channel '${activeChannel.name}'.`);

        if (presenceUpdateCallback) {
            await activeChannel.presence.unsubscribe();
            await activeChannel.presence.subscribe(['enter', 'leave', 'update'], updateLocalParticipantCount);
            await activeChannel.presence.enter();
            console.log("AblyService: Extension entered presence.");
        }
        return activeChannel;
    } catch (err) {
        console.error(`AblyService: Error subscribing/attaching to channel '${newChannelName}':`, err);
        if (activeChannel && activeChannel.name === newChannelName) {
            try {
                if (activeChannel.state !== 'detached' && activeChannel.state !== 'failed') {
                    await activeChannel.detach();
                }
            } catch (detachErr) { console.warn("AblyService: Error detaching failed channel", detachErr); }
            activeChannel = null; 
            currentSubscribedRoomId = null;
        }
        return null; 
    }
}

export async function publishPlayerAction(roomId, payload) {
    const instance = await getAblyInstance();
    if (!instance || instance.connection.state !== 'connected') {
        console.error("AblyService: Not connected. Cannot publish player action.");
        return;
    }
    
    let targetChannel = activeChannel;
    // If not on the right channel or not attached, try to get/attach it.
    if (!targetChannel || currentSubscribedRoomId !== roomId || targetChannel.name !== (CHANNEL_NAME_PREFIX + roomId) || targetChannel.state !== 'attached') {
        console.warn(`AblyService: Not properly attached to room ${roomId} for publishing. Getting channel instance.`);
        targetChannel = instance.channels.get(CHANNEL_NAME_PREFIX + roomId);
        if (targetChannel.state !== 'attached') {
            try {
                console.log(`AblyService: Attaching to ${targetChannel.name} for publish.`);
                await targetChannel.attach();
                 // If this is a new channel context for publishing, ensure activeChannel reflects it if needed for consistency,
                 // though this publishPlayerAction is more about one-off publishing.
                 // For simplicity, we operate on targetChannel here. If joinAndSubscribe was intended, it should have been called.
            } catch (attachError) {
                console.error(`AblyService: Failed to attach to channel ${targetChannel.name} for publishing. Error:`, attachError);
                return;
            }
        }
    }

    if (!targetChannel || targetChannel.state !== 'attached') {
         console.error(`AblyService: Critical error - Channel ${CHANNEL_NAME_PREFIX + roomId} not attached. Cannot publish.`);
        return;
    }

    try {
        console.log(`AblyService: Publishing to channel '${targetChannel.name}', message name '${PLAYER_MESSAGE_NAME}':`, payload);
        await targetChannel.publish(PLAYER_MESSAGE_NAME, payload);
    } catch (err) {
        console.error("AblyService: Error publishing player action message:", err);
    }
}

export async function leaveRoom() {
     if (activeChannel) {
        const channelName = activeChannel.name;
        try {
            console.log(`AblyService: Leaving Ably channel ${channelName}`);
            if (activeChannel.state === 'attached' || activeChannel.state === 'attaching' || activeChannel.state === 'suspended') {
                if (presenceUpdateCallback) { 
                    try { await activeChannel.presence.leave(); } catch(e) { console.warn("Error leaving presence", e); }
                    try { await activeChannel.presence.unsubscribe(); } catch(e) { console.warn("Error unsubscribing presence", e); }
                }
                try { await activeChannel.detach(); } catch(e) { console.warn("Error detaching channel", e); }
            }
            activeChannel.unsubscribe(); 
            console.log(`AblyService: Successfully left channel ${channelName}.`);
        } catch (err) {
            console.error(`AblyService: Error during leaveRoom for channel ${channelName}:`, err);
        } finally {
            activeChannel = null;
            currentSubscribedRoomId = null;
            if (presenceUpdateCallback) {
                presenceUpdateCallback(0); 
            }
        }
    } else {
        console.log("AblyService: No active Ably channel to leave.");
    }
}

connectToAbly().catch(err => console.error("Initial Ably connection failed in ably-service", err));