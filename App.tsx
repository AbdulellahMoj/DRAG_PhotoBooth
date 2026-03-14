
import React, { useState, useMemo, useCallback } from 'react';
import CameraView from './components/CameraView';
import { CapturedPhoto } from './types';

const App: React.FC = () => {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(["SYSTEM_STABLE", "AUTH_LAYER_READY"]);
  const [layoutMode, setLayoutMode] = useState<'landscape' | 'portrait'>('landscape');

  const selectedPhoto = useMemo(() => 
    photos.find(p => p.id === selectedPhotoId) || (photos.length > 0 ? photos[0] : null)
  , [photos, selectedPhotoId]);

  const writeMonitorLog = useCallback((message: string) => {
    if (!import.meta.env.DEV) return;

    void fetch('/__monitor-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        message,
      }),
      keepalive: true,
    }).catch(() => {
      // Silent fail: monitor logging should never break the UI.
    });
  }, []);

  // useCallback — prevents stale onLog closure inside CameraView's MediaPipe setup effect
  const addLog = useCallback((msg: string) => {
    writeMonitorLog(msg);
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));
  }, [writeMonitorLog]);

  const uploadToShare = useCallback(async (id: string, base64: string) => {
    addLog(`INIT_UPLINK_${id}`);
    try {
      const base64Data = base64.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      const formData = new FormData();
      formData.append('file', blob, `${id}.png`);
      
      // Using tmpfiles.org - note: some environments might have CORS issues with local dev.
      // We handle failure gracefully by marking the state.
      const response = await fetch('https://tmpfiles.org/api/v1/upload', { 
        method: 'POST', 
        body: formData 
      });
      
      if (!response.ok) throw new Error(`NETWORK_IO_ERROR`);

      const result = await response.json();
      
      if (result.status === "success" && result.data?.url) {
        // Convert the view URL to a direct download URL for tmpfiles
        const downloadUrl = result.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
        
        setPhotos(prev => prev.map(p => 
          p.id === id ? { ...p, shareUrl: downloadUrl, status: 'success' } : p
        ));
        addLog(`ASSET_${id}_SYNCED`);
      } else {
        throw new Error("API_REJECTED");
      }
    } catch (err) {
      console.error("Upload Error:", err);
      setPhotos(prev => prev.map(p => 
        p.id === id ? { ...p, status: 'error' } : p
      ));
      addLog(`ERROR: UPLINK_FAULT_${id}`);
    }
  }, [addLog]);

  // useCallback — stable reference passed to CameraView as onCapture prop
  const handleCapture = useCallback(async (url: string, _confidence?: number) => {
    const id = `NODE_${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    addLog(`MATCH_DETECTED: ${id}`);
    
    const newPhoto: CapturedPhoto = {
      id,
      url,
      timestamp: new Date().toISOString(),
      status: 'uploading',
      metadata: { confidence: 1.0, resolution: "1280x720" }
    };
    
    setPhotos(prev => [newPhoto, ...prev]);
    setSelectedPhotoId(id);
    uploadToShare(id, url);
  }, [uploadToShare]);

  const renderCaptureExport = (className = "") => (
    <div className={`nerv-panel p-[var(--panel-pad)] flex flex-col gap-3 sm:gap-4 min-h-[var(--side-panel-min-h)] ${className}`}>
      <h2 className="nerv-title text-[14px] sm:text-[16px] lg:text-[18px] tracking-[0.12em] sm:tracking-[0.2em]">CAPTURE EXPORT</h2>

      <div className="w-full flex items-center justify-center">
        <div className="w-full max-w-[220px] aspect-square border border-[var(--grid-line)] bg-black/40 flex items-center justify-center">
          {selectedPhoto?.status === 'success' && selectedPhoto.shareUrl ? (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(selectedPhoto.shareUrl)}`}
              className="w-[88%] h-[88%] bg-white p-2"
              alt="Capture Export QR"
            />
          ) : selectedPhoto?.status === 'uploading' ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-[var(--ui-primary-dim)] border-t-[var(--ui-primary)] rounded-full animate-spin" />
              <span className="telemetry-text uppercase tracking-[0.2em] text-[var(--ui-primary)]">Syncing</span>
            </div>
          ) : (
            <span className="telemetry-text uppercase tracking-[0.2em] text-[var(--ui-primary-dim)]">No Capture</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {selectedPhoto?.status === 'success' ? (
          <>
            <a
              href={selectedPhoto.shareUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full py-2 text-center uppercase tracking-[0.18em] sm:tracking-[0.25em] text-[10px] sm:text-[12px] border border-[var(--ui-primary)] text-[var(--ui-primary-soft)] hover:bg-[var(--ui-primary)]/15 transition-colors"
            >
              OPEN LINK
            </a>
            <button
              onClick={() => window.open(selectedPhoto.shareUrl, '_blank', 'noopener,noreferrer')}
              className="w-full py-2 uppercase tracking-[0.18em] sm:tracking-[0.25em] text-[10px] sm:text-[12px] border border-[var(--telemetry-cyan)] text-[var(--telemetry-cyan)] hover:bg-[var(--telemetry-cyan)]/10 transition-colors"
            >
              DOWNLOAD IMAGE
            </button>
            <div className="telemetry-text uppercase tracking-[0.14em] sm:tracking-[0.2em] text-[var(--ui-primary-dim)] text-[10px] sm:text-[12px] break-all">
              SESSION ID: {selectedPhoto.id}
            </div>
          </>
        ) : (
          <div className="telemetry-text uppercase tracking-[0.14em] sm:tracking-[0.2em] text-[var(--ui-primary-dim)] text-[10px] sm:text-[12px]">
            EXPORT STANDBY
          </div>
        )}
      </div>
    </div>
  );

  const renderTelemetry = (className = "") => (
    <div className={`nerv-panel p-[var(--panel-pad)] min-h-[var(--side-panel-min-h)] flex flex-col ${className}`}>
      <h2 className="nerv-title text-[14px] sm:text-[16px] lg:text-[18px] tracking-[0.12em] sm:tracking-[0.2em] mb-2 sm:mb-3">SYSTEM TELEMETRY</h2>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1">
        {log.map((entry, i) => (
          <div key={i} className={`telemetry-text text-[10px] sm:text-[12px] border-l pl-2 truncate ${i === 0 ? 'border-[var(--bio-green)] text-[var(--bio-green-soft)]' : 'border-[var(--grid-line)] text-[var(--ui-primary-soft)]/70'}`}>
            {entry}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--ui-primary-soft)]">
      <div className="h-full w-full p-[var(--shell-pad)] grid grid-rows-[auto_1fr] gap-[var(--shell-gap)]">
        <header className="nerv-panel px-[var(--panel-pad)] py-[var(--panel-pad)] grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 sm:gap-3 md:gap-4 items-center">
          <div className="flex items-center min-w-0 md:pr-4">
            <div className="flex flex-col gap-1 min-w-0">
              <h1 className="font-orbitron uppercase text-[14px] sm:text-[18px] tracking-[0.08em] sm:tracking-[0.16em] text-[var(--ui-primary-soft)] truncate">DRAG photo booth</h1>
              <p className="nerv-subtitle text-[10px] sm:text-[12px] tracking-[0.12em] sm:tracking-[0.2em] truncate">MODEL: FACEMESH_v0.4</p>
            </div>
          </div>
          <div className="text-left md:text-right telemetry-text uppercase tracking-[0.12em] sm:tracking-[0.2em] text-[var(--telemetry-cyan)] text-[10px] sm:text-[12px] leading-relaxed md:justify-self-end">
            <div>SYSTEM LINK: ONLINE</div>
            <div className="text-[var(--ui-primary-dim)]">PIPELINE: LIVE ANALYSIS</div>
          </div>

          <button
            onClick={() => setLayoutMode((prev) => (prev === 'landscape' ? 'portrait' : 'landscape'))}
            className="w-full md:w-auto px-3 sm:px-4 py-2 border border-[var(--grid-line)] text-[var(--ui-primary-soft)] font-orbitron uppercase text-[10px] sm:text-[11px] tracking-[0.12em] sm:tracking-[0.18em] hover:bg-[var(--ui-primary)]/15 transition-colors md:justify-self-end"
          >
            {layoutMode === 'landscape' ? 'Vertical Mode' : 'Landscape Mode'}
          </button>
        </header>

        {layoutMode === 'landscape' ? (
          <main className="min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[var(--shell-gap)] overflow-auto">
            <section className="xl:col-span-8 min-h-0 grid grid-rows-[minmax(0,1fr)_auto] gap-[var(--shell-gap)]">
              <div className="nerv-panel relative min-h-[var(--camera-min-h)] overflow-hidden">
                <div className="absolute top-2 sm:top-3 left-3 sm:left-4 z-20 nerv-subtitle text-[10px] sm:text-[12px]">CAMERA ANALYSIS</div>
                <CameraView onCapture={handleCapture} onLog={addLog} />
              </div>

              <div className="nerv-panel p-[var(--panel-pad)] flex items-center gap-2 sm:gap-3 min-h-[100px] sm:min-h-[118px]">
                <div className="hidden lg:block telemetry-text text-[var(--ui-primary-dim)] [writing-mode:vertical-lr] rotate-180 tracking-[0.2em] uppercase text-[10px]">
                  SESSION ROLL
                </div>
                <div className="flex-1 flex gap-2 sm:gap-3 overflow-x-auto scrollbar-hide py-1 items-center min-w-0">
                  {photos.length === 0 ? (
                    <div className="w-full text-center telemetry-text uppercase tracking-[0.16em] sm:tracking-[0.25em] text-[var(--ui-primary-dim)] text-[10px] sm:text-[12px]">
                      Awaiting Biometric Trigger
                    </div>
                  ) : (
                    photos.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedPhotoId(p.id)}
                        className={`relative flex-shrink-0 w-28 h-16 sm:w-36 sm:h-20 overflow-hidden cursor-pointer border transition-all ${selectedPhotoId === p.id ? 'border-[var(--ui-primary)] shadow-[0_0_16px_rgba(188,111,241,0.45)]' : 'border-[var(--grid-line)] opacity-60 hover:opacity-100'}`}
                      >
                        <img src={p.url} className="w-full h-full object-cover grayscale brightness-75" />
                        {p.status === 'uploading' && <div className="absolute inset-0 bg-[var(--ui-primary)]/20 animate-pulse" />}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <aside className="xl:col-span-4 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 xl:grid-rows-[auto_1fr] gap-[var(--shell-gap)]">
              {renderCaptureExport("h-full")}
              {renderTelemetry("h-full")}
            </aside>
          </main>
        ) : (
          <main className="min-h-0 overflow-auto">
            <div className="w-full max-w-[var(--content-max-w)] mx-auto min-h-0 grid grid-rows-[minmax(0,1fr)_auto_auto] gap-[var(--shell-gap)]">
              <section className="nerv-panel relative overflow-hidden min-h-[max(48vh,var(--camera-min-h))]">
                <div className="absolute top-2 sm:top-3 left-3 sm:left-4 z-20 nerv-subtitle text-[10px] sm:text-[12px]">CAMERA ANALYSIS</div>
                <CameraView onCapture={handleCapture} onLog={addLog} />
              </section>

              <section className="max-w-[680px] w-full justify-self-center">
                {renderCaptureExport()}
              </section>

              <section className="min-h-[var(--side-panel-min-h)] max-w-[820px] w-full justify-self-center">
                {renderTelemetry()}
              </section>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default App;
