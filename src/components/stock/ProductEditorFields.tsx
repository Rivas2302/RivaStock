import type { ReactNode, Ref } from 'react';
import { ImageUpload } from '../ImageUpload';
import NumberField from '../NumberField';

interface TextFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  wrapperClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  type?: 'text' | 'number';
  inputMode?: 'text' | 'numeric' | 'decimal';
  min?: number;
  step?: number;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  autoComplete?: string;
  ariaInvalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  children?: ReactNode;
}

export function ProductEditorTextField({
  label,
  value,
  onChange,
  wrapperClassName = 'block',
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300',
  inputClassName = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white',
  type = 'text',
  inputMode,
  min,
  step,
  required,
  readOnly,
  placeholder,
  autoComplete,
  ariaInvalid,
  inputRef,
  children,
}: TextFieldProps) {
  return (
    <label className={wrapperClassName}>
      <span className={labelClassName}>{label}</span>
      {type === 'number' ? (
        <NumberField
          ref={inputRef as Ref<HTMLInputElement>}
          inputMode={inputMode === 'numeric' ? 'numeric' : 'decimal'}
          integer={inputMode === 'numeric' || step === 1}
          min={min}
          step={step}
          required={required}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={ariaInvalid}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          inputMode={inputMode === 'numeric' || inputMode === 'decimal' ? inputMode : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={ariaInvalid}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        />
      )}
      {children}
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  wrapperClassName?: string;
  labelClassName?: string;
  selectClassName?: string;
  required?: boolean;
  selectRef?: Ref<HTMLSelectElement>;
  ariaInvalid?: boolean;
  helper?: ReactNode;
}

export function ProductEditorSelectField({
  label,
  value,
  onChange,
  children,
  wrapperClassName = 'block',
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300',
  selectClassName = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white',
  required,
  selectRef,
  ariaInvalid,
  helper,
}: SelectFieldProps) {
  return (
    <label className={wrapperClassName}>
      <span className={labelClassName}>{label}</span>
      <select
        ref={selectRef}
        value={value}
        required={required}
        aria-invalid={ariaInvalid}
        onChange={(event) => onChange(event.target.value)}
        className={selectClassName}
      >
        {children}
      </select>
      {helper}
    </label>
  );
}

interface TextareaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wrapperClassName?: string;
  labelClassName?: string;
  textareaClassName?: string;
  placeholder?: string;
  rows?: number;
}

export function ProductEditorTextareaField({
  label,
  value,
  onChange,
  wrapperClassName = 'block',
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300',
  textareaClassName = 'w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white',
  placeholder,
  rows = 3,
}: TextareaFieldProps) {
  return (
    <label className={wrapperClassName}>
      <span className={labelClassName}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={textareaClassName}
      />
    </label>
  );
}

interface ImageFieldProps {
  ownerUid: string;
  productId: string;
  currentImages: string[];
  onChange: (urls: string[]) => void;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  mobileControls?: boolean;
  allowReorder?: boolean;
  label?: string;
  wrapperClassName?: string;
  labelClassName?: string;
}

export function ProductEditorImageField({
  ownerUid,
  productId,
  currentImages,
  onChange,
  onUploadStart,
  onUploadEnd,
  mobileControls = false,
  allowReorder = false,
  label,
  wrapperClassName = 'block',
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300',
}: ImageFieldProps) {
  return (
    <div className={wrapperClassName}>
      {label && <span className={labelClassName}>{label}</span>}
      <ImageUpload
        ownerUid={ownerUid}
        productId={productId}
        currentImages={currentImages}
        onChange={onChange}
        onUploadStart={onUploadStart}
        onUploadEnd={onUploadEnd}
        mobileControls={mobileControls}
        allowReorder={allowReorder}
      />
    </div>
  );
}
