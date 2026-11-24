import { useState } from 'react';
import type { MergeRequest, MergeRequestState, Task } from '../../types';
import { useMergeRequestActions } from '../../api/tasks';
import { errorMessage } from '../../api/client';
import { fmtDate } from '../../utils/format';
import { fmtRelative } from '../../utils/dates';
import { MR_PROVIDER_LABELS, MR_STATES, MR_STATE_META, mergeRequestLabel, parseMergeRequestUrl } from '../../utils/mergeRequests';

/*
 * Merge / pull requests linked to a task. The developer pastes the link; the
 * forge, repository and number are recognised from the URL (GitLab, GitHub,
 * Bitbucket, Azure DevOps, Gitea), the state is set by hand.
 */

export type MergeRequestDraft = Pick<MergeRequest, 'url' | 'title' | 'state'> & Partial<MergeRequest> & { _id: string };

interface Props {
  items: MergeRequestDraft[];
  readOnly?: boolean;
  busy?: boolean;
  error?: string | null;
  onAdd: (mr: { url: string; title?: string; state: MergeRequestState }) => Promise<unknown>;
  onUpdate?: (id: string, patch: { state?: MergeRequestState; title?: string }) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

export function MergeRequestEditor({ items, readOnly, busy, error, onAdd, onUpdate, onRemove, compact }: Props) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<MergeRequestState>('open');
  const [localError, setLocalError] = useState<string | null>(null);
  const parsed = url.trim() ? parseMergeRequestUrl(url) : null;

  function add() {
    if (!url.trim()) return;
    if (!parsed) {
      setLocalError('Lien invalide : collez l’adresse complète (https://…).');
      return;
    }
    if (items.some((m) => m.url.replace(/\/+$/, '').toLowerCase() === parsed.url.replace(/\/+$/, '').toLowerCase())) {
      setLocalError('Cette merge request est déjà liée.');
      return;
    }
    setLocalError(null);
    onAdd({ url: parsed.url, title: title.trim() || undefined, state }).then(
      () => {
        setUrl('');
        setTitle('');
        setState('open');
      },
      () => undefined
    );
  }

  return (
    <div className={`mr-list${compact ? ' compact' : ''}`}>
      {items.length === 0 && <div className="text-muted small-text">Aucune merge request liée.</div>}
      {items.map((mr) => {
        const info = mr.provider ? mr : { ...mr, ...(parseMergeRequestUrl(mr.url) || {}) };
        const meta = MR_STATE_META[mr.state];
        const addedBy = typeof mr.addedBy === 'object' && mr.addedBy ? mr.addedBy.displayName : null;
        return (
          <div key={mr._id} className={`mr mr--${mr.state}`}>
            <span className={`mr__provider mr__provider--${info.provider || 'other'}`} title={MR_PROVIDER_LABELS[info.provider || 'other']}>
              ⑂
            </span>
            <div className="mr__main">
              <a href={mr.url} target="_blank" rel="noreferrer noopener" className="mr__title" title={mr.url}>
                {mergeRequestLabel(info)}
              </a>
              <span className="mr__meta">
                {MR_PROVIDER_LABELS[info.provider || 'other']}
                {addedBy && <> · ajoutée par {addedBy}</>}
                {mr.createdAt && <span title={fmtDate(mr.createdAt)}> · {fmtRelative(mr.createdAt)}</span>}
              </span>
            </div>
            {onUpdate && !readOnly ? (
              <select
                className="mr__state"
                value={mr.state}
                style={{ color: meta.color, borderColor: meta.color }}
                onChange={(e) => onUpdate(mr._id, { state: e.target.value as MergeRequestState })}
                title="Statut de la merge request"
              >
                {MR_STATES.map((s) => (
                  <option key={s} value={s}>
                    {MR_STATE_META[s].label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="sprint-tag" style={{ background: 'var(--panel-3)', color: meta.color }}>
                {meta.label}
              </span>
            )}
            {!readOnly && (
              <button type="button" className="icon-btn danger" title="Retirer le lien" onClick={() => confirm('Retirer cette merge request ?') && onRemove(mr._id)}>
                ✕
              </button>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className="mr-add">
          <input
            type="url"
            value={url}
            placeholder="Coller le lien de la merge request (GitLab, GitHub, Bitbucket…)"
            onChange={(e) => {
              setUrl(e.target.value);
              setLocalError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <input type="text" value={title} placeholder="Titre (optionnel)" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <select value={state} onChange={(e) => setState(e.target.value as MergeRequestState)} title="Statut">
            {MR_STATES.map((s) => (
              <option key={s} value={s}>
                {MR_STATE_META[s].label}
              </option>
            ))}
          </select>
          <button type="button" className="btn small" disabled={!url.trim() || busy} onClick={add}>
            Lier
          </button>
          {parsed && parsed.provider !== 'other' && (
            <span className="hint mr-add__detected">
              {MR_PROVIDER_LABELS[parsed.provider]} · {parsed.repo} {parsed.ref}
            </span>
          )}
        </div>
      )}
      {(localError || error) && <div className="form-error">{localError || error}</div>}
    </div>
  );
}

// Server-backed list of an existing task.
export default function TaskMergeRequests({ projectKey, task, readOnly }: { projectKey: string; task: Task; readOnly?: boolean }) {
  const { add, update, remove } = useMergeRequestActions(projectKey);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(errorMessage(e));
  return (
    <MergeRequestEditor
      items={task.mergeRequests || []}
      readOnly={readOnly}
      busy={add.isPending}
      error={error}
      onAdd={(mr) => {
        setError(null);
        return add.mutateAsync({ taskId: task.taskId, ...mr }).catch((e) => {
          onError(e);
          throw e;
        });
      }}
      onUpdate={(mrId, patch) => {
        setError(null);
        update.mutate({ taskId: task.taskId, mrId, ...patch }, { onError });
      }}
      onRemove={(mrId) => {
        setError(null);
        remove.mutate({ taskId: task.taskId, mrId }, { onError });
      }}
    />
  );
}
