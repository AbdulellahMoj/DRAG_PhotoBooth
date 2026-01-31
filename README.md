
# DRAG_BOOTH | Biometric Capture Station

A technical, security-themed photo booth utilizing MediaPipe for hand and face recognition.

## Local Setup
1. Install Node.js (v18+)
2. Run `npm install` to install dependencies.
3. Run `npm run dev` to start the local development server.
4. Open your browser to the URL shown in the terminal (usually `http://localhost:5173`).

## Controls
- **Gesture**: Hold up a **Peace Sign** to the camera.
- **Biometric**: **Smile** to validate the capture.
- **Sync**: Hold both for 1.5 seconds to trigger the "Archive" (Photo Capture).

## Technical Specs
- **Frontend**: React 19 + Tailwind CSS
- **Vision**: MediaPipe Hands + FaceMesh
- **Storage**: TmpFiles.org Uplink API
