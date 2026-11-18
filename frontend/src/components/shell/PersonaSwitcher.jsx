/** Offer explicit alternative personas and cancel without changing context. */
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSharedContext } from '../../context/SharedContextProvider';
import { DataState } from '../shared/DataState';

/** Use native modal focus trapping, Escape handling and explicit commit. */
export function PersonaSwitcher() {
  const { context, setPersona } = useSharedContext();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const dialog = useRef(null);
  const trigger = useRef(null);
  const catalog = useApi(open ? '/personas' : null);
  useEffect(() => {
    if (!open) return;
    dialog.current.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const close = () => { dialog.current.close(); setOpen(false); setChoice(''); trigger.current.focus(); };
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>Switch persona</button>
      <dialog ref={dialog} aria-modal="true" aria-labelledby="switch-title" onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === dialog.current) close(); }}>
        <div className="dialog-body">
          <h2 id="switch-title">Switch perspective</h2>
          <p className="muted">Current persona: {context.personaId}. Cancel keeps this perspective.</p>
          <DataState loading={catalog.loading} error={catalog.error} empty={catalog.data?.length === 0} onRetry={catalog.refetch}>
            <label htmlFor="persona-choice">New persona</label>
            <select id="persona-choice" value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Choose an alternative</option>
              {catalog.data?.filter((item) => item.id !== context.personaId).map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </DataState>
          <div className="actions">
            <button onClick={close}>Cancel</button>
            <button className="primary" disabled={!choice} onClick={() => { setPersona(choice); close(); }}>Confirm switch</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
