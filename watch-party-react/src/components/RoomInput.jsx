// watch-party-react-js/src/components/RoomInput.jsx
import React, { useState, useEffect } from 'react';

function RoomInput({ extensionReady, extensionCurrentRoom, setStatus, setError }) {
    const [inputRoomId, setInputRoomId] = useState('');

    // Effect to pre-fill input if extension reports a current room
    useEffect(() => {
        if (extensionCurrentRoom) {
            setInputRoomId(extensionCurrentRoom);
        } else {
            // If extension leaves room, and input still matches, clear input
            // or user can clear it manually. For now, let's keep it simple.
            // If user clears it, extensionCurrentRoom might still have a value until updated.
        }
    }, [extensionCurrentRoom]);


    const handleJoinRoomClick = () => {
        if (!inputRoomId.trim()) {
            setError("Please enter a Room ID.");
            return;
        }
        if (!extensionReady) {
            setError("Extension is not ready. Please wait or refresh the page.");
            return;
        }
        setError('');
        setStatus(`Requesting extension to join room: ${inputRoomId.trim()}...`);
        window.postMessage({
            source: "WATCH_PARTY_REACT_APP",
            type: "REACT_APP_JOIN_ROOM",
            payload: { roomId: inputRoomId.trim() }
        }, "*");
    };

    const handleLeaveRoomClick = () => {
        if (!extensionCurrentRoom) {
            setError("Extension is not in a room to leave.");
            return;
        }
        if (!extensionReady) {
            setError("Extension is not ready. Please wait or refresh.");
            return;
        }
        setError('');
        setStatus(`Requesting extension to leave room: ${extensionCurrentRoom}...`);
        window.postMessage({
            source: "WATCH_PARTY_REACT_APP",
            type: "REACT_APP_LEAVE_ROOM",
            payload: { roomId: extensionCurrentRoom }
        }, "*");
    };

    return (
        <section className="room-controls-section">
            <h2>Room Management (Extension Control)</h2>
            <input
                type="text"
                placeholder="Enter Room ID"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                className="input-field"
                disabled={!extensionReady}
            />
            <button
                onClick={handleJoinRoomClick}
                className="button primary-button"
                disabled={!inputRoomId.trim() || !extensionReady || (extensionCurrentRoom === inputRoomId.trim())}
                title={extensionCurrentRoom === inputRoomId.trim() ? "Extension is already in this room" : "Tell extension to join or switch to this room"}
            >
                {extensionCurrentRoom === inputRoomId.trim() ? "Extension In This Room" : "Join / Switch Extension to Room"}
            </button>
            {extensionCurrentRoom && (
                <button
                    onClick={handleLeaveRoomClick}
                    className="button secondary-button"
                    disabled={!extensionReady}
                >
                    Leave Current Room (Extension)
                </button>
            )}
        </section>
    );
}

export default RoomInput;