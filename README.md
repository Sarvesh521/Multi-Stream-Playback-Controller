# Watch Party Sync

This project enables synchronized video playback across multiple browsers for platforms like Netflix and Hotstar, along with a web-based UI for room management and host designation. It consists of two main parts:

1.  **A Chrome Extension (`watch-party-ext`):** This extension injects scripts into supported video streaming sites (Netflix, Hotstar) to control playback. It communicates with the React UI and uses Ably for real-time synchronization of player actions between participants.
2.  **A React Web Application (`watch-party-react`):** This provides a user interface for users to instruct the Chrome extension to join a specific room and to designate a media tab as the "host" for that room.

## Core Functionality

*   **Room Management via React UI:** Users can specify a Room ID in the React web application.
*   **Extension Room Control:** The React app communicates with the locally installed Chrome extension to make the extension join or leave the specified room.
*   **Host Designation:** From the React UI, a user can trigger an action that tells their Chrome extension to find an open Netflix or Hotstar tab and set it as the "host" for the currently joined room.
*   **Synchronized Playback (Handled by Extension):**
    *   When a host performs actions like play, pause, or seek on their designated media tab, these actions are published via Ably.
    *   Other participants in the same Ably room, who also have the extension installed and joined to that room, will receive these actions, and their local video players will be synchronized accordingly.
*   **Supported Sites (by Extension):** Currently Netflix and Hotstar.

## Project Structure

*   **`watch-party-ext/`**: Contains the source code for the Chrome Extension.
    *   `src/`: JavaScript source files (`background.js`, `content.js`, `ably-service.js`, `webapp-content-script.js`).
    *   `dist/`: Bundled JavaScript files produced by Webpack.
    *   `icons/`: Extension icons.
    *   `manifest.json`: The extension's manifest file.
    *   `webpack.config.js`: Webpack configuration for bundling extension scripts.
*   **`watch-party-react/`**: Contains the source code for the React Web Application UI.
    *   `src/`: React components (`App.jsx`, `HeaderInfo.jsx`, etc.), main application logic, CSS.
    *   `public/`: Static assets for the React app.

## Prerequisites

*   [Node.js and npm](https://nodejs.org/) (or Yarn) installed.
*   A modern web browser that supports Chrome Extensions (e.g., Google Chrome, Brave, Microsoft Edge).
*   An [Ably](https://ably.com/) account and an API key. The API key should have `publish`, `subscribe`, and `presence` capabilities enabled for channels matching the pattern `watch-party-*`.

## Setup and Running

<!-- **1. Configure Ably API Key:**

   *   **For the React App (`watch-party-react/`):**
      1.  Navigate into the `watch-party-react/` directory.
      2.  Create a new file named `.env`.
      3.  Add your Ably API key :
          ```env
          VITE_ABLY_API_KEY="YOUR_ACTUAL_ABLY_API_KEY_HERE"
          ``` -->

**1. Build and Load the Chrome Extension:**

   ```bash
   cd watch-party-ext
   npm install
   npm run build
   ```
**2. Build the React App:**
```bash
cd watch-party-react
npm install
npm run dev 
```