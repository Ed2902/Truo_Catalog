import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { IdentitySignalsService } from '../catalog/identity/identity-signals.service'
import { CommonModule } from '../common/common.module'
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard'
import { AdminPermissionsGuard } from './guards/admin-permissions.guard'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard'

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.accessTokenSecret'),
      }),
    }),
  ],
  providers: [
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminJwtAuthGuard,
    AdminPermissionsGuard,
    IdentitySignalsService,
  ],
  exports: [
    JwtModule,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminJwtAuthGuard,
    AdminPermissionsGuard,
    IdentitySignalsService,
  ],
})
export class AuthModule {}
