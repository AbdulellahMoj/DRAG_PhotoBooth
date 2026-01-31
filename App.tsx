
import React, { useState, useMemo, useEffect } from 'react';
import CameraView from './components/CameraView';
import { CapturedPhoto } from './types';

const App: React.FC = () => {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(["SYSTEM_STABLE", "AUTH_LAYER_READY"]);

  const selectedPhoto = useMemo(() => 
    photos.find(p => p.id === selectedPhotoId) || (photos.length > 0 ? photos[0] : null)
  , [photos, selectedPhotoId]);

  const addLog = (msg: string) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));
  };

  const uploadToShare = async (id: string, base64: string) => {
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
  };

  const handleCapture = async (url: string) => {
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
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#010005] text-[#bc6ff1] font-mono overflow-hidden relative">
      
      {/* MINIMALIST STATUS HEADER */}
      <header className="z-[80] px-4 py-1.5 flex justify-between items-center bg-black border-b border-purple-500/20 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 flex items-center justify-center">
             <img 
               src="DRAG_LOGO.png" 
               alt="DRAG" 
               className="w-full h-full object-contain filter drop-shadow-[0_0_5px_#bc6ff1]" 
               onError={(e) => {
                 (e.target as HTMLImageElement).style.opacity = '0.3';
                 addLog("LOGO_LINK_MISSING");
               }}
             />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[11px] font-black tracking-[0.2em] text-white leading-tight uppercase">DRAG_PHOTO_BOOTH</h1>
            <p className="text-[7px] font-bold text-cyan-400/80 uppercase tracking-widest">UPLINK_STATION_ALPHA</p>
          </div>
        </div>
        
        <div className="flex gap-4">
           <div className="flex flex-col items-end justify-center">
             <span className="text-[6px] font-black text-purple-600/50 uppercase tracking-widest">Status</span>
             <span className="text-[10px] font-black text-white leading-none">CONNECTED</span>
           </div>
           <div className="flex flex-col items-end justify-center border-l border-white/5 pl-4">
             <span className="text-[6px] font-black text-purple-600/50 uppercase tracking-widest">Auth_Key</span>
             <span className="text-[10px] font-black text-white leading-none">V_PEACE_02</span>
           </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="flex-1 flex overflow-hidden p-3 gap-3">
        
        {/* VIEWPORT (LEFT) */}
        <div className="flex-[4] flex flex-col gap-3 min-w-0">
          <div className="flex-1 relative group overflow-hidden cyber-clip-main border border-white/5 shadow-inner">
            <CameraView onCapture={handleCapture} onLog={addLog} />
            
            {/* HUD OVERLAYS */}
            <div className="absolute inset-0 pointer-events-none border border-white/5" />
            <div className="absolute top-4 left-4 flex flex-col gap-1">
               <div className="text-[8px] font-black text-purple-400 bg-black/40 px-2 py-0.5">X:12.8 // Y:07.2</div>
               <div className="text-[8px] font-black text-white/20 px-2">SAT_SYNC: VALID</div>
            </div>
          </div>
          
          {/* HISTORY TRAY */}
          <div className="h-28 bg-black/40 border border-purple-500/10 p-3 flex items-center gap-3 relative overflow-hidden">
            <div className="flex-shrink-0 flex flex-col items-center">
              <span className="text-[6px] font-black text-purple-900 uppercase tracking-[1em] [writing-mode:vertical-lr] rotate-180">SESSION_ROLL</span>
            </div>
            <div className="flex-1 flex gap-3 overflow-x-auto scrollbar-hide py-1 items-center">
              {photos.length === 0 ? (
                <div className="w-full text-center text-[8px] opacity-10 tracking-[2em] font-black uppercase italic">Awaiting_Biometric_Trigger</div>
              ) : (
                photos.map(p => (
                  <div 
                    key={p.id} 
                    onClick={() => setSelectedPhotoId(p.id)}
                    className={`flex-shrink-0 w-36 h-20 bg-black cyber-clip-main border transition-all cursor-pointer overflow-hidden relative group/item ${selectedPhotoId === p.id ? 'border-purple-400 scale-105 shadow-[0_0_15px_rgba(188,111,241,0.3)] z-10' : 'border-white/5 opacity-30 hover:opacity-100'}`}
                  >
                    <img src={p.url} className="w-full h-full object-cover grayscale brightness-50 group-hover/item:grayscale-0 group-hover/item:brightness-100 transition-all" />
                    {p.status === 'uploading' && <div className="absolute inset-0 bg-purple-600/20 animate-pulse" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* DATA SIDEBAR (RIGHT) */}
        <aside className="flex-1 flex flex-col gap-3 z-[90] min-w-[280px]">
          {/* SHARE CARD */}
          <div className="bg-black/80 border border-purple-500/20 p-5 flex flex-col gap-5 flex-[2] relative overflow-hidden flex items-center justify-center">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-purple-600/5 rounded-full blur-3xl" />
            <div className="absolute top-3 left-3 text-[7px] font-black text-purple-900 tracking-widest uppercase italic">Distribution_Logic</div>
            
            <div className="w-full flex flex-col items-center gap-6">
              {/* QR CONTAINER */}
              <div className="relative w-full max-w-[180px] aspect-square flex items-center justify-center">
                {/* Background Frame */}
                <div className="absolute inset-0 border border-white/5 shadow-inner" />
                <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-purple-500/50" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-purple-500/50" />

                {/* QR Display State Machine */}
                {selectedPhoto ? (
                  <>
                    {selectedPhoto.status === 'success' && selectedPhoto.shareUrl ? (
                      <div className="w-full h-full p-2 bg-white animate-[fade-in_0.5s_ease-out]">
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(selectedPhoto.shareUrl)}`} 
                          className="w-full h-full grayscale brightness-75 hover:brightness-100 hover:grayscale-0 transition-all cursor-crosshair"
                          alt="Asset QR"
                        />
                      </div>
                    ) : selectedPhoto.status === 'uploading' ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                        <span className="text-[8px] font-black text-purple-400 tracking-[0.4em] animate-pulse">SYNCING_TO_CLOUD</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="text-red-500 text-xl font-black">!</div>
                        <button 
                          onClick={() => uploadToShare(selectedPhoto.id, selectedPhoto.url)}
                          className="text-[8px] font-black text-red-500 border border-red-500/30 px-4 py-2 hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest"
                        >
                          Retry_Uplink
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 opacity-10">
                    <div className="w-10 h-10 border border-white/20 rotate-45" />
                    <span className="text-[7px] font-black uppercase tracking-[0.5em]">No_Asset</span>
                  </div>
                )}
              </div>

              {/* ACTION AREA */}
              <div className="w-full space-y-4">
                {selectedPhoto?.status === 'success' ? (
                  <div className="space-y-3">
                    <a href={selectedPhoto.shareUrl} target="_blank" rel="noreferrer" className="block w-full py-3 bg-purple-600/10 hover:bg-purple-600 text-white text-[9px] font-black tracking-[0.5em] text-center uppercase border border-purple-500/30 transition-all shadow-2xl cyber-clip-main">
                      OPEN_SECURE_GATE
                    </a>
                    <div className="flex justify-between items-center px-1">
                       <span className="text-[6px] text-purple-500 font-black uppercase">Node: {selectedPhoto.id}</span>
                       <span className="text-[6px] text-white/30 font-black uppercase tracking-tighter italic">Valid_2_Hours</span>
                    </div>
                  </div>
                ) : (
                  <div className="w-full py-4 border border-white/5 text-[8px] text-center opacity-10 uppercase font-black tracking-[0.8em] italic">Station_Idle</div>
                )}
              </div>
            </div>
          </div>

          {/* SYSTEM DATA FEED */}
          <div className="bg-black/60 border border-purple-500/10 p-4 flex flex-col gap-2 relative h-40">
            <h4 className="text-[7px] font-black tracking-[0.3em] text-white/40 flex items-center gap-2">
              <span className="w-1 h-1 bg-purple-500 rotate-45" />
              SYSTEM_MONITOR
            </h4>
            <div className="flex-1 overflow-hidden space-y-1 font-mono text-[7px] text-purple-300/20">
              {log.map((entry, i) => (
                <div key={i} className={`flex gap-2 border-l border-white/5 pl-2 truncate ${i === 0 ? 'text-purple-100/40 border-purple-500' : ''}`}>
                  {entry}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default App;
