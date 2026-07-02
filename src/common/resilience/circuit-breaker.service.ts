import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type CircuitState = {
  failures: number
  openUntil: number
}

export class CircuitBreakerOpenError extends Error {
  constructor(readonly circuitName: string) {
    super(`Circuit breaker is open for ${circuitName}`)
    this.name = 'CircuitBreakerOpenError'
  }
}

@Injectable()
export class CircuitBreakerService {
  private readonly circuits = new Map<string, CircuitState>()

  constructor(private readonly configService: ConfigService) {}

  async execute<T>(
    circuitName: string,
    operation: () => Promise<T>,
    options?: {
      failureThreshold?: number
      openMs?: number
    }
  ) {
    const state = this.circuits.get(circuitName)
    const now = Date.now()

    if (state && state.openUntil > now) {
      throw new CircuitBreakerOpenError(circuitName)
    }

    try {
      const result = await operation()
      this.circuits.delete(circuitName)
      return result
    } catch (error) {
      const failureThreshold =
        options?.failureThreshold ??
        this.configService.get<number | undefined>(
          'homePerformance.circuitBreakerFailureThreshold'
        ) ??
        5
      const openMs =
        options?.openMs ??
        this.configService.get<number | undefined>(
          'homePerformance.circuitBreakerOpenMs'
        ) ??
        15_000
      const nextFailures = (state?.failures ?? 0) + 1

      this.circuits.set(circuitName, {
        failures: nextFailures,
        openUntil:
          nextFailures >= failureThreshold ? Date.now() + openMs : 0,
      })

      throw error
    }
  }

  isOpen(circuitName: string) {
    const state = this.circuits.get(circuitName)
    return Boolean(state && state.openUntil > Date.now())
  }
}
