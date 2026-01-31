# DRAG_PhotoBooth 📸

An advanced AI-powered photo booth application featuring real-time biometric capture and gesture recognition. Built for [@DRAGKAU](https://x.com/DRAGKAU) official event booths.

## 🎯 What is This?

DRAG_PhotoBooth is a cutting-edge interactive photo booth that uses computer vision and AI to create an immersive, futuristic capture experience. It combines hand gesture recognition with facial expression detection to trigger photo captures, providing attendees with a unique and engaging way to take photos at DRAG events.

**Official Use:** This application is deployed at DRAG official booths for event photography and attendee engagement.

## ✨ Features

- 🤖 **AI-Powered Recognition**: Real-time hand and face tracking using MediaPipe
- ✌️ **Gesture Control**: Peace sign detection for interactive control
- 😊 **Smile Detection**: Biometric validation through facial expression recognition
- 📷 **Smart Capture**: Synchronized gesture + smile detection triggers photo capture
- 🎨 **Modern UI**: Sleek, security-themed interface built with React 19 and Tailwind CSS
- 🔒 **Secure Storage**: Automatic photo upload to TmpFiles.org

## 🚀 Getting Started

### Prerequisites
- Node.js v18 or higher
- A webcam/camera device

### Installation

1. Clone the repository:
```bash
git clone https://github.com/AbdulellahMoj/DRAG_PhotoBooth.git
cd DRAG_PhotoBooth
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## 🎮 How to Use

1. **Position Yourself**: Stand in front of the camera
2. **Show Peace Sign**: Hold up a ✌️ peace sign with your hand
3. **Smile**: Flash your best smile 😊
4. **Hold Steady**: Maintain both gestures for 1.5 seconds
5. **Capture**: Photo automatically captured and archived!

## 🛠 Technical Stack

- **Frontend Framework**: React 19
- **Styling**: Tailwind CSS
- **Computer Vision**: MediaPipe (Hands + FaceMesh)
- **Build Tool**: Vite
- **Language**: TypeScript
- **Storage API**: TmpFiles.org Uplink

## 📦 Build for Production

```bash
npm run build
```

The optimized build will be available in the `dist/` directory.

## 🏢 About DRAG

This project is developed for [@DRAGKAU](https://x.com/DRAGKAU) official booths and events.

## 📄 License

Copyright © 2026 DRAG. All rights reserved.

---

**Built with ❤️ for DRAG Events**