'use client';
import { useActionState } from 'react';
import { createWorkspace } from '@/lib/actions/workspaces';
import { useT } from '@/lib/i18n/client';

export function CreateWorkspaceForm() {
  const t = useT().workspaces.form;
  const [state, action, pending] = useActionState(createWorkspace, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="ws-name">{t.name}</label>
        <input className="input" id="ws-name" name="name" placeholder={t.namePlaceholder} required />
      </div>
      <div>
        <label className="label" htmlFor="ws-brand">{t.brand}</label>
        <input className="input" id="ws-brand" name="brandName" placeholder={t.brandPlaceholder} required />
      </div>
      <div>
        <label className="label" htmlFor="ws-domains">{t.domains}</label>
        <input className="input" id="ws-domains" name="domains" placeholder={t.domainsPlaceholder} />
        <p className="mt-1 text-xs text-muted">{t.domainsHint}</p>
      </div>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? t.creating : t.create}</button>
    </form>
  );
}
