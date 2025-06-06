// watch-party-react-js/src/components/HeaderInfo.jsx
import React from 'react';

function HeaderInfo({ status, error, extensionReady, extensionCurrentRoom, extensionIsHostSet }) {
    return (
        <>
            <header>
                <h1>Watch Party - UI</h1>
                <p>Status: <span style={{ fontWeight: 'bold' }}>{status}</span></p>
                {extensionCurrentRoom && <p>Extension is in Room: <strong>{extensionCurrentRoom}</strong></p>}
                {extensionCurrentRoom && extensionIsHostSet && <p style={{ color: 'green', fontWeight: 'bold' }}>A Host is currently set for this room!</p>}
                {!extensionCurrentRoom && extensionReady && <p>Extension is not currently in a room.</p>}
                {!extensionReady && <p style={{ color: 'orange', fontWeight: 'bold' }}>Waiting for extension content script...</p>}
            </header>
            {error && <p className="error-message">Error: {error}</p>}
        </>
    );
}

export default HeaderInfo;