import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { StorageService } from './storage.service';

@Module({
  imports: [CommonModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
