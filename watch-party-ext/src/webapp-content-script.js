// my-watch-party-ext/src/webapp-content-script.js
console.log("Watch Party Extension: WebApp Content Script Injected and Active!");

// Listen for messages FROM the React Web App (running in the same tab)
window.addEventListener("message", (event) => {
    // Validate the message origin and structure
    if (event.source !== window || !event.data || typeof event.data.type !== 'string') {
        return;
    }

    // Filter for messages specifically from our React app
    if (event.data.source === "WATCH_PARTY_REACT_APP") {
        console.log("WebApp-CS: Received message from React app:", event.data);

        // Forward the relevant part of the message to the background script
        chrome.runtime.sendMessage({
            type: event.data.type, // e.g., "REACT_APP_SET_HOST"
            payload: event.data.payload
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`WebApp-CS: Error sending message type '${event.data.type}' to background:`, chrome.runtime.lastError.message);
                // Optionally send error back to React app
                window.postMessage({
                    source: "WATCH_PARTY_EXTENSION_CS",
                    type: "EXTENSION_RESPONSE_ERROR",
                    originalType: event.data.type,
                    error: chrome.runtime.lastError.message
                }, "*");
            } else {
                console.log("WebApp-CS: Response from background script for type", event.data.type, ":", response);
                // Send response back to React app
                window.postMessage({
                    source: "WATCH_PARTY_EXTENSION_CS",
                    type: "EXTENSION_RESPONSE",
                    originalType: event.data.type,
                    responsePayload: response
                }, "*");
            }
        });
    }
});

// Listen for messages FROM the background script TO the React Web App
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.source === "WATCH_PARTY_BACKGROUND" && request.type) {
        console.log("WebApp-CS: Received message from background for React App:", request);
        window.postMessage({
            source: "WATCH_PARTY_EXTENSION_CS", // Let React know it's from this content script
            type: request.type, // e.g., "ROOM_STATUS_UPDATE"
            payload: request.payload
        }, "*");
        sendResponse({ status: "WebApp-CS: Message received and forwarded to React App." });
        return true; // Indicate async response if needed, though not strictly here
    }
    return false; // No async response from this listener branch
});

// Inform the React app that this content script is ready
window.postMessage({
    source: "WATCH_PARTY_EXTENSION_CS",
    type: "CONTENT_SCRIPT_READY",
    payload: { message: "Extension content script for WebApp is active." }
}, "*");

console.log("WebApp-CS: Initial 'CONTENT_SCRIPT_READY' message sent to React App.");