import { useState } from 'react';
import { api, useLoad } from '../api.js';
import { timeAgo } from '../labels.js';
import { Icon } from '../icons.jsx';

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Knowledge() {
  const { data: docs, error, reload } = useLoad(() => api('/knowledge'), []);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState(null);

  async function addDocument(body) {
    setBusy(true);
    setMessage(null);
    try {
      const doc = await api('/knowledge', { method: 'POST', body });
      setMessage({ kind: 'ok', text: `Added "${doc.name}". The agent can now answer from it (${doc.chunks} sections indexed).` });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function addFile(file) {
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '');
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) await addDocument({ name, pdfBase64: await fileAsBase64(file) });
    else await addDocument({ name, text: await file.text() });
  }

  async function addPasted(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await addDocument({ name: data.get('name'), text: data.get('text') });
    form.reset();
  }

  async function remove(doc) {
    if (!window.confirm(`Remove "${doc.name}"? The agent will stop using it.`)) return;
    await api(`/knowledge/${doc._id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Knowledge</h1>
          <p>The agent answers product, pricing and policy questions only from these documents. If something is not here, it promises to follow up instead of guessing.</p>
        </div>
      </header>

      <div className="grid-2 spaced">
        <label
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFile(e.dataTransfer.files[0]); }}
        >
          <Icon name="upload" size={28} />
          <strong>{busy ? 'Reading and indexing…' : 'Drop a brochure, price list or FAQ'}</strong>
          <span className="small">PDF, .txt or .md, or click to choose a file</span>
          <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" disabled={busy} onChange={(e) => { addFile(e.target.files[0]); e.target.value = ''; }} />
        </label>

        <form className="panel stack" onSubmit={addPasted}>
          <label className="field">Name<input name="name" required maxLength={120} placeholder="Refund policy" /></label>
          <label className="field">Text<textarea name="text" required rows={4} placeholder="Paste prices, features or answers to common questions" /></label>
          <div><button type="submit" className="btn" disabled={busy}>Add text</button></div>
        </form>
      </div>

      {message && <p className={`notice spaced ${message.kind}`}>{message.text}</p>}
      {error && <p className="notice error">{error.message}</p>}

      <section className="list" aria-label="Documents">
        {docs?.map((doc) => (
          <div key={doc._id} className="doc-row">
            <span className="doc-icon" aria-hidden="true"><Icon name="knowledge" /></span>
            <div>
              <b>{doc.name}</b>
              <div className="muted small">{doc.chunks} sections, added {timeAgo(doc.createdAt)}</div>
            </div>
            <button type="button" className="link-btn danger" onClick={() => remove(doc)}><Icon name="trash" size={16} />Remove</button>
          </div>
        ))}
        {docs?.length === 0 && (
          <div className="empty"><strong>No documents yet</strong>Try samples/flowdesk-brochure.md from the project folder.</div>
        )}
      </section>
    </>
  );
}
