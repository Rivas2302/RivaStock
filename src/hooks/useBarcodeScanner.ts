import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { BarcodeCooldown, normalizeBarcode } from '../lib/barcode';
import { scanFeedback } from '../lib/sound';

export type ScannerError =
  | 'denied'
  | 'notSupported'
  | 'noCamera'
  | 'inUse'
  | 'unknown';

export type ScannerStatus = 'idle' | 'requesting' | 'streaming' | 'error';

interface Options {
  videoElement: HTMLVideoElement | null;
  active: boolean;
  continuous: boolean;
  onScan: (code: string) => void;
  cooldownMs?: number;
  /** Increment to force a fresh camera attempt after fixing permissions */
  retryKey?: number;
}

interface State {
  status: ScannerStatus;
  error: ScannerError | null;
}

const FORMATS: BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

function classifyError(err: unknown): ScannerError {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = String((err as { name: string }).name);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError')   return 'noCamera';
    if (name === 'NotReadableError' || name === 'TrackStartError')     return 'inUse';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'notSupported';
  }
  return 'unknown';
}

export function useBarcodeScanner({
  videoElement,
  active,
  continuous,
  onScan,
  cooldownMs = 1500,
  retryKey = 0,
}: Options): State {
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [error, setError]   = useState<ScannerError | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const cooldownRef = useRef(new BarcodeCooldown(cooldownMs));
  const onScanRef   = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const stop = useCallback(() => {
    try { controlsRef.current?.stop(); } catch { /* no-op */ }
    controlsRef.current = null;
    cooldownRef.current.reset();
  }, []);

  useEffect(() => {
    if (!active || !videoElement) {
      stop();
      setStatus('idle');
      setError(null);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('notSupported');
      return;
    }

    let cancelled = false;
    setStatus('requesting');
    setError(null);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    // Use decodeFromConstraints so zxing handles the entire stream lifecycle:
    // getUserMedia → attachStreamToVideo → scan. This avoids the race condition
    // where manually setting srcObject + play() conflicts with zxing's own
    // playVideoOnLoadAsync() called inside decodeFromVideoElement().
    reader
      .decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width:     { ideal: 1920 },
            height:    { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        videoElement,
        (result, error, controls) => {
          if (cancelled) return;
          if (result) {
            const code = normalizeBarcode(result.getText());
            if (code && cooldownRef.current.accept(code)) {
              scanFeedback();
              onScanRef.current(code);
              if (!continuous) {
                try { controls.stop(); } catch { /* no-op */ }
                controlsRef.current = null;
                setStatus('idle');
              }
            }
          }
        },
      )
      .then((ctrls) => {
        if (cancelled) {
          try { ctrls.stop(); } catch { /* no-op */ }
          return;
        }
        controlsRef.current = ctrls;
        setStatus('streaming');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(classifyError(err));
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, videoElement, continuous, stop, retryKey]);

  return { status, error };
}
