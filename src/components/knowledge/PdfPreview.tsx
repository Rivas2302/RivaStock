import { Loader2 } from 'lucide-react';

interface PdfPreviewProps {
  title: string;
  versionNumber: number;
  extractionMessage: string | null;
  signedUrl: string;
  signedError: string;
  onOpenPdf: () => void;
}

export default function PdfPreview({
  title,
  versionNumber,
  extractionMessage,
  signedUrl,
  signedError,
  onOpenPdf,
}: PdfPreviewProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] p-4">
        <h2 className="font-bold">PDF · v{versionNumber}</h2>
        {signedUrl && <>
          <button type="button" onClick={onOpenPdf} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold md:hidden">Abrir PDF</button>
          <button type="button" onClick={onOpenPdf} className="hidden rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold md:inline-flex">Abrir en pestaña nueva</button>
        </>}
      </div>
      {signedError && <p role="alert" className="p-4 text-sm text-rose-700 dark:text-rose-300">{signedError}</p>}
      {extractionMessage && <p className="border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-muted)]">{extractionMessage}</p>}
      {signedUrl
        ? <>
            <iframe key={signedUrl} title={`Vista previa de ${title}`} src={signedUrl} className="hidden h-[70dvh] w-full md:block"/>
            <p className="p-4 text-center text-sm text-[var(--ink-muted)] md:hidden">Abrí el PDF en una pestaña del navegador.</p>
          </>
        : !signedError && <div className="grid h-60 place-items-center"><Loader2 className="animate-spin text-[var(--brand)]"/></div>}
    </section>
  );
}
