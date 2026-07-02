import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { REDIS } from './redis.constants'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)

  constructor(
    @Inject(REDIS) private readonly client: Redis,
    private readonly configService: ConfigService
  ) {}

  getClient(): Redis {
    return this.client
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect()
      }

      await this.client.ping()
    } catch (error) {
      this.client.disconnect()

      const redisUrl = this.configService.getOrThrow<string>('redis.cacheUrl')
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown Redis connection error'

      this.logger.warn(
        { err: error, redisUrl },
        `Redis cache is unavailable at bootstrap. Cache will run degraded: ${message}`
      )
    }
  }

  async ping(): Promise<string> {
    if (this.client.status === 'wait') {
      await this.client.connect()
    }

    return this.client.ping()
  }

  async getHealthSummary() {
    const startedAt = Date.now()
    const pong = await this.ping()
    const [info, keyCount] = await Promise.all([
      this.client.info('memory'),
      this.client.dbsize(),
    ])

    return {
      status: pong === 'PONG' ? 'ok' : 'error',
      role: 'cache',
      latencyMs: Date.now() - startedAt,
      keyCount,
      usedMemoryBytes: this.readRedisInfoNumber(info, 'used_memory'),
      maxMemoryBytes: this.readRedisInfoNumber(info, 'maxmemory'),
      evictionPolicy: this.readRedisInfoString(info, 'maxmemory_policy'),
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const rawValue = await this.client.get(key)

    if (!rawValue) {
      return null
    }

    try {
      return JSON.parse(rawValue) as T
    } catch {
      await this.client.del(key)
      return null
    }
  }

  async mgetJson<T>(keys: string[]): Promise<Map<string, T>> {
    const uniqueKeys = [...new Set(keys.filter(Boolean))]
    const valuesByKey = new Map<string, T>()

    if (!uniqueKeys.length) {
      return valuesByKey
    }

    const rawValues = await this.client.mget(...uniqueKeys)
    const corruptedKeys: string[] = []

    rawValues.forEach((rawValue, index) => {
      if (!rawValue) {
        return
      }

      const key = uniqueKeys[index]

      try {
        valuesByKey.set(key, JSON.parse(rawValue) as T)
      } catch {
        corruptedKeys.push(key)
      }
    })

    if (corruptedKeys.length) {
      await this.client.del(...corruptedKeys)
    }

    return valuesByKey
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  }

  async msetJson(entries: Array<{ key: string; value: unknown }>, ttlSeconds: number) {
    const uniqueEntries = new Map<string, unknown>()

    for (const entry of entries) {
      if (entry.key) {
        uniqueEntries.set(entry.key, entry.value)
      }
    }

    if (!uniqueEntries.size) {
      return
    }

    const pipeline = this.client.pipeline()

    for (const [key, value] of uniqueEntries) {
      pipeline.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    }

    await pipeline.exec()
  }

  async deleteKeys(keys: string[]): Promise<number> {
    const uniqueKeys = [...new Set(keys.filter(Boolean))]

    if (!uniqueKeys.length) {
      return 0
    }

    return this.client.del(...uniqueKeys)
  }

  async addSetMembers(
    key: string,
    members: string[],
    ttlSeconds: number
  ): Promise<void> {
    const uniqueMembers = [...new Set(members.filter(Boolean))]

    if (!uniqueMembers.length) {
      return
    }

    await this.client.sadd(key, ...uniqueMembers)
    await this.client.expire(key, ttlSeconds)
  }

  async getSetMembers(key: string): Promise<string[]> {
    return this.client.smembers(key)
  }

  async deleteByPattern(pattern: string): Promise<number> {
    let deletedCount = 0
    const stream = this.client.scanStream({
      match: pattern,
      count: 100,
    })

    for await (const keys of stream as AsyncIterable<string[]>) {
      if (!keys.length) {
        continue
      }

      deletedCount += await this.client.del(...keys)
    }

    return deletedCount
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') {
      return
    }

    try {
      await this.client.quit()
    } catch {
      this.client.disconnect()
    }
  }

  private readRedisInfoNumber(info: string, key: string) {
    const value = this.readRedisInfoString(info, key)
    return value ? Number(value) : null
  }

  private readRedisInfoString(info: string, key: string) {
    const line = info
      .split('\n')
      .find(entry => entry.startsWith(`${key}:`))

    return line?.split(':')[1]?.trim() ?? null
  }
}
