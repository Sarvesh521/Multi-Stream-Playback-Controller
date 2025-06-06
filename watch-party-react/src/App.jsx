// watch-party-react-js/src/App.jsx
import React, { useState, useEffect } from 'react';
import HeaderInfo from './components/HeaderInfo';
import RoomInput from './components/RoomInput';
import HostControlsSection from './components/HostControlsSection';
import './App.css'; 

export default function App() {
    const [extensionReady, setExtensionReady] = useState(false); // Tracks if the webapp-content-script.js is injected and has sent its "READY" message.
    const [extensionCurrentRoom, setExtensionCurrentRoom] = useState(null); // Stores the room ID that the Chrome extension is currently connected to (if any).
    const [extensionIsHostSet, setExtensionIsHostSet] = useState(false); // Boolean indicating if a host is currently set for the room the extension is in.

    const [status, setStatus] = useState('Initializing & waiting for extension...');
    const [error, setError] = useState('');

    useEffect(() => {
        // This effect runs once when the App component mounts.
        // Its primary purpose is to set up a listener for messages from the extension
        // (sent via window.postMessage by webapp-content-script.js).
        const handleExtensionMessages = (event) => {
            if (event.source === window && event.data && event.data.source === "WATCH_PARTY_EXTENSION_CS") {
                console.log("React App: Received message from Extension CS:", event.data);
                const { type, payload, originalType, error: responseError } = event.data;

                if (type === "EXTENSION_RESPONSE_ERROR") {
                    console.error(`React App: Extension reported an error for original request '${originalType}':`, responseError);
                    setError(`Extension Error (${originalType || 'general'}): ${responseError || 'Unknown error'}`);
                    if (originalType === "REACT_APP_JOIN_ROOM") setStatus("Extension failed to join room.");
                    else if (originalType === "REACT_APP_DESIGNATE_HOST_SESSION") setStatus("Extension failed to set host.");
                    return;
                }
                
                if (type === "EXTENSION_RESPONSE" && payload?.status === "success") {
                    // Handle generic success more specifically if possible, or rely on specific events
                    if (originalType === "REACT_APP_JOIN_ROOM" && payload?.roomId) {
                        // Covered by EXTENSION_ROOM_JOINED
                    } else if (originalType === "REACT_APP_DESIGNATE_HOST_SESSION") {
                        // Covered by EXTENSION_HOST_SET
                    }
                     console.log(`React App: Generic Extension response to '${originalType}':`, payload);
                    return;
                }


                switch (type) {
                    case "CONTENT_SCRIPT_READY":
                        setExtensionReady(true);
                        setStatus("Extension ready. Requesting initial status...");
                        // Now that the bridge is ready, ask the extension for its current state.
                        window.postMessage({
                            source: "WATCH_PARTY_REACT_APP",
                            type: "REACT_APP_GET_INITIAL_STATUS",
                            payload: {} 
                        }, "*");
                        break;
                    case "CURRENT_EXTENSION_STATUS": 
                        setStatus(payload.message || "Extension status received.");
                        setExtensionCurrentRoom(payload.roomId || null);
                        setExtensionIsHostSet(payload.isHostSet || false);
                        setError('');
                        break;
                    case "EXTENSION_ROOM_JOINED":
                        setStatus(`Extension successfully joined room: ${payload.roomId}`);
                        setExtensionCurrentRoom(payload.roomId);
                        setError('');
                        break;
                    case "EXTENSION_ROOM_JOIN_FAILED":
                        setStatus(`Extension failed to join room: ${payload.roomId}`);
                        setError(payload.error || "Unknown error joining room by extension.");
                        break;
                    case "EXTENSION_HOST_SET":
                        setStatus(`Host set by extension for room ${payload.roomId}. Media Tab URL: ${payload.hostUrl || 'N/A'}`);
                        setExtensionIsHostSet(true);
                        setError('');
                        break;
                    case "EXTENSION_HOST_SET_FAILED":
                        setStatus(`Extension failed to set host for room ${payload.roomId}: ${payload.reason}`);
                        setError(payload.reason || "Unknown error setting host by extension.");
                        setExtensionIsHostSet(payload.isHostSet || false); 
                        break;
                    case "EXTENSION_LEFT_ROOM":
                        setStatus(`Extension left room: ${payload.roomId}`);
                        if (extensionCurrentRoom === payload.roomId) {
                            setExtensionCurrentRoom(null);
                            setExtensionIsHostSet(false);
                        }
                        break;
                    case "EXTENSION_HOST_LEFT": 
                        setStatus(`Host left room: ${payload.roomId}. No active host.`);
                        if (extensionCurrentRoom === payload.roomId) {
                            setExtensionIsHostSet(false);
                        }
                        break;
                    default:
                        console.warn("React App: Received unhandled message type from extension CS:", type, payload);
                }
            }
        };
        // Add the event listener for messages from the extension
        window.addEventListener("message", handleExtensionMessages);
        return () => window.removeEventListener("message", handleExtensionMessages);
    }, [extensionCurrentRoom]); // Re-run if extensionCurrentRoom changes to potentially re-fetch status or adapt UI

    if (!import.meta.env.VITE_ABLY_API_KEY && !ABLY_API_KEY_FALLBACK_FOR_EXTENSION_ONLY_MODE) { // Check if API key is available for extension
        // This check is more for if React app itself needed Ably.
        // For the current extension-centric model, this might not be strictly necessary here.
        // return ( /* API Key error display */ );
    }
    const ABLY_API_KEY_FALLBACK_FOR_EXTENSION_ONLY_MODE = "YOUR_FALLBACK_KEY_IF_NEEDED_ELSEWHERE";


    return (
        <div className="app-container">
            <HeaderInfo
                status={status}
                error={error}
                extensionReady={extensionReady}
                extensionCurrentRoom={extensionCurrentRoom}
                extensionIsHostSet={extensionIsHostSet}
            />

            <RoomInput
                extensionReady={extensionReady}
                extensionCurrentRoom={extensionCurrentRoom}
                setStatus={setStatus}
                setError={setError}
            />

            {extensionCurrentRoom && extensionReady && (
                <HostControlsSection
                    extensionCurrentRoom={extensionCurrentRoom}
                    extensionReady={extensionReady}
                    setStatus={setStatus}
                    setError={setError}
                />
            )}
        </div>
    );
}