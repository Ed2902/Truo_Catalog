import { Throttle } from '@nestjs/throttler';

export const SensitiveRateLimit = () =>
  Throttle({
    sensitive: {},
  });
