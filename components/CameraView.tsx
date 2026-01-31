
import React, { useRef, useEffect, useState } from 'react';

interface CameraViewProps {
  onCapture: (url: string, confidence: number) => void;
  onLog: (msg: string) => void;
}

const CameraView: React.FC<CameraViewProps> = ({ onCapture, onLog }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("LINK_ESTABLISHED");
  const [isLocked, setIsLocked] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [hasError, setHasError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string>("");
  
  // States for visual feedback synchronization
  const [isPeaceActive, setIsPeaceActive] = useState(false);
  const [isBioActive, setIsBioActive] = useState(false);
  
  const peaceSignActive = useRef(false);
  const allSmiling = useRef(false);
  const holdStartTime = useRef<number | null>(null);
  const modelsReady = useRef(false);
  const isDestroying = useRef(false);
  const cameraInstance = useRef<any>(null);

  const REQUIRED_HOLD_MS = 1400; 
  const COOLDOWN_SECONDS = 3;

  useEffect(() => {
    let timer: number;
    if (cooldown > 0) {
      timer = window.setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
    } else if (cooldown === 0 && isLocked) {
      setIsLocked(false);
      setStatus("MONITORING");
    }
    return () => clearInterval(timer);
  }, [cooldown, isLocked]);

  const handleTrigger = () => {
    setIsLocked(true);
    setCooldown(COOLDOWN_SECONDS);
    setStatus("ARCHIVE_COMMITTED");
    if (canvasRef.current) {
      setTimeout(() => {
        onCapture(canvasRef.current!.toDataURL('image/png'), 1.0);
      }, 50);
    }
  };

  const startCamera = async () => {
    setHasError(null);
    setErrorDetails("");
    setStatus("INITIALIZING_OPTICS");
    onLog("REQUESTING_MEDIA_ACCESS...");

    // @ts-ignore
    const { Hands, FaceMesh, Camera, drawConnectors, FACEMESH_TESSELATION } = window;
    if (!Hands || !FaceMesh || !Camera) {
      setHasError("MEDIAPIPE_LOAD_FAIL");
      setErrorDetails("CRITICAL_LIBRARIES_NOT_FOUND. CHECK NETWORK UPLINK.");
      setStatus("CORE_FAILURE");
      return;
    }

    try {
      const hands = new Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      hands.setOptions({ maxNumHands: 1, minDetectionConfidence: 0.8, modelComplexity: 1 });

      const faceMesh = new FaceMesh({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.65 });

      hands.onResults((results: any) => {
        if (isDestroying.current) return;
        peaceSignActive.current = false;
        if (results.multiHandLandmarks?.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          const indexUp = landmarks[8].y < landmarks[6].y;
          const middleUp = landmarks[12].y < landmarks[10].y;
          const ringDown = landmarks[16].y > landmarks[14].y;
          const pinkyDown = landmarks[20].y > landmarks[18].y;
          if (indexUp && middleUp && ringDown && pinkyDown) {
            peaceSignActive.current = true;
          }
        }
      });

      // Store latest detection results without blocking
      const latestDetections = useRef<any>({ faceLandmarks: null, smiling: false });

      faceMesh.onResults((results: any) => {
        if (isDestroying.current) return;

        let someoneSmiling = false;
        if (results.multiFaceLandmarks) {
          for (const landmarks of results.multiFaceLandmarks) {
            const mouthWidth = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
            const faceWidth = Math.sqrt(Math.pow(landmarks[454].x - landmarks[234].x, 2) + Math.pow(landmarks[454].y - landmarks[234].y, 2));
            const ratio = mouthWidth / (faceWidth || 1);
            const smileVal = Math.min(100, Math.max(0, ((ratio - 0.42) / 0.16) * 100));
            
            if (smileVal > 35) someoneSmiling = true;
          }
        }

        // Store detections for rendering later
        latestDetections.current = {
          faceLandmarks: results.multiFaceLandmarks,
          smiling: someoneSmiling
        };
        allSmiling.current = someoneSmiling;
      });

      // Render loop: Always render camera feed at full FPS
      const renderFrame = () => {
        if (isDestroying.current) return;
        
        const canvasCtx = canvasRef.current?.getContext('2d');
        if (!canvasCtx || !canvasRef.current || !videoRef.current) {
          requestAnimationFrame(renderFrame);
          return;
        }

        const width = canvasRef.current.width;
        const height = canvasRef.current.height;

        // Draw camera feed (always at 30fps)
        canvasCtx.save();
        canvasCtx.filter = "contrast(1.2) brightness(1.05) saturate(1.1) hue-rotate(280deg)";
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(videoRef.current, 0, 0, width, height);
        canvasCtx.restore();

        // Overlay latest detections (updated at ~5fps by MediaPipe)
        const { faceLandmarks, smiling } = latestDetections.current;
        if (faceLandmarks) {
          for (const landmarks of faceLandmarks) {
            const mouthWidth = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
            const faceWidth = Math.sqrt(Math.pow(landmarks[454].x - landmarks[234].x, 2) + Math.pow(landmarks[454].y - landmarks[234].y, 2));
            const ratio = mouthWidth / (faceWidth || 1);
            const smileVal = Math.min(100, Math.max(0, ((ratio - 0.42) / 0.16) * 100));

            const xs = landmarks.map((l: any) => (1 - l.x) * width);
            const ys = landmarks.map((l: any) => l.y * height);
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

            if (FACEMESH_TESSELATION) {
              canvasCtx.save();
              canvasCtx.translate(width, 0);
              canvasCtx.scale(-1, 1);
              canvasCtx.shadowBlur = 10;
              canvasCtx.shadowColor = smiling ? '#39ff14' : '#bc6ff1';
              drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {
                color: smiling ? '#39ff14' : '#bc6ff1', 
                lineWidth: 0.6,
                alpha: 0.6
              });
              canvasCtx.restore();
            }

            canvasCtx.strokeStyle = smiling ? "#39ff14" : "#bc6ff1";
            canvasCtx.lineWidth = 2;
            const cLen = 20;
            const off = 30;
            canvasCtx.beginPath();
            canvasCtx.moveTo(minX - off, minY - off + cLen); canvasCtx.lineTo(minX - off, minY - off); canvasCtx.lineTo(minX - off + cLen, minY - off);
            canvasCtx.stroke();
            canvasCtx.beginPath();
            canvasCtx.moveTo(maxX + off - cLen, minY - off); canvasCtx.lineTo(maxX + off, minY - off); canvasCtx.lineTo(maxX + off, minY - off + cLen);
            canvasCtx.stroke();
            canvasCtx.beginPath();
            canvasCtx.moveTo(minX - off, maxY + off - cLen); canvasCtx.lineTo(minX - off, maxY + off); canvasCtx.lineTo(minX - off + cLen, maxY + off);
            canvasCtx.stroke();
            canvasCtx.beginPath();
            canvasCtx.moveTo(maxX + off - cLen, maxY + off); canvasCtx.lineTo(maxX + off, maxY + off); canvasCtx.lineTo(maxX + off, maxY + off - cLen);
            canvasCtx.stroke();

            canvasCtx.fillStyle = "rgba(0,0,0,0.6)";
            canvasCtx.fillRect(minX - off, minY - off - 25, 120, 18);
            canvasCtx.fillStyle = smiling ? "#39ff14" : "#bc6ff1";
            canvasCtx.font = "bold 9px 'Orbitron'";
            canvasCtx.fillText(`BIO: ${Math.round(smileVal)}%`, minX - off + 8, minY - off - 12);
          }
        }
        
        // Continue rendering at next frame
        requestAnimationFrame(renderFrame);
      };

      // Start the render loop
      requestAnimationFrame(renderFrame);

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          // Send frames to MediaPipe asynchronously (don't block/await)
          if (videoRef.current && !isLocked && !isDestroying.current) {
            hands.send({ image: videoRef.current }); // No await!
            faceMesh.send({ image: videoRef.current }); // No await!
          }
        },
        width: 1280, height: 720
      });
      
      await camera.start().catch((err: any) => {
        console.error("Camera diagnostic failed:", err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.toLowerCase().includes('denied')) {
           setHasError("PERMISSION_DENIED");
           setErrorDetails("DRAG_OS REQUIRES OPTICAL SENSOR ACCESS. PLEASE CLICK 'ALLOW' IN THE BROWSER PROMPT OR CLEAR PERMISSION BLOCK IN SETTINGS.");
           setStatus("ACCESS_BLOCKED");
           onLog("CAMERA_PERMISSION_DENIED: ACTION_REQUIRED");
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
           setHasError("HARDWARE_NOT_FOUND");
           setErrorDetails("NO COMPATIBLE CAMERA DETECTED IN THE LOCAL ARRAY. CHECK CABLES.");
           setStatus("HARDWARE_FAULT");
           onLog("HARDWARE_DISCONNECTED: NO_CAM_FOUND");
        } else {
           setHasError("CAMERA_INIT_FAIL");
           setErrorDetails(`UNEXPECTED DRIVER FAULT: ${err.message || "UNKNOWN_ERROR"}`);
           setStatus("HARDWARE_FAULT");
           onLog("CRITICAL_INIT_FAULT: CONTACT_ADMIN");
        }
      });

      cameraInstance.current = camera;
      modelsReady.current = true;
      setStatus("MONITORING");
      onLog("UPLINK_STABLE: OPTICS_ACTIVE");
    } catch (err: any) {
      setHasError("CORE_RUNTIME_ERROR");
      setErrorDetails(`SYSTEM_EXCEPTION: ${err.message || "FAILURE_DURING_INIT"}`);
      setStatus("INIT_FAULT");
      onLog("CRITICAL_SYSTEM_ERROR: SHUTTING_DOWN");
      console.error(err);
    }
  };

  useEffect(() => {
    isDestroying.current = false;
    const checkReady = setInterval(() => {
      // @ts-ignore
      if (window.Hands && window.FaceMesh && window.Camera) {
        clearInterval(checkReady);
        startCamera();
      }
    }, 500);

    return () => {
      clearInterval(checkReady);
      isDestroying.current = true;
      if (cameraInstance.current) cameraInstance.current.stop();
      modelsReady.current = false;
    };
  }, []);

  useEffect(() => {
    const loop = setInterval(() => {
      if (isLocked || !modelsReady.current || isDestroying.current || hasError) return;

      // Sync refs to state for UI updates
      setIsPeaceActive(peaceSignActive.current);
      setIsBioActive(allSmiling.current);

      if (peaceSignActive.current && allSmiling.current) {
        if (holdStartTime.current === null) holdStartTime.current = Date.now();
        const elapsed = Date.now() - holdStartTime.current;
        setHoldProgress(Math.min(100, (elapsed / REQUIRED_HOLD_MS) * 100));
        
        if (elapsed >= REQUIRED_HOLD_MS) {
          handleTrigger();
          holdStartTime.current = null;
        } else {
          setStatus("SYNC_IN_PROGRESS");
        }
      } else {
        holdStartTime.current = null;
        setHoldProgress(0);
        setStatus("SCANNING");
      }
    }, 40);

    return () => clearInterval(loop);
  }, [isLocked, hasError]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden cyber-clip-main neon-border">
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />
      <canvas ref={canvasRef} width="1280" height="720" className="absolute inset-0 w-full h-full object-cover z-10" />
      
      {/* GESTURE HUD OVERLAY (Subtle visual cue on screen) */}
      {!hasError && !isLocked && isPeaceActive && (
        <div className="absolute top-20 left-6 z-40 pointer-events-none animate-fade-in">
          <div className="flex flex-col gap-1 p-2 bg-purple-600/10 border-l-2 border-purple-500 backdrop-blur-sm">
             <span className="text-[7px] font-black text-purple-400 tracking-[0.3em] uppercase animate-pulse">Gesture_Match_Detected</span>
             <div className="flex gap-1">
                <div className="w-1 h-1 bg-purple-500 animate-bounce" />
                <div className="w-1 h-1 bg-purple-500 animate-bounce [animation-delay:0.1s]" />
                <div className="w-1 h-1 bg-purple-500 animate-bounce [animation-delay:0.2s]" />
             </div>
          </div>
        </div>
      )}

      {/* ERROR OVERLAY */}
      {hasError && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-2xl">
          <div className="w-20 h-20 border-2 border-red-600 rotate-45 flex items-center justify-center mb-8 animate-pulse shadow-[0_0_30px_rgba(220,38,38,0.4)]">
             <span className="text-red-600 text-4xl font-black -rotate-45">!</span>
          </div>
          <h2 className="text-red-500 text-2xl font-black tracking-[0.4em] uppercase mb-4 drop-shadow-[0_0_8px_rgba(220,38,38,1)]">{hasError}</h2>
          <p className="text-white/60 text-[10px] max-w-sm tracking-widest leading-relaxed uppercase mb-10 font-mono">
            {errorDetails}
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => startCamera()}
              className="px-8 py-4 bg-red-600/10 border border-red-600/50 text-red-500 font-black text-[9px] tracking-[0.6em] hover:bg-red-600 hover:text-white transition-all uppercase shadow-lg cyber-clip-main"
            >
              Retry_Initialization
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-4 border border-white/10 text-white/30 font-black text-[9px] tracking-[0.6em] hover:border-white/40 hover:text-white transition-all uppercase cyber-clip-main"
            >
              Hard_Reboot
            </button>
          </div>
        </div>
      )}

      {!hasError && <div className="absolute top-0 left-0 w-full h-[10px] bg-gradient-to-b from-transparent via-purple-400/40 to-transparent shadow-[0_0_20px_rgba(188,111,241,0.5)] animate-scan-line pointer-events-none z-30" />}
      
      {!hasError && (
        <div className="absolute top-6 right-6 z-30 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 bg-black/50 px-3 py-1 border border-red-500/20 backdrop-blur-sm">
            <div className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse" />
            <span className="text-red-500 font-black text-[8px] tracking-[0.3em]">REC_ACTIVE</span>
          </div>
          <div className="text-cyan-500 font-black text-[7px] tracking-[0.2em] bg-black/50 px-2 py-0.5 border-r border-cyan-500/30">ARRAY_01_FEED</div>
        </div>
      )}

      {holdProgress > 0 && !isLocked && !hasError && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2 w-[280px] flex flex-col gap-1.5 z-50">
          <div className="flex justify-between text-[8px] font-black text-white/50 tracking-[0.3em] uppercase">
            <span className="animate-pulse">STABILIZING_SYNC</span>
            <span className="text-purple-400">{Math.round(holdProgress)}%</span>
          </div>
          <div className="w-full h-1 bg-white/5 rounded-none border border-white/5 p-[0.5px]">
            <div className="h-full bg-gradient-to-r from-purple-600 via-purple-300 to-cyan-400 shadow-[0_0_10px_#bc6ff1] transition-all duration-75" style={{ width: `${holdProgress}%` }} />
          </div>
        </div>
      )}

      {!hasError && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-2 bg-black/90 border border-purple-500/20 cyber-clip-main flex items-center gap-10 backdrop-blur-2xl z-40 shadow-2xl">
          <div className="flex flex-col items-center gap-1 group">
            <div className="relative">
              <div className={`w-2.5 h-2.5 rotate-45 transition-all duration-300 ${isPeaceActive ? 'bg-purple-500 shadow-[0_0_15px_#bc6ff1] animate-gesture-pulse scale-110' : 'bg-white/5 border border-white/20'}`} />
              {isPeaceActive && (
                 <div className="absolute inset-0 w-full h-full rotate-45 border border-purple-400/50 animate-ping-slow pointer-events-none" />
              )}
            </div>
            <span className={`text-[6px] font-black tracking-widest uppercase transition-colors ${isPeaceActive ? 'text-purple-400' : 'text-white/20'}`}>GEST_KEY</span>
          </div>
          <div className="text-[10px] font-black tracking-[0.4em] text-white/80 italic uppercase text-center min-w-[120px]">{status}</div>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-2.5 h-2.5 rotate-45 transition-all duration-300 ${isBioActive ? 'bg-green-500 shadow-[0_0_15px_#39ff14] scale-110' : 'bg-white/5 border border-white/20'}`} />
            <span className={`text-[6px] font-black tracking-widest uppercase transition-colors ${isBioActive ? 'text-green-400' : 'text-white/20'}`}>BIO_KEY</span>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="absolute inset-0 z-[120] bg-white flex items-center justify-center animate-[flash_0.4s_ease-out_forwards]">
          <div className="text-black text-4xl font-black italic tracking-tighter uppercase">Authorized</div>
        </div>
      )}
      
      <style>{`
        @keyframes scan-line { 
          0% { top: -15%; opacity: 0; } 
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { top: 115%; opacity: 0; } 
        }
        @keyframes flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes gesture-pulse {
          0% { box-shadow: 0 0 5px #bc6ff1; }
          50% { box-shadow: 0 0 20px #bc6ff1; }
          100% { box-shadow: 0 0 5px #bc6ff1; }
        }
        @keyframes ping-slow {
          0% { transform: scale(1) rotate(45deg); opacity: 1; }
          100% { transform: scale(3) rotate(45deg); opacity: 0; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-scan-line { animation: scan-line 2.8s linear infinite; }
        .animate-gesture-pulse { animation: gesture-pulse 1s infinite; }
        .animate-ping-slow { animation: ping-slow 2s infinite ease-out; }
        .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default CameraView;
