'use client';
import { useActionState } from 'react';
import { createWorkspace } from '@/lib/actions/workspaces';

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="ws-name">Name des Workspaces</label>
        <input className="input" id="ws-name" name="name" placeholder="z. B. Paylindo Marketing" required />
      </div>
      <div>
        <label className="label" htmlFor="ws-brand">Eigene Marke</label>
        <input className="input" id="ws-brand" name="brandName" placeholder="z. B. Paylindo" required />
      </div>
      <div>
        <label className="label" htmlFor="ws-domains">Domains der Marke</label>
        <input className="input" id="ws-domains" name="domains" placeholder="paylindo.de, paylindo.com" />
        <p className="mt-1 text-xs text-muted">Mehrere mit Komma trennen. Subdomains werden automatisch mitgezählt.</p>
      </div>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? 'Wird angelegt …' : 'Workspace anlegen'}</button>
    </form>
  );
}
