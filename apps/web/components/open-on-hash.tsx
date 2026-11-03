'use client';
import { useEffect } from 'react';

/** Öffnet ein eingeklapptes <details>, wenn die URL auf seine id zeigt (z. B. #chatgpt). */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el instanceof HTMLDetailsElement) { el.open = true; el.scrollIntoView({ block: 'start' }); }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
