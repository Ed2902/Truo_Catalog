import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { RequestWithAdminUser } from '../interfaces/admin-authenticated-request.interface'

export const CurrentAdminUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithAdminUser>()
    return request.adminUser
  },
)

