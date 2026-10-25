import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Callout, CALLOUT_LABELS, type CalloutVariant } from './extensions/Callout';
import { KbImage } from './extensions/KbImage';
import { applyImageSources, collectAssetPaths } from '../../../lib/knowledge/editorContent';
import { registerAsset } from '../../../lib/knowledge/api';
import { removePaths, signedUrl, signedUrls, uploadAsset } from '../../../lib/knowledge/storage';
import { showToast } from '../../../lib/toast';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface KnowledgeEditorProps {
  initialContent: JSONContent;
  documentId: string;
  ownerUid: string;
  editable?: boolean;
  onChange(doc: JSONContent): void;
}

interface ToolbarButtonProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}

function ToolbarButton({ label, pressed = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="kb-editor-tool"
    >
      {children}
    </button>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo subir la imagen.';
}

function imageFilesFrom(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith('image/'));
}

function ImageUploadInput({
  inputRef,
  disabled,
  onFiles,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onFiles(files: File[]): void;
}) {
  return (
    <>
      <ToolbarButton label="Imagen" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={16} aria-hidden="true" />
      </ToolbarButton>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Elegir una imagen"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onFiles(files);
        }}
      />
    </>
  );
}

export function KnowledgeEditor({
  initialContent,
  documentId,
  ownerUid,
  editable = true,
  onChange,
}: KnowledgeEditorProps) {
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const latestPropsRef = useRef({ initialContent, documentId, ownerUid, onChange, editable });
  const isHydratingRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);

  latestPropsRef.current = { initialContent, documentId, ownerUid, onChange, editable };

  const insertImages = useCallback(async (files: File[], dropPosition?: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !latestPropsRef.current.editable || !files.length) return;

    let insertAt = dropPosition;
    if (insertAt === undefined) {
      const { from, to } = currentEditor.state.selection;
      insertAt = from;
      if (to > from) currentEditor.chain().focus().deleteSelection().run();
    }

    setUploadCount((count) => count + files.length);
    for (const source of files) {
      if (!ACCEPTED_IMAGE_TYPES.has(source.type)) {
        showToast('Usá imágenes PNG, JPEG o WebP.', 'error');
        setUploadCount((count) => Math.max(0, count - 1));
        continue;
      }
      if (source.size < 1 || source.size > MAX_IMAGE_BYTES) {
        showToast('La imagen debe pesar hasta 10 MB.', 'error');
        setUploadCount((count) => Math.max(0, count - 1));
        continue;
      }

      let uploadedPath: string | null = null;
      let registered = false;
      try {
        const uploaded = await uploadAsset(latestPropsRef.current.ownerUid, latestPropsRef.current.documentId, source);
        uploadedPath = uploaded.path;
        await registerAsset(latestPropsRef.current.documentId, uploaded.path, uploaded.mimeType, uploaded.file.size);
        registered = true;
        const src = await signedUrl(uploaded.path, 3600);
        const name = source.name.replace(/\.[^.]+$/, '').trim();
        const image = { type: 'image', attrs: { src, assetPath: uploaded.path, alt: name || 'Imagen' } };
        currentEditor.chain().focus().insertContentAt(insertAt as number, image).run();
        insertAt += 1;
      } catch (error) {
        if (uploadedPath && !registered) {
          try {
            await removePaths([uploadedPath]);
          } catch {
            // A storage cleanup failure must not hide the original upload error.
          }
        }
        showToast(errorMessage(error), 'error');
      } finally {
        setUploadCount((count) => Math.max(0, count - 1));
      }
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      KbImage,
      TableKit.configure({ table: { resizable: false } }),
      Callout,
      Placeholder.configure({ placeholder: 'Escribí el título o pegá tus notas…' }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable,
    onCreate: ({ editor: createdEditor }) => { editorRef.current = createdEditor; },
    onDestroy: () => { editorRef.current = null; },
    onUpdate: ({ editor: updatedEditor }) => {
      if (!isHydratingRef.current) latestPropsRef.current.onChange(updatedEditor.getJSON());
    },
    editorProps: {
      attributes: {
        class: 'kb-prose kb-editor-surface focus:outline-none',
        'aria-label': 'Contenido del documento',
      },
      handlePaste: (_view, event) => {
        if (!latestPropsRef.current.editable) return false;
        const files = imageFilesFrom(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      handleDrop: (view, event) => {
        if (!latestPropsRef.current.editable) return false;
        const files = imageFilesFrom(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(files, position);
        return true;
      },
    },
  }, []);

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return undefined;
    let cancelled = false;
    isHydratingRef.current = true;
    setReady(false);
    const content = latestPropsRef.current.initialContent;
    const paths = collectAssetPaths(content);

    void signedUrls(paths, 3600)
      .then((urlByPath) => {
        if (cancelled) return;
        editor.commands.setContent(applyImageSources(content, urlByPath));
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        showToast(`No se pudieron cargar algunas imágenes: ${errorMessage(error)}`, 'error');
        editor.commands.setContent(applyImageSources(content, {}));
        setReady(true);
      })
      .finally(() => {
        if (!cancelled) isHydratingRef.current = false;
      });

    return () => { cancelled = true; };
  }, [editor, documentId]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? ({
      paragraph: current.isActive('paragraph'),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      link: current.isActive('link'),
      table: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }) : null,
  });

  const promptForLink = () => {
    if (!editor) return;
    const value = window.prompt('Ingresá un enlace seguro (https:// o http://):');
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      showToast('Ingresá una URL válida con http:// o https://.', 'error');
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      showToast('Solo se permiten enlaces http:// y https://.', 'error');
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      editor.chain().focus().insertContent({
        type: 'text',
        text: value.trim(),
        marks: [{ type: 'link', attrs: { href: url.toString() } }],
      }).run();
    } else {
      editor.chain().focus().setLink({ href: url.toString() }).run();
    }
  };

  if (!editor || !ready) {
    return (
      <div className="kb-editor-loading" role="status" aria-label="Cargando editor">
        <div className="kb-editor-loading-toolbar" />
        <div className="kb-editor-loading-line kb-editor-loading-line-wide" />
        <div className="kb-editor-loading-line" />
        <div className="kb-editor-loading-line kb-editor-loading-line-short" />
      </div>
    );
  }

  const command = (run: () => void) => () => run();
  const buttonDisabled = !editable;

  return (
    <div className="kb-editor">
      {editable && (
        <div className="kb-editor-toolbar" role="toolbar" aria-label="Formato del documento">
          <div className="kb-editor-tool-group">
            <ToolbarButton label="Deshacer" disabled={buttonDisabled || !active?.canUndo} onClick={command(() => editor.chain().focus().undo().run())}><Undo2 size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Rehacer" disabled={buttonDisabled || !active?.canRedo} onClick={command(() => editor.chain().focus().redo().run())}><Redo2 size={16} aria-hidden="true" /></ToolbarButton>
          </div>
          <div className="kb-editor-tool-group">
            <ToolbarButton label="Párrafo" pressed={active?.paragraph} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().setParagraph().run())}><Pilcrow size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Título 1" pressed={active?.heading1} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}><Heading1 size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Título 2" pressed={active?.heading2} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}><Heading2 size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Título 3" pressed={active?.heading3} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}><Heading3 size={16} aria-hidden="true" /></ToolbarButton>
          </div>
          <div className="kb-editor-tool-group">
            <ToolbarButton label="Negrita" pressed={active?.bold} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleBold().run())}><Bold size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Cursiva" pressed={active?.italic} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleItalic().run())}><Italic size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Tachado" pressed={active?.strike} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleStrike().run())}><Strikethrough size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Código" pressed={active?.code} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleCode().run())}><Code2 size={16} aria-hidden="true" /></ToolbarButton>
          </div>
          <div className="kb-editor-tool-group">
            <ToolbarButton label="Lista con viñetas" pressed={active?.bulletList} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleBulletList().run())}><List size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Lista numerada" pressed={active?.orderedList} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleOrderedList().run())}><ListOrdered size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Cita" pressed={active?.blockquote} disabled={buttonDisabled} onClick={command(() => editor.chain().focus().toggleBlockquote().run())}><Quote size={16} aria-hidden="true" /></ToolbarButton>
            <label className="kb-editor-select-wrap">
              <span className="sr-only">Insertar aviso</span>
              <select
                aria-label="Insertar aviso"
                className="kb-editor-select"
                defaultValue=""
                disabled={buttonDisabled}
                onChange={(event) => {
                  const variant = event.currentTarget.value as CalloutVariant;
                  if (variant) editor.chain().focus().setCallout(variant).run();
                  event.currentTarget.value = '';
                }}
              >
                <option value="" disabled>Avisos</option>
                {(Object.keys(CALLOUT_LABELS) as CalloutVariant[]).map((variant) => (
                  <option key={variant} value={variant}>{CALLOUT_LABELS[variant]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="kb-editor-tool-group">
            <ToolbarButton label="Insertar tabla 3 por 3" disabled={buttonDisabled} onClick={command(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}><Table2 size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Agregar fila debajo" disabled={buttonDisabled || !active?.table} onClick={command(() => editor.chain().focus().addRowAfter().run())}><Rows3 size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Eliminar fila" disabled={buttonDisabled || !active?.table} onClick={command(() => editor.chain().focus().deleteRow().run())}><Minus size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Agregar columna a la derecha" disabled={buttonDisabled || !active?.table} onClick={command(() => editor.chain().focus().addColumnAfter().run())}><Plus size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Eliminar columna" disabled={buttonDisabled || !active?.table} onClick={command(() => editor.chain().focus().deleteColumn().run())}><X size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Eliminar tabla" disabled={buttonDisabled || !active?.table} onClick={command(() => editor.chain().focus().deleteTable().run())}><Trash2 size={16} aria-hidden="true" /></ToolbarButton>
          </div>
          <div className="kb-editor-tool-group">
            <ImageUploadInput inputRef={imageInputRef} disabled={buttonDisabled} onFiles={(files) => { void insertImages(files); }} />
            <ToolbarButton label="Línea divisoria" disabled={buttonDisabled} onClick={command(() => editor.chain().focus().setHorizontalRule().run())}><Minus size={16} aria-hidden="true" /></ToolbarButton>
            <ToolbarButton label="Enlace" pressed={active?.link} disabled={buttonDisabled} onClick={promptForLink}><Link2 size={16} aria-hidden="true" /></ToolbarButton>
          </div>
        </div>
      )}
      {uploadCount > 0 && (
        <div className="kb-editor-upload-status" role="status" aria-live="polite">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          Subiendo imagen{uploadCount > 1 ? 'es' : ''}…
        </div>
      )}
      <EditorContent editor={editor} className="kb-editor-content" />
    </div>
  );
}

export default KnowledgeEditor;
