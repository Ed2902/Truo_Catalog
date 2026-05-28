export interface JwtAccessTokenPayload {
  sub: string;
  sid: string;
  email?: string;
  typ: 'access';
}
