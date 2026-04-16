import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { IdentitySignalsService } from '../catalog/identity/identity-signals.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.accessTokenSecret'),
      }),
    }),
  ],
  providers: [JwtAuthGuard, OptionalJwtAuthGuard, IdentitySignalsService],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, IdentitySignalsService],
})
export class AuthModule {}
