export interface IdentityUserSignals {
  userId: string;
  isPremium: boolean;
  source: 'request' | 'header-cache' | 'identity-service' | 'fallback';
}
