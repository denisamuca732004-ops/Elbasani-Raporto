'use client';
/** Take a photo with the phone camera or choose one from the gallery. */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useI18n } from '@/i18n';
import Icon from './Icon';

/** Big phone photos are made smaller before upload (faster on mobile data, smaller offline storage). */
async function shrinkImage(file: File, maxSize = 2048, quality = 0.85): Promise<Blob> {
  if (file.size < 600 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file; // the server checks and re-encodes anyway
  }
}

export default function PhotoInput({ value, onChange, required, error, maxBytes, idPrefix = 'photo' }: {
  value: Blob | null; onChange: (photo: Blob | null) => void; required?: boolean; error?: string | null; maxBytes?: number; idPrefix?: string;
}) {
  const { t } = useI18n();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml') {
      setProblem(t('report.photoNotImage'));
      return;
    }
    setProblem(null);
    setBusy(true);
    const shrunk = await shrinkImage(file);
    setBusy(false);
    if (maxBytes && shrunk.size > maxBytes) {
      setProblem(t('report.photoTooLarge', { mb: Math.round(maxBytes / (1024 * 1024)) }));
      return;
    }
    onChange(shrunk);
  }
  const message = problem || error;

  if (preview) {
    return (
      <div className="photo-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob: URL) */}
        <img src={preview} alt={t('report.photoPreview')} />
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => cameraRef.current?.click()}><Icon name="camera" size={18} />{t('report.retake')}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>{t('report.removePhoto')}</button>
        </div>
        <input id={`${idPrefix}-camera`} ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        {message && <div className="field-error" role="alert"><Icon name="alert" size={14} />{message}</div>}
      </div>
    );
  }
  return (
    <div className={`photo-drop${message ? ' has-error' : ''}`}>
      <Icon name="camera" size={44} strokeWidth={1.4} />
      <p className="muted" style={{ margin: '8px 0 16px' }}>{required ? t('report.photoRequired') : t('report.photoOptional')}</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn" onClick={() => cameraRef.current?.click()} disabled={busy}><Icon name="camera" size={18} />{t('report.takePhoto')}</button>
        <button type="button" className="btn btn-outline" onClick={() => galleryRef.current?.click()} disabled={busy}>{t('report.choosePhoto')}</button>
      </div>
      {message && <div className="field-error" role="alert" style={{ justifyContent: 'center' }}><Icon name="alert" size={14} />{message}</div>}
      {busy && <p className="hint">{t('common.wait')}</p>}
      <p className="hint" style={{ marginTop: 14 }}>{t('report.photoPrivacy')}</p>
      <input id={`${idPrefix}-camera`} ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input id={`${idPrefix}-gallery`} ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
    </div>
  );
}
