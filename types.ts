
export interface CapturedPhoto {
  id: string;
  url: string; // local data url
  shareUrl?: string; // remote download link
  timestamp: string;
  status: 'uploading' | 'success' | 'error';
  metadata: {
    confidence: number;
    resolution: string;
  };
}

export interface RecognitionResult {
  peaceSignDetected: boolean;
  confidence: number;
}
