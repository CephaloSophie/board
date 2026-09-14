import GroupedBoard, { type BoardProps } from './GroupedBoard';

// Jira-style kanban: same engine as the grouped board, one horizontal column per
// workflow status, cards sorted by priority.
export default function JiraBoard(props: BoardProps) {
  return <GroupedBoard {...props} variant="jira" />;
}
