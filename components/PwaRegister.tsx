'use client';
/** Registers the service worker (installable app, works with a weak connection). Production only. */
import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* not critical */ });
  }, []);
  return null;
}
