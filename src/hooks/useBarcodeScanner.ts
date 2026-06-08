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
  hasTorch: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
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

// Labels we want to AVOID — these are auxiliary lenses that focus poorly for barcodes.
// Multi-camera phones (specially Samsung) expose ultra-wide, telephoto, macro, depth, etc.
// The MAIN rear camera typically has no qualifier or says "back camera" / "0".
const AUX_CAMERA_PATTERNS = [
  /ultra/i,
  /tele/i,
  /macro/i,
  /depth/i,
  /front/i,
  /selfie/i,
  /user/i,
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

/**
 * Pick the best rear-facing camera deviceId.
 * On multi-camera phones (Samsung, Pixel, iPhone) the OS exposes ultra-wide,
 * telephoto, macro etc. as separate cameras. facingMode: 'environment' may
 * pick any of them — usually the ultra-wide, which can't focus on close
 * objects like barcodes. We need to explicitly pick the MAIN rear camera.
 *
 * Strategy:
 * 1. Get permission with a minimal stream (so labels become populated).
 * 2. Enumerate devices, filter videoinput.
 * 3. Score each by: rear-facing > not an auxiliary lens > first in list.
 * 4. Return the best deviceId, or null to fall back to facingMode.
 */
async function pickRearCameraId(): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;

  try {
    // Trigger permission first so labels become readable
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    // Release it immediately — we just needed permission for labels
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    if (videoInputs.length === 0) return null;
    if (videoInputs.length === 1) return videoInputs[0].deviceId;

    // Filter out front/user cameras and auxiliary rear lenses
    const rearMain = videoInputs.filter(d => {
      const label = d.label.toLowerCase();
      // Skip explicit front cameras
      if (/front|user|selfie/i.test(label)) return false;
      // Skip auxiliary rear lenses
      for (const pattern of AUX_CAMERA_PATTERNS) {
        if (pattern.test(label)) return false;
      }
      return true;
    });

    if (rearMain.length > 0) return rearMain[0].deviceId;

    // No good match — try anything that mentions "back" or "rear"
    const anyRear = videoInputs.find(d => /back|rear|environment/i.test(d.label));
    if (anyRear) return anyRear.deviceId;

    // Last resort: first device (browser usually orders rear first)
    return videoInputs[0].deviceId;
  } catch {
    return null;
  }
}

export function useBarcodeScanner({
  videoElement,
  active,
  continuous,
  onScan,
  cooldownMs = 1500,
  retryKey = 0,
}: Options): State {
  const [status,   setStatus]   = useState<ScannerStatus>('idle');
  const [error,    setError]    = useState<ScannerError | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn,  setTorchOn]  = useState(false);

  const controlsRef = useRef<IScannerControls | null>(null);
  const torchOnRef  = useRef(false);
  const cooldownRef = useRef(new BarcodeCooldown(cooldownMs));
  const onScanRef   = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const stop = useCallback(() => {
    try { controlsRef.current?.stop(); } catch { /* no-op */ }
    controlsRef.current = null;
    cooldownRef.current.reset();
  }, []);

  const toggleTorch = useCallback(() => {
    if (!controlsRef.current) return;
    torchOnRef.current = !torchOnRef.current;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controlsRef.current as any).switchTorch?.(torchOnRef.current);
      setTorchOn(torchOnRef.current);
    } catch { /* not supported — ignore */ }
  }, []);

  useEffect(() => {
    if (!active || !videoElement) {
      stop();
      setStatus('idle');
      setError(null);
      setHasTorch(false);
      setTorchOn(false);
      torchOnRef.current = false;
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
    setHasTorch(false);
    setTorchOn(false);
    torchOnRef.current = false;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    (async () => {
      // 1. Pick the best rear camera (avoids ultra-wide / macro / front on multi-cam phones)
      const deviceId = await pickRearCameraId();
      if (cancelled) return;

      // 2. Build constraints — prefer exact deviceId, fall back to facingMode
      const videoConstraints: MediaTrackConstraints = deviceId
        ? {
            deviceId: { exact: deviceId },
            // Push for the highest resolution the device offers.
            // Browsers will downgrade gracefully if unsupported.
            width:     { ideal: 3840 },
            height:    { ideal: 2160 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: 'environment' },
            width:     { ideal: 3840 },
            height:    { ideal: 2160 },
            frameRate: { ideal: 30 },
          };

      reader
        .decodeFromConstraints(
          { video: videoConstraints, audio: false },
          videoElement,
          (result, _err, controls) => {
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
        .then(async (ctrls) => {
          if (cancelled) {
            try { ctrls.stop(); } catch { /* no-op */ }
            return;
          }
          controlsRef.current = ctrls;
          setStatus('streaming');

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = ctrls as any;

          // Apply post-stream optimizations one by one; each is best-effort.

          // a) Continuous autofocus
          try {
            await c.streamVideoConstraintsApply({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraints],
            });
          } catch { /* ignore */ }

          // b) Auto exposure + auto white balance for adapting lighting
          try {
            await c.streamVideoConstraintsApply({
              advanced: [
                { exposureMode: 'continuous' } as MediaTrackConstraints,
                { whiteBalanceMode: 'continuous' } as MediaTrackConstraints,
              ],
            });
          } catch { /* ignore */ }

          // c) Zoom — barcodes are small; 2-3× makes them fill the frame
          try {
            const caps = c.streamVideoCapabilitiesGet?.() as
              | (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } })
              | undefined;
            if (caps?.zoom) {
              const zoom = Math.min(2.5, caps.zoom.max);
              await c.streamVideoConstraintsApply({
                advanced: [{ zoom } as MediaTrackConstraints],
              });
            }
          } catch { /* ignore */ }

          // d) Torch detection (zxing adds switchTorch when the track supports it)
          if (typeof c.switchTorch === 'function') {
            setHasTorch(true);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus('error');
          setError(classifyError(err));
        });
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, videoElement, continuous, stop, retryKey]);

  return { status, error, hasTorch, torchOn, toggleTorch };
}
