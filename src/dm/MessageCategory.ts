export type MessageCategory =
  | 'pr-lifecycle'
  | 'pr-lifecycle-follow'
  | 'pr-review'
  | 'pr-review-follow'
  | 'pr-comment'
  | 'pr-comment-bots'
  | 'pr-comment-follow'
  | 'pr-comment-follow-bots'
  | 'pr-comment-thread'
  | 'pr-comment-mention'
  | 'pr-merge-conflicts'
  | 'issue-comment-mention';
