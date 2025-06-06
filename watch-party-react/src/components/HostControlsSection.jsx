// watch-party-react-js/src/components/HostControlsSection.jsx
import React from 'react';

function HostControlsSection({ extensionCurrentRoom, extensionReady, setStatus, setError }) {

    const handleDesignateHostSessionClick = () => {
        if (!extensionCurrentRoom) { // Should not happen if this component is rendered
            setError("Internal error: No current room for host designation.");
            return;
        }
        if (!extensionReady) { // Should not happen
            setError("Extension is not ready for host designation.");
            return;
        }
        setError('');
        setStatus(`Requesting extension to designate a host for room: ${extensionCurrentRoom}...`);
        window.postMessage({
            source: "WATCH_PARTY_REACT_APP",
            type: "REACT_APP_DESIGNATE_HOST_SESSION",
            payload: { roomId: extensionCurrentRoom }
        }, "*");
    };

    return (
        <section className="host-controls-section">
            <h2>Host Controls for Room: {extensionCurrentRoom}</h2>
            <p>
                Clicking below will ask the extension to find an open Netflix/Hotstar tab
                and make it the host for this room.
            </p>
            <button
                onClick={handleDesignateHostSessionClick}
                className="button host-button"
            >
                Designate a Media Tab as Host
            </button>
        </section>
    );
}

export default HostControlsSection;