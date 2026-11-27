// Marks a group shown only because of the range exceptions ("Sauf statuts").
export default function OutOfRangeBadge({ hiddenCount = 0 }: { hiddenCount?: number }) {
  const title =
    'Hors plage : groupe affiché car il contient des tâches dans les statuts conservés ; seules ces tâches sont montrées' +
    (hiddenCount ? ` (${hiddenCount} autre${hiddenCount > 1 ? 's' : ''} masquée${hiddenCount > 1 ? 's' : ''}).` : '.');
  return (
    <span className="range-badge" title={title}>
      hors plage{hiddenCount ? ` · +${hiddenCount} masquée${hiddenCount > 1 ? 's' : ''}` : ''}
    </span>
  );
}
