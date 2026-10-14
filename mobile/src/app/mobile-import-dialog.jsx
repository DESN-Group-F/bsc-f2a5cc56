import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImportDialog } from '../shared/components/inventory/import-dialog.js';
import { native, saveFile } from '../platform/runtime.mjs';
import { downloadImportTemplate } from '../platform/template-download.mjs';

const sources = import.meta.glob('../../public/templates/*.csv', { query: '?raw', import: 'default', eager: true });
const templates = Object.fromEntries(Object.entries(sources).map(([path, content]) => [`/templates/${path.split('/').at(-1)}`, content]));

export function MobileImportDialog(props) {
  const [notice, setNotice] = useState(null), pending = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function capture(event) {
    const anchor = event.target.closest?.('a[href]'), path = anchor?.getAttribute('href');
    if (!Object.hasOwn(templates, path)) return;
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setNotice({ text: native ? 'Preparing the template for device save or share…' : 'Preparing the template download…' });
    try {
      await downloadImportTemplate(path, templates[path], saveFile);
      if (live.current) setNotice({ text: native ? 'Template prepared. Device save or share controls completed.' : 'Template download requested.' });
    } catch (error) {
      if (live.current) setNotice({ error: true, text: `Template download did not complete. ${error.message || 'Try the template link again.'}` });
    } finally { pending.current = false; }
  }
  return <div onClickCapture={capture}><ImportDialog {...props}/>{notice && createPortal(<div className="phone-template-status" role={notice.error ? 'alert' : 'status'}>{notice.text}</div>, document.body)}</div>;
}
