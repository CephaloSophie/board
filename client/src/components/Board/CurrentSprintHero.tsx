import { useEffect, useMemo, useState } from 'react';
import type { Project, SprintMeta, TaxonomyItem } from '../../types';
import { useTasks } from '../../api/tasks';
import { taxonomiesByKind } from '../../api/taxonomies';
import { computeStats } from './GroupStats';
import { SPRINT_STATUS_META } from '../Admin/TaxonomyAdmin';
import { fmtDur } from '../../utils/format';

// Live countdown to the current sprint's end date. Ticks every second.
function useCountdown(target: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  const over = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const secs = Math.floor((abs % 60000) / 1000);
  return { over, days, hours, mins, secs };
}

/**
 * The dashboard centerpiece: a distinctly framed, glowing panel for the
 * project's current sprint, with a live countdown and advanced progress stats.
 */
export default function CurrentSprintHero({
  projectKey,
  project,
  taxonomies,
}: {
  projectKey: string;
  project: Project | undefined;
  taxonomies: TaxonomyItem[] | undefined;
}) {
  const currentKey = project?.currentSprint || undefined;
  const sprint = useMemo(
    () => taxonomiesByKind(taxonomies, 'sprint').find((s) => s.key === currentKey),
    [taxonomies, currentKey]
  );
  const meta = (sprint?.meta || {}) as SprintMeta;
  // Fetch the current sprint's tasks independently of the board filters.
  const { data: sprintTasks } = useTasks(currentKey ? projectKey : undefined, currentKey ? { sprint: [currentKey] } : {});
  const countdown = useCountdown(meta.endDate);

  if (!currentKey || !sprint) {
    return (
      <div className="sprint-hero">
        <div className="sprint-hero__eyebrow">
          <span className="sprint-hero__pulse" /> Sprint courant
        </div>
        <div className="sprint-hero__name">Aucun sprint courant défini</div>
        <div className="sprint-hero__empty">
          Définissez le sprint courant dans <b>Administration → Taxonomies → Sprints</b> (bouton « Définir
          comme sprint actuel ») ou dans <b>Administration → Projet</b>.
        </div>
      </div>
    );
  }

  const stats = computeStats(sprintTasks || [], taxonomies);
  const pct = stats.points ? Math.round((stats.donePoints / stats.points) * 100) : 0;
  const statusMeta = meta.status ? SPRINT_STATUS_META[meta.status] : undefined;
  const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—');

  return (
    <div className="sprint-hero">
      <div className="sprint-hero__grid">
        <div>
          <div className="sprint-hero__eyebrow">
            <span className="sprint-hero__pulse" /> Sprint courant
          </div>
          <div className="sprint-hero__name">{sprint.label}</div>
          {meta.goal && <div className="sprint-hero__goal">🎯 {meta.goal}</div>}
          <div className="sprint-hero__meta">
            {statusMeta && (
              <span className="sprint-hero__badge status">{statusMeta.label}</span>
            )}
            <span className="sprint-hero__badge">
              {fmtDate(meta.startDate)} → {fmtDate(meta.endDate)}
            </span>
            <span className="sprint-hero__badge">{stats.count} tâches</span>
            <span className="sprint-hero__badge">~{fmtDur(stats.hours)}</span>
          </div>

          <div className="progress" title={`${pct}% des points terminés`}>
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress__label">
            <span>{stats.donePoints} / {stats.points} pts terminés</span>
            <span>{pct}%</span>
          </div>

          <div className="sprint-hero__stats">
            <div className="hero-stat">
              <div className="v" style={{ color: 'var(--info)' }}>{stats.todoPoints}</div>
              <div className="l">À faire (pts)</div>
            </div>
            <div className="hero-stat">
              <div className="v" style={{ color: 'var(--gold)' }}>{stats.inProgressPoints}</div>
              <div className="l">En cours (pts)</div>
            </div>
            <div className="hero-stat">
              <div className="v" style={{ color: 'var(--success)' }}>{stats.donePoints}</div>
              <div className="l">Terminés (pts)</div>
            </div>
            <div className="hero-stat">
              <div className="v" style={{ color: stats.unassigned ? 'var(--danger)' : 'var(--text)' }}>
                {stats.unassigned}
              </div>
              <div className="l">Sans assigné</div>
            </div>
          </div>
        </div>

        <div>
          <div className="chrono__title">
            {countdown?.over ? 'Sprint terminé depuis' : 'Temps restant'}
          </div>
          {countdown ? (
            <div className={`chrono${countdown.over ? ' chrono--over' : ''}`}>
              <div className="chrono__cell">
                <div className="chrono__num">{countdown.days}</div>
                <div className="chrono__lbl">Jours</div>
              </div>
              <div className="chrono__cell">
                <div className="chrono__num">{String(countdown.hours).padStart(2, '0')}</div>
                <div className="chrono__lbl">Heures</div>
              </div>
              <div className="chrono__cell">
                <div className="chrono__num">{String(countdown.mins).padStart(2, '0')}</div>
                <div className="chrono__lbl">Min</div>
              </div>
              <div className="chrono__cell">
                <div className="chrono__num">{String(countdown.secs).padStart(2, '0')}</div>
                <div className="chrono__lbl">Sec</div>
              </div>
            </div>
          ) : (
            <div className="sprint-hero__empty">Aucune date de fin définie pour ce sprint.</div>
          )}
        </div>
      </div>
    </div>
  );
}
