
import React, { useRef, useEffect, useState, useCallback } from 'react';

// Module-level constants — declared outside the component so they are never
// reallocated on re-render and are not part of any closure capture.
const CANVAS_FILTER = "contrast(1.2) brightness(1.05) saturate(1.1) hue-rotate(280deg)";
const CANVAS_W = 1280;
const CANVAS_H = 720;

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
  
  const [isGroupBioActive, setIsGroupBioActive] = useState(false);
  
  const allSmiling = useRef(false);
  const holdStartTime = useRef<number | null>(null);
  const modelsReady = useRef(false);
  const isDestroying = useRef(false);
  const cameraInstance = useRef<any>(null);
  const faceMeshInstanceRef = useRef<any>(null);
  const renderFrameIdRef = useRef<number | null>(null);
  const latestDetections = useRef<any>({ faceLandmarks: null, smiling: false });
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameCountRef = useRef(0);
  // FIX P1: Mirror of isLocked as a ref so onFrame (a one-time closure inside startCamera)
  //         always reads the current lock state. React state alone is stale in that closure.
  const isLockedRef = useRef(false);
  const lastResultAtRef = useRef<number>(Date.now());
  const lastHealthLogAtRef = useRef<number>(0);

  const REQUIRED_HOLD_MS = 1400; 
  const COOLDOWN_SECONDS = 3;

  const hasWebGLSupport = () => {
    const testCanvas = document.createElement('canvas');
    const gl =
      testCanvas.getContext('webgl2') ||
      testCanvas.getContext('webgl') ||
      testCanvas.getContext('experimental-webgl');

    if (!gl) return false;
    const loseContextExt = (gl as any).getExtension?.('WEBGL_lose_context');
    loseContextExt?.loseContext?.();
    return true;
  };

  const cleanupPipeline = useCallback(async () => {
    modelsReady.current = false;
    if (renderFrameIdRef.current !== null) {
      cancelAnimationFrame(renderFrameIdRef.current);
      renderFrameIdRef.current = null;
    }
    if (cameraInstance.current) {
      try {
        cameraInstance.current.stop();
      } catch {
      }
      cameraInstance.current = null;
    }
    if (faceMeshInstanceRef.current?.close) {
      try {
        await faceMeshInstanceRef.current.close();
      } catch {
      }
    }
    faceMeshInstanceRef.current = null;
    allSmiling.current = false;
    holdStartTime.current = null;
    frameCountRef.current = 0;
    latestDetections.current = { faceLandmarks: null, smiling: false };
  }, []);

  useEffect(() => {
    let timer: number;
    if (cooldown > 0) {
      timer = window.setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
    } else if (cooldown === 0 && isLocked) {
      isLockedRef.current = false; // sync ref alongside state
      setIsLocked(false);
      setStatus("MONITORING");
    }
    return () => clearInterval(timer);
  }, [cooldown, isLocked]);

  // useCallback so the decision-loop effect can safely list this as a dependency.
  const handleTrigger = useCallback(() => {
    isLockedRef.current = true; // sync ref immediately for onFrame
    setIsLocked(true);
    setCooldown(COOLDOWN_SECONDS);
    setStatus("ARCHIVE_COMMITTED");
    if (canvasRef.current) {
      setTimeout(() => {
        onCapture(canvasRef.current!.toDataURL('image/png'), 1.0);
      }, 50);
    }
  }, [onCapture]);

  const startCamera = async () => {
    isDestroying.current = true;
    await cleanupPipeline();
    isDestroying.current = false;

    setHasError(null);
    setErrorDetails("");
    setStatus("INITIALIZING_OPTICS");
    onLog("REQUESTING_MEDIA_ACCESS...");

    // @ts-ignore
    const { FaceMesh, Camera, drawConnectors, FACEMESH_TESSELATION } = window;
    if (!FaceMesh || !Camera) {
      setHasError("MEDIAPIPE_LOAD_FAIL");
      setErrorDetails("CRITICAL_LIBRARIES_NOT_FOUND. CHECK NETWORK UPLINK.");
      setStatus("CORE_FAILURE");
      return;
    }

    if (!hasWebGLSupport()) {
      setHasError("WEBGL_UNAVAILABLE");
      setErrorDetails("WEBGL CONTEXT COULD NOT BE CREATED. ENABLE HARDWARE ACCELERATION IN BROWSER SETTINGS OR TRY A DIFFERENT DEVICE/GPU.");
      setStatus("GPU_UNAVAILABLE");
      onLog("ERROR: WEBGL_CONTEXT_UNAVAILABLE");
      return;
    }

    try {
      const faceMesh = new FaceMesh({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      faceMesh.setOptions({ maxNumFaces: 5, refineLandmarks: true, minDetectionConfidence: 0.55, minTrackingConfidence: 0.5 });
      faceMeshInstanceRef.current = faceMesh;

      // latestDetections is declared at component level to satisfy React Rules of Hooks

      faceMesh.onResults((results: any) => {
        if (isDestroying.current) return;
        lastResultAtRef.current = Date.now();

        // Single pass: compute smileVal, set someoneSmiling, and cache for the render loop.
        // Previously the smile math ran twice (once to detect, once to cache) — merged here.
        let smilingFaces = 0;
        const facesDetected = results.multiFaceLandmarks?.length || 0;
        if (results.multiFaceLandmarks) {
          for (const landmarks of results.multiFaceLandmarks) {
            const mw = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
            const fw = Math.sqrt(Math.pow(landmarks[454].x - landmarks[234].x, 2) + Math.pow(landmarks[454].y - landmarks[234].y, 2));
            const sv = Math.min(100, Math.max(0, ((mw / (fw || 1)) - 0.42) / 0.16 * 100));
            if (sv > 35) smilingFaces++;
          }
        }

        const groupReady = facesDetected > 0 && smilingFaces === facesDetected;

        latestDetections.current = {
          faceLandmarks: results.multiFaceLandmarks,
          smiling: groupReady
        };
        allSmiling.current = groupReady;
      });

      const renderFrame = () => {
        if (isDestroying.current) return;

        // FIX 6: Initialise cached context once; avoids repeated getContext lookup
        if (!canvasCtxRef.current && canvasRef.current) {
          canvasCtxRef.current = canvasRef.current.getContext('2d');
        }
        const canvasCtx = canvasCtxRef.current;
        if (!canvasCtx || !canvasRef.current || !videoRef.current) {
          requestAnimationFrame(renderFrame);
          return;
        }

        // P3 FIX: Use module-level constants instead of DOM property reads every frame.
        const width = CANVAS_W;
        const height = CANVAS_H;

        // Reset shadow state once per frame before drawing anything.
        // (P4): Doing it here — outside any save/restore — means it's in effect for
        // the whole frame without needing to set it again inside the mesh block.
        canvasCtx.shadowBlur = 0;

        canvasCtx.save();
        canvasCtx.filter = CANVAS_FILTER;
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(videoRef.current, 0, 0, width, height);
        canvasCtx.restore();

        // Overlay latest detections (updated async by MediaPipe)
        const { faceLandmarks, smiling } = latestDetections.current;
        if (faceLandmarks) {
          for (const landmarks of faceLandmarks) {
            const mouthWidth = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
            const faceWidth = Math.sqrt(Math.pow(landmarks[454].x - landmarks[234].x, 2) + Math.pow(landmarks[454].y - landmarks[234].y, 2));
            const ratio = mouthWidth / (faceWidth || 1);
            const smileVal = Math.min(100, Math.max(0, ((ratio - 0.42) / 0.16) * 100));

            // FIX 5: Replace Math.min(...spread) with a manual loop — avoids 468-item
            //         argument list allocation and GC pressure on every render frame
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < landmarks.length; i++) {
              const x = (1 - landmarks[i].x) * width;
              const y = landmarks[i].y * height;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }

            if (FACEMESH_TESSELATION) {
              canvasCtx.save();
              canvasCtx.translate(width, 0);
              canvasCtx.scale(-1, 1);
              drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {
                color: smiling ? '#39ff14' : '#bc6ff1',
                lineWidth: 0.6,
                alpha: 0.6
              });
              canvasCtx.restore();
            }

            // P2 FIX: All 4 corner brackets batched into one path — 3 fewer canvas
            //         state flushes (stroke() calls) per face per frame.
            canvasCtx.strokeStyle = smiling ? "#39ff14" : "#bc6ff1";
            canvasCtx.lineWidth = 2;
            const cLen = 20;
            const off = 30;
            canvasCtx.beginPath();
            // top-left
            canvasCtx.moveTo(minX - off, minY - off + cLen); canvasCtx.lineTo(minX - off, minY - off); canvasCtx.lineTo(minX - off + cLen, minY - off);
            // top-right
            canvasCtx.moveTo(maxX + off - cLen, minY - off); canvasCtx.lineTo(maxX + off, minY - off); canvasCtx.lineTo(maxX + off, minY - off + cLen);
            // bottom-left
            canvasCtx.moveTo(minX - off, maxY + off - cLen); canvasCtx.lineTo(minX - off, maxY + off); canvasCtx.lineTo(minX - off + cLen, maxY + off);
            // bottom-right
            canvasCtx.moveTo(maxX + off - cLen, maxY + off); canvasCtx.lineTo(maxX + off, maxY + off); canvasCtx.lineTo(maxX + off, maxY + off - cLen);
            canvasCtx.stroke();

            canvasCtx.fillStyle = "rgba(0,0,0,0.6)";
            canvasCtx.fillRect(minX - off, minY - off - 25, 120, 18);
            canvasCtx.fillStyle = smiling ? "#39ff14" : "#bc6ff1";
            canvasCtx.font = "bold 9px 'Orbitron'";
            canvasCtx.fillText(`BIO: ${Math.round(smileVal)}%`, minX - off + 8, minY - off - 12);
          }
        }
        
        renderFrameIdRef.current = requestAnimationFrame(renderFrame);
      };

      renderFrameIdRef.current = requestAnimationFrame(renderFrame);

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          // P1 FIX: use isLockedRef (a ref) instead of isLocked (React state).
          // isLocked inside this closure is the value from when startCamera() ran
          // and never updates — it is always false. isLockedRef.current is current.
          if (!videoRef.current || isLockedRef.current || isDestroying.current || !modelsReady.current) return;
          frameCountRef.current++;
          if (frameCountRef.current % 2 !== 0) return;

          const now = Date.now();
          if (now - lastResultAtRef.current > 5000 && now - lastHealthLogAtRef.current > 5000) {
            lastHealthLogAtRef.current = now;
            onLog("WARN: NO_ML_RESULTS_5S");
          }

          const frameImage = videoRef.current;

          try {
            await faceMesh.send({ image: frameImage });
          } catch (err: any) {
            console.error("MediaPipe send error:", err);
            if (now - lastHealthLogAtRef.current > 1000) {
              lastHealthLogAtRef.current = now;
              onLog(`ERROR: ML_SEND_FAIL_${err?.message || "UNKNOWN"}`);
            }
            if ((err?.message || '').toLowerCase().includes('deleted object')) {
              isDestroying.current = true;
              void cleanupPipeline();
              setHasError("MODEL_CONTEXT_LOST");
              setErrorDetails("MEDIA PIPELINE CONTEXT WAS LOST. PLEASE CLICK RETRY_INITIALIZATION.");
              setStatus("PIPELINE_FAULT");
            }
          }
        },
        width: CANVAS_W, height: CANVAS_H
      });

      try {
        await camera.start();
      } catch (err: any) {
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
        return;
      }

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
      if (window.FaceMesh && window.Camera) {
        clearInterval(checkReady);
        startCamera();
      }
    }, 500);

    return () => {
      clearInterval(checkReady);
      isDestroying.current = true;
      void cleanupPipeline();
    };
  }, [cleanupPipeline]);

  useEffect(() => {
    const loop = setInterval(() => {
      if (isLocked || !modelsReady.current || isDestroying.current || hasError) return;

      // FIX 7: Guard all state updates against same-value writes.
      // Without this, React schedules a re-render every 40ms (25fps) even when nothing changed.
      const groupBio = allSmiling.current;
      setIsGroupBioActive(prev => prev === groupBio ? prev : groupBio);

      if (groupBio) {
        if (holdStartTime.current === null) holdStartTime.current = Date.now();
        const elapsed = Date.now() - holdStartTime.current;
        const progress = Math.min(100, (elapsed / REQUIRED_HOLD_MS) * 100);
        setHoldProgress(prev => prev === progress ? prev : progress);
        
        if (elapsed >= REQUIRED_HOLD_MS) {
          handleTrigger();
          holdStartTime.current = null;
        } else {
          setStatus(prev => prev === "SYNC_IN_PROGRESS" ? prev : "SYNC_IN_PROGRESS");
        }
      } else {
        holdStartTime.current = null;
        setHoldProgress(prev => prev === 0 ? prev : 0);
        setStatus(prev => prev === "SCANNING" ? prev : "SCANNING");
      }
    }, 40);

    return () => clearInterval(loop);
  // P6: handleTrigger is now stable (useCallback), so correctly listed as a dep here.
  }, [isLocked, hasError, handleTrigger]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden cyber-clip-main neon-border">
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="absolute inset-0 w-full h-full object-cover z-10" />
      
      {!hasError && !isLocked && isGroupBioActive && (
        <div className="absolute top-20 left-6 z-40 pointer-events-none animate-fade-in">
          <div className="flex flex-col gap-1 p-2 bg-purple-600/10 border-l-2 border-purple-500 backdrop-blur-sm">
             <span className="text-[7px] font-black text-purple-400 tracking-[0.3em] uppercase animate-pulse">Group_Smile_Ready</span>
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
          <div className="flex flex-col items-center gap-1">
            <div className={`w-2.5 h-2.5 rotate-45 transition-all duration-300 ${isGroupBioActive ? 'bg-green-500 shadow-[0_0_15px_#39ff14] scale-110' : 'bg-white/5 border border-white/20'}`} />
            <span className={`text-[6px] font-black tracking-widest uppercase transition-colors ${isGroupBioActive ? 'text-green-400' : 'text-white/20'}`}>GROUP_BIO</span>
          </div>
          <div className="text-[10px] font-black tracking-[0.4em] text-white/80 italic uppercase text-center min-w-[120px]">{status}</div>
        </div>
      )}

      {isLocked && (
        <div className="absolute inset-0 z-[120] bg-white flex items-center justify-center animate-[flash_0.4s_ease-out_forwards]">
          <div className="text-black text-4xl font-black italic tracking-tighter uppercase">Authorized</div>
        </div>
      )}
      
      {/* Keyframe animations moved to index.css — no longer injected per render */}
    </div>
  );
};

export default CameraView;
