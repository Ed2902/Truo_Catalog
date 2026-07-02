import { Throttle } from '@nestjs/throttler';

export const HomeRateLimit = () =>
  Throttle({
    home: {},
  });
