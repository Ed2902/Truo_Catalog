export interface AdminJwtAccessTokenPayload {
  sub: string
  sid: string
  email: string
  name: string
  role: string
  permissions: string[]
  typ: 'admin_access'
  act: 'admin'
}
