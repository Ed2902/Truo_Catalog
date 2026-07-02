import { Throttle } from '@nestjs/throttler';

export const MediaUploadRateLimit = () =>
  Throttle({
    mediaUpload: {},
  });
