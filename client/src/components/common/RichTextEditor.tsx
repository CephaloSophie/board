import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { uploadImage } from '../../api/attachments';
import { errorMessage } from '../../api/client';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import Avatar from './Avatar';
import RichText from './RichText';

const COLORS: [string, string][] = [
  ['Rouge', '#e85d70'],
  ['Orange', '#e0a458'],
  ['Jaune', '#d4a72c'],
  ['Vert', '#2f8f57'],
  ['Bleu', '#4f7be8'],
  ['Violet', '#8e6cd9'],
  ['Gris', '#7d8aa3'],
];

const HELP = [
  '**gras**  *italique*  ++souligné++  ~~barré~~  ==surligné==',
  '{color:#e85d70}texte en couleur{color}',
  '# Titre   - liste   1. liste   - [ ] case à cocher   > citation',
  '`code`   ```bloc de code```   [lien](https://…)   ![image](url)',
  '@utilisateur pour mentionner · KB-12 pour lier une tâche',
].join('\n');

function Tool({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="rte__tool" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  projectKey,
  taskId,
  placeholder,
  rows = 5,
  autoFocus,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  projectKey: string;
  taskId?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Uploads finish after re-renders: always edit the latest value.
  const valueRef = useRef(value);
  valueRef.current = value;
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const people = useProjectPeople(projectKey);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return people.users.filter((u) => u.active !== false && (u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))).slice(0, 6);
  }, [mention, people.users]);

  function commit(next: string, selStart: number, selEnd = selStart) {
    valueRef.current = next;
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function selection() {
    const el = ref.current;
    const v = valueRef.current;
    return { v, s: el ? el.selectionStart : v.length, e: el ? el.selectionEnd : v.length };
  }

  function wrap(before: string, after = before, fallback = 'texte') {
    const { v, s, e } = selection();
    const selected = v.slice(s, e) || fallback;
    commit(v.slice(0, s) + before + selected + after + v.slice(e), s + before.length, s + before.length + selected.length);
  }

  function prefixLines(make: (index: number) => string) {
    const { v, s, e } = selection();
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const end = v.indexOf('\n', e);
    const lineEnd = end === -1 ? v.length : end;
    const block = v
      .slice(lineStart, lineEnd)
      .split('\n')
      .map((line, i) => make(i) + line)
      .join('\n');
    commit(v.slice(0, lineStart) + block + v.slice(lineEnd), lineStart, lineStart + block.length);
  }

  function insert(text: string) {
    const { v, s, e } = selection();
    commit(v.slice(0, s) + text + v.slice(e), s + text.length);
  }

  function codeBlock() {
    const { v, s, e } = selection();
    if (v.slice(s, e).includes('\n')) wrap('```\n', '\n```', 'code');
    else wrap('`', '`', 'code');
  }

  function addLink() {
    const url = window.prompt('Adresse du lien (https://…, mailto:… ou /projects/…)');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|\/projects\/)/i.test(url.trim())) {
      setError('Lien refusé : utilisez https://, mailto: ou /projects/…');
      return;
    }
    wrap('[', `](${url.trim()})`, 'lien');
  }

  async function upload(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      if (files.length) setError('Seules les images (PNG, JPEG, GIF, WebP) peuvent être insérées.');
      return;
    }
    setError(null);
    for (const file of images) {
      setUploading((n) => n + 1);
      try {
        const image = await uploadImage(projectKey, file, taskId);
        const { v, s } = selection();
        const lead = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
        insert(`${lead}![${image.name.replace(/[[\]]/g, '')}](${image.url})\n`);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function handleChange(next: string, caret: number) {
    onChange(next);
    const m = /(^|[\s(])@([a-zA-Z0-9._-]{0,30})$/.exec(next.slice(0, caret));
    setMention(m ? { start: caret - m[2].length - 1, query: m[2], index: 0 } : null);
  }

  function pickMention(username: string) {
    if (!mention) return;
    const { v, s } = selection();
    const text = `@${username} `;
    commit(v.slice(0, mention.start) + text + v.slice(s), mention.start + text.length);
    setMention(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : suggestions.length - 1;
        setMention({ ...mention, index: (mention.index + step) % suggestions.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(suggestions[Math.min(mention.index, suggestions.length - 1)].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
      return;
    }
    const shortcuts: Record<string, () => void> = { b: () => wrap('**'), i: () => wrap('*'), u: () => wrap('++'), k: addLink };
    const action = !e.shiftKey && shortcuts[e.key.toLowerCase()];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      upload(files);
    }
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    const files = [...e.dataTransfer.files];
    if (files.length) {
      e.preventDefault();
      upload(files);
    }
  }

  return (
    <div className={`rte${disabled ? ' disabled' : ''}`}>
      <div className="rte__bar">
        <div className="rte__tabs">
          <button type="button" className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
            Écrire
          </button>
          <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
            Aperçu
          </button>
        </div>
        {tab === 'write' && !disabled && (
          <div className="rte__tools">
            <Tool title="Gras (Ctrl+B)" onClick={() => wrap('**')}>
              <b>B</b>
            </Tool>
            <Tool title="Italique (Ctrl+I)" onClick={() => wrap('*')}>
              <i>I</i>
            </Tool>
            <Tool title="Souligné (Ctrl+U)" onClick={() => wrap('++')}>
              <u>U</u>
            </Tool>
            <Tool title="Barré" onClick={() => wrap('~~')}>
              <s>S</s>
            </Tool>
            <Tool title="Surligné" onClick={() => wrap('==')}>
              <mark>H</mark>
            </Tool>
            <span className="rte__color">
              <Tool title="Couleur du texte" onClick={() => setColorOpen((o) => !o)}>
                <span style={{ color: '#e85d70' }}>A</span>▾
              </Tool>
              {colorOpen && (
                <span className="rte__palette" onMouseLeave={() => setColorOpen(false)}>
                  {COLORS.map(([label, hex]) => (
                    <button
                      key={hex}
                      type="button"
                      title={label}
                      style={{ background: hex }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        wrap(`{color:${hex}}`, '{color}');
                        setColorOpen(false);
                      }}
                    />
                  ))}
                </span>
              )}
            </span>
            <span className="rte__sep" />
            <Tool title="Titre" onClick={() => prefixLines(() => '## ')}>
              H2
            </Tool>
            <Tool title="Liste à puces" onClick={() => prefixLines(() => '- ')}>
              •≡
            </Tool>
            <Tool title="Liste numérotée" onClick={() => prefixLines((i) => `${i + 1}. `)}>
              1.
            </Tool>
            <Tool title="Cases à cocher" onClick={() => prefixLines(() => '- [ ] ')}>
              ☑
            </Tool>
            <Tool title="Citation" onClick={() => prefixLines(() => '> ')}>
              ❝
            </Tool>
            <Tool title="Code" onClick={codeBlock}>
              {'</>'}
            </Tool>
            <span className="rte__sep" />
            <Tool title="Lien (Ctrl+K)" onClick={addLink}>
              🔗
            </Tool>
            <Tool title="Insérer une image (ou collez / glissez-la)" onClick={() => fileRef.current?.click()}>
              🖼
            </Tool>
            <Tool title="Mentionner un membre" onClick={() => insert('@')}>
              @
            </Tool>
          </div>
        )}
        <span className="rte__help" title={HELP}>
          ?
        </span>
      </div>

      {tab === 'write' ? (
        <div className="rte__area">
          <textarea
            ref={ref}
            rows={rows}
            value={value}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onBlur={() => setTimeout(() => setMention(null), 150)}
          />
          {mention && suggestions.length > 0 && (
            <div className="rte__mentions">
              {suggestions.map((u, i) => (
                <button
                  type="button"
                  key={u.id}
                  className={i === mention.index ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(u.username);
                  }}
                >
                  <Avatar name={u.displayName} color={u.color} size="sm" />
                  <b>{u.displayName}</b>
                  <span>@{u.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rte__preview">
          <RichText text={value} projectKey={projectKey} mentionLabel={people.mentionLabel} empty={<span className="text-muted">Rien à prévisualiser.</span>} />
        </div>
      )}

      <div className="rte__foot">
        {uploading > 0 && <span className="rte__uploading">Envoi de {uploading} image(s)…</span>}
        {error && <span className="form-error">{error}</span>}
        <span className="hint">
          Mise en forme, images (coller / glisser), @mentions{onSubmit ? ' · Ctrl+Entrée pour envoyer' : ''}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          upload([...(e.target.files || [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
