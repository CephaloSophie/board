import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useRetros, useCreateRetro, useDeleteRetro } from '../api/retros';
import { useTaxonomies, taxonomiesByKind } from '../api/taxonomies';
import { useTeams } from '../api/teams';
import { useProject } from '../api/projects';
import { useUsers } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { isManager } from '../utils/roles';
import RetroBoard from '../components/Retro/RetroBoard';
import Avatar from '../components/common/Avatar';

const PHASE_LABELS: Record<string, string> = {
  lobby: 'Préparation', rating: 'Note', ssc: 'Start/Stop/Continue', voting: 'Vote', actions: 'Objectifs', closing: 'Clôture', done: 'Terminée',
};

export default function RetroPage() {
  const { projectKey } = useParams();
  const { user } = useAuth();
  const { data: project } = useProject(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: teams } = useTeams(projectKey);
  const { data: users } = useUsers();
  const { data: retros } = useRetros(projectKey);
  const createRetro = useCreateRetro(projectKey || '');
  const deleteRetro = useDeleteRetro(projectKey || '');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!projectKey) return null;
  const canManage = isManager(user?.role);
  const sprints = taxonomiesByKind(taxonomies, 'sprint');

  if (openId) {
    return <RetroBoard projectKey={projectKey} retroId={openId} onClose={() => setOpenId(null)} />;
  }

  return (
    <div>
      <div className="page-toolbar">
        <h2 className="mt-0" style={{ marginRight: 'auto' }}>Rétrospectives</h2>
        {canManage && <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle rétrospective</button>}
      </div>

      <div className="event-grid">
        {retros?.map((r) => {
          const sprintLabel = sprints.find((s) => s.key === r.sprint)?.label || r.sprint;
          return (
            <div className="event-card" key={r._id} style={{ borderLeftColor: r.team?.color || 'var(--violet)' }} onClick={() => setOpenId(r._id)}>
              <div className="event-card__head">
                <span className="event-card__icon">🔄</span>
                <span className="event-card__type">{sprintLabel}{r.team ? ` · ${r.team.name}` : ''}</span>
                <span className="event-status" style={{ marginLeft: 'auto', background: 'var(--panel-3)', color: 'var(--soft)' }}>{PHASE_LABELS[r.phase] || r.status}</span>
              </div>
              <div className="event-card__title">{r.title || `Rétro ${sprintLabel}`}</div>
              <div className="event-card__meta">
                {r.facilitator && <span className="tag">🎤 {r.facilitator.displayName}</span>}
                <span className="event-avatars">
                  {(r.invited || []).slice(0, 5).map((p) => <Avatar key={p._id} name={p.displayName} color={p.color} size="sm" />)}
                </span>
                {canManage && (
                  <button
                    className="btn danger small"
                    style={{ marginLeft: 'auto' }}
                    onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer cette rétrospective ?')) deleteRetro.mutate(r._id); }}
                  >
                    Suppr.
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!retros?.length && <div className="empty">Aucune rétrospective. Créez-en une pour un sprint et une équipe.</div>}

      {creating && (
        <NewRetroModal
          sprints={sprints}
          teams={teams || []}
          users={users || []}
          defaultSprint={project?.currentSprint || ''}
          defaultFacilitator={user?.id || ''}
          busy={createRetro.isPending}
          onClose={() => setCreating(false)}
          onCreate={(data: { sprint: string; team?: string | null; title?: string; facilitator?: string }) => createRetro.mutate(data, { onSuccess: (r) => { setCreating(false); setOpenId(r.retro._id); } })}
        />
      )}
    </div>
  );
}

function NewRetroModal({ sprints, teams, users, defaultSprint, defaultFacilitator, busy, onClose, onCreate }: any) {
  const [sprint, setSprint] = useState(defaultSprint || sprints[0]?.key || '');
  const [team, setTeam] = useState('');
  const [facilitator, setFacilitator] = useState(defaultFacilitator);
  const [title, setTitle] = useState('');
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head"><h3>Nouvelle rétrospective</h3><button className="close-btn" onClick={onClose}>Fermer ✕</button></div>
        <div className="stack">
          <div className="field"><label>Sprint</label>
            <select value={sprint} onChange={(e) => setSprint(e.target.value)}>
              {sprints.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="field"><label>Équipe (invités par défaut)</label>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">— Aucune —</option>
              {teams.map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Animateur</label>
            <select value={facilitator} onChange={(e) => setFacilitator(e.target.value)}>
              {users.map((u: any) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
          <div className="field"><label>Titre (optionnel)</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rétro Sprint 12.4.4" /></div>
          <button className="btn primary" disabled={!sprint || busy} onClick={() => onCreate({ sprint, team: team || null, facilitator, title })}>Créer &amp; ouvrir</button>
        </div>
      </div>
    </div>
  );
}
