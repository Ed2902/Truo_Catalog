export const CATALOG_OUTBOX_DISPATCH_JOB = 'catalog-outbox-dispatch';
export const CATALOG_OUTBOX_MAX_ATTEMPTS = 5;
export const CATALOG_OUTBOX_SWEEP_INTERVAL_MS = 15_000;
export const CATALOG_OUTBOX_BATCH_SIZE = 50;

export const CATALOG_OUTBOX_TOPICS = {
  ITEM_CHANGED: 'catalog.item.changed',
  PROPOSAL_CHANGED: 'catalog.proposal.changed',
  OWNER_RATING_CHANGED: 'catalog.owner.rating.changed',
  OWNER_PROFILE_CHANGED: 'catalog.owner.profile.changed',
  VIEWER_RELATIONSHIP_CHANGED: 'catalog.viewer.relationship.changed',
  STORY_CHANGED: 'catalog.story.changed',
  MEDIA_CHANGED: 'catalog.media.changed',
} as const;
