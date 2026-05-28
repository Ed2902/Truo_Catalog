import { Request } from 'express'

export interface AuthenticatedAdminRequestUser {
  adminUserId: string
  sessionId: string
  email: string
  name: string
  role: string
  permissions: string[]
  tokenType: 'admin_access'
}

export interface RequestWithAdminUser extends Request {
  adminUser?: AuthenticatedAdminRequestUser
}
