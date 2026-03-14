
import React, { useRef, useEffect, useState, useCallback } from 'react';

// Module-level constants — declared outside the component so they are never
// reallocated on re-render and are not part of any closure capture.
const CANVAS_FILTER = "contrast(1.2) brightness(1.05) saturate(1.1) hue-rotate(280deg)";
const CANVAS_W = 1280;
const CANVAS_H = 720;
const DEBUG_MESH = true;

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

  const getDisplayStatus = () => {
    if (isLocked) return "CAPTURED";
    if (status === "SYNC_IN_PROGRESS") return "HOLD SMILE";
    if (status === "MONITORING" || status === "SCANNING") return "SCANNING FOR TARGET";
    if (status === "ARCHIVE_COMMITTED") return "CAPTURE READY";
    if (status === "DEVICE_LOCKED") return "CAMERA BUSY";
    if (status === "GPU_UNAVAILABLE") return "WEBGL UNAVAILABLE";
    return status.replaceAll('_', ' ');
  };

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

      const renderVideoLayer = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) => {
        ctx.save();
        ctx.filter = CANVAS_FILTER;
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
      };

      const renderFaceTargets = (
        ctx: CanvasRenderingContext2D,
        landmarksList: any[],
        width: number,
        height: number,
        groupReady: boolean
      ) => {
        for (const landmarks of landmarksList) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < landmarks.length; i++) {
            const x = (1 - landmarks[i].x) * width;
            const y = landmarks[i].y * height;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }

          const accent = groupReady ? "#39ff14" : "#bc6ff1";
          const cLen = 24;
          const off = 20;

          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(minX - off, minY - off + cLen); ctx.lineTo(minX - off, minY - off); ctx.lineTo(minX - off + cLen, minY - off);
          ctx.moveTo(maxX + off - cLen, minY - off); ctx.lineTo(maxX + off, minY - off); ctx.lineTo(maxX + off, minY - off + cLen);
          ctx.moveTo(minX - off, maxY + off - cLen); ctx.lineTo(minX - off, maxY + off); ctx.lineTo(minX - off + cLen, maxY + off);
          ctx.moveTo(maxX + off - cLen, maxY + off); ctx.lineTo(maxX + off, maxY + off); ctx.lineTo(maxX + off, maxY + off - cLen);
          ctx.stroke();

          if (DEBUG_MESH && FACEMESH_TESSELATION) {
            ctx.save();
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {
              color: accent,
              lineWidth: 0.7,
              alpha: 0.55
            });
            ctx.restore();
          }
        }
      };

      const renderSmileIndicators = (ctx: CanvasRenderingContext2D, landmarksList: any[], width: number, height: number) => {
        for (const landmarks of landmarksList) {
          const mouthWidth = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
          const faceWidth = Math.sqrt(Math.pow(landmarks[454].x - landmarks[234].x, 2) + Math.pow(landmarks[454].y - landmarks[234].y, 2));
          const ratio = mouthWidth / (faceWidth || 1);
          const smileVal = Math.min(100, Math.max(0, ((ratio - 0.42) / 0.16) * 100));

          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < landmarks.length; i++) {
            const x = (1 - landmarks[i].x) * width;
            const y = landmarks[i].y * height;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }

          ctx.fillStyle = "rgba(2,0,5,0.82)";
          ctx.fillRect(minX - 4, maxY + 10, 170, 20);
          ctx.fillStyle = smileVal > 35 ? "#6dff5a" : "#d3a8ff";
          ctx.font = "bold 14px Orbitron";
          ctx.fillText(`SMILE INDEX ${Math.round(smileVal)}%`, minX + 3, maxY + 24);
        }
      };

      const renderScannerFX = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        ctx.strokeStyle = "rgba(188,111,241,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width * 0.5, 0);
        ctx.lineTo(width * 0.5, height);
        ctx.moveTo(0, height * 0.5);
        ctx.lineTo(width, height * 0.5);
        ctx.stroke();
      };

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

        const width = CANVAS_W;
        const height = CANVAS_H;
        canvasCtx.shadowBlur = 0;
        renderVideoLayer(canvasCtx, videoRef.current, width, height);

        const { faceLandmarks, smiling } = latestDetections.current;
        if (faceLandmarks) {
          renderFaceTargets(canvasCtx, faceLandmarks, width, height, smiling);
          renderSmileIndicators(canvasCtx, faceLandmarks, width, height);
        }
        renderScannerFX(canvasCtx, width, height);
        
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
        } else if (err.name === 'NotReadableError' || err.message?.toLowerCase().includes('could not start video source')) {
          setHasError("CAMERA_BUSY");
          setErrorDetails("CAMERA DEVICE IS CURRENTLY IN USE BY ANOTHER APP/TAB OR BLOCKED BY OS PRIVACY CONTROLS. CLOSE OTHER CAMERA APPS (ZOOM/TEAMS/BROWSER TABS), THEN RETRY INITIALIZATION.");
          setStatus("DEVICE_LOCKED");
          onLog("CAMERA_IN_USE: RELEASE_DEVICE");
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
      setStatus("SCANNING");
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
        <div className="absolute top-4 sm:top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-fade-in px-3 sm:px-4 py-1 border border-[var(--bio-green)] bg-black/70 max-w-[90%]">
          <span className="font-orbitron text-[10px] sm:text-[12px] lg:text-[14px] tracking-[0.1em] sm:tracking-[0.16em] uppercase text-[var(--bio-green-soft)] text-center leading-snug block">GROUP BIOMETRIC READY</span>
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
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-30 flex flex-col items-end gap-1.5 sm:gap-2">
          <div className="flex items-center gap-2 bg-black/50 px-2.5 sm:px-3 py-1 border border-red-500/20 backdrop-blur-sm">
            <div className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse" />
            <span className="text-red-500 font-black text-[7px] sm:text-[8px] tracking-[0.2em] sm:tracking-[0.3em]">REC_ACTIVE</span>
          </div>
          <div className="hidden sm:block text-cyan-500 font-black text-[7px] tracking-[0.16em] bg-black/50 px-2 py-0.5 border-r border-cyan-500/30">ARRAY_01_FEED</div>
        </div>
      )}

      {!hasError && (
        <div className="absolute bottom-5 sm:bottom-7 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-[92vw] max-w-[min(560px,calc(100vw-24px))] flex flex-col items-center gap-2">
          <div className="w-full px-4 sm:px-6 py-2 sm:py-2.5 border border-[var(--grid-line)] bg-black/85">
            <div className="font-orbitron text-[clamp(12px,2.3vw,24px)] leading-tight uppercase tracking-[0.06em] sm:tracking-[0.1em] text-[var(--ui-primary-soft)] text-center break-words">
              {getDisplayStatus()}
            </div>
          </div>

          {holdProgress > 0 && !isLocked && (
            <div className="w-full border border-white/10 bg-black/70 px-3 sm:px-4 py-2">
              <div className="flex justify-between text-[7px] sm:text-[8px] font-black text-white/60 tracking-[0.18em] sm:tracking-[0.24em] uppercase mb-1">
                <span className="animate-pulse">STABILIZING_SYNC</span>
                <span className="text-purple-400">{Math.round(holdProgress)}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 border border-white/10 p-[1px]">
                <div className="h-full bg-gradient-to-r from-purple-600 via-purple-300 to-cyan-400 shadow-[0_0_10px_#bc6ff1] transition-all duration-75" style={{ width: `${holdProgress}%` }} />
              </div>
            </div>
          )}
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
