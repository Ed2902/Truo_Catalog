import { Throttle } from '@nestjs/throttler';

export const DetailRateLimit = () =>
  Throttle({
    detail: {},
  });
