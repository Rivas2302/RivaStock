import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface OcrWorker {
  recognize(image: Uint8Array): Promise<string>;
  terminate(): Promise<void>;
}

export type OcrWorkerFactory = (modelsDirectory: string, log: (message: string) => void) => Promise<OcrWorker>;

export async function createLocalOcrWorker(modelsDirectory: string, log: (message: string) => void): Promise<OcrWorker> {
  const cachePath = join(resolve(modelsDirectory), 'tesseract');
  await mkdir(cachePath, { recursive: true });
  const cachedFiles = await readdir(cachePath);
  if (!cachedFiles.includes('spa.traineddata')) {
    log('La primera ejecución de OCR descarga los datos de español y los guarda en la carpeta local de modelos.');
  }

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa', 1, {
    cachePath,
    cacheMethod: 'write',
  });
  return {
    async recognize(image) {
      const result = await worker.recognize(Buffer.from(image));
      return result.data.text;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

export function defaultModelsDirectory(): string {
  const userDirectory = process.env.USERPROFILE || process.env.HOME || '.';
  return resolve(process.env.AI_BRIDGE_MODELS_DIR?.trim() || join(userDirectory, '.rivastock-ai-bridge', 'models'));
}

