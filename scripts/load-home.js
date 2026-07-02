const DEFAULT_URL = 'http://localhost:3001/api/catalog/home?take=16'

const url = process.env.CATALOG_HOME_URL || DEFAULT_URL
const totalRequests = Number(process.env.LOAD_REQUESTS || 100)
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10)
const authorization = process.env.LOAD_AUTHORIZATION || ''

const durations = []
let completed = 0
let failed = 0
let nextRequest = 0

const percentile = (values, p) => {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[index]
}

const runOne = async () => {
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      headers: authorization ? { Authorization: authorization } : undefined,
    })
    const body = await response.text()
    const durationMs = Date.now() - startedAt

    durations.push(durationMs)

    if (!response.ok) {
      failed += 1
      console.error(
        `HTTP ${response.status} in ${durationMs}ms: ${body.slice(0, 200)}`
      )
      return
    }

    completed += 1
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Request failed: ${message}`)
  }
}

const worker = async () => {
  while (nextRequest < totalRequests) {
    nextRequest += 1
    await runOne()
  }
}

const main = async () => {
  const startedAt = Date.now()
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, totalRequests)) },
    () => worker()
  )

  await Promise.all(workers)

  const totalDurationMs = Date.now() - startedAt
  const avgMs = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0

  console.log(
    JSON.stringify(
      {
        url,
        totalRequests,
        concurrency,
        completed,
        failed,
        totalDurationMs,
        requestsPerSecond: Number(
          (totalRequests / Math.max(totalDurationMs / 1000, 0.001)).toFixed(2)
        ),
        avgMs,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        maxMs: durations.length ? Math.max(...durations) : 0,
      },
      null,
      2
    )
  )

  if (failed > 0) {
    process.exitCode = 1
  }
}

void main()
