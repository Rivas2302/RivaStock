import React, { useState, useRef } from 'react';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';

interface ImageUploadProps {
  userId: string;
  productId: string;
  onUpload: (url: string) => void;
  onUploadStart?: () => void;
  currentImageUrl?: string;
}

const compressImageToBase64 = (file: File, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/webp', quality);
        resolve(dataUrl);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const ImageUpload: React.FC<ImageUploadProps> = ({ userId, productId, onUpload, onUploadStart, currentImageUrl }) => {
  const [preview, setPreview] = useState<string | undefined>(currentImageUrl);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file: File) => {
    console.log('Selected file:', file?.name, 'Size:', file?.size, 'Type:', file?.type);
    
    if (!file) {
      setError('No se seleccionó ningún archivo.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Solo se permiten imágenes (jpg, png, webp).');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);
    if (onUploadStart) onUploadStart();
    setPreview(URL.createObjectURL(file));

    try {
      console.log('Starting image compression...');
      // Simulate progress for UX
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 100);

      const base64Image = await compressImageToBase64(file);
      console.log('Compression complete. Base64 length:', base64Image.length);
      
      clearInterval(progressInterval);
      setProgress(100);
      
      // Small delay so user sees 100%
      setTimeout(() => {
        onUpload(base64Image);
        setUploading(false);
      }, 300);

    } catch (err: any) {
      console.error('Error compressing image:', err);
      setError(`Error al procesar la imagen: ${err.message}`);
      onUpload('');
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div 
        className="border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-500 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileChange(e.dataTransfer.files[0]);
          }
        }}
      >
        {preview ? (
          <div className="relative w-full h-32">
            <img src={preview} alt="Preview" className="w-full h-full object-cover rounded" referrerPolicy="no-referrer" />
            {uploading && (
              <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center rounded">
                <Loader2 className="animate-spin text-white mb-2" />
                <span className="text-white text-sm font-medium">Subiendo... {progress}%</span>
              </div>
            )}
            <button 
              className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-1 hover:bg-rose-600 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(undefined);
                onUpload('');
              }}
              disabled={uploading}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="text-center py-4">
            <Upload className="mx-auto text-slate-400" />
            <p className="text-sm text-slate-500 mt-2">Arrastra o haz clic para subir</p>
          </div>
        )}
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/jpeg,image/png,image/webp" 
          onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
        />
      </div>
      {error && <p className="text-rose-500 text-sm font-medium">{error}</p>}
    </div>
  );
};
