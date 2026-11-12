// Apple 弹簧参数：damping 控制回弹，response 控制到达速度（秒），不是固定时长。
export interface SpringOptions {
  damping?: number
  response?: number
  velocity?: number
  onUpdate: (value: number) => void
  onRest?: () => void
}

const requestFrame: (callback: (time: number) => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(() => callback(Date.now()), 16) as unknown as number

const cancelFrame: (handle: number) => void =
  typeof cancelAnimationFrame === 'function' ? (handle) => cancelAnimationFrame(handle) : (handle) => clearTimeout(handle)

export function prefersReducedMotion() {
  // #ifdef H5
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  // #endif
  // #ifndef H5
  return false
  // #endif
}

// 从当前值与当前速度出发积分到目标值，返回取消函数，可随时被打断并重新定向。
export function spring(from: number, to: number, options: SpringOptions) {
  const damping = options.damping ?? 1
  const response = options.response ?? 0.36
  let position = from
  let velocity = options.velocity ?? 0

  if (prefersReducedMotion() || Math.abs(to - from) < 0.5) {
    options.onUpdate(to)
    options.onRest?.()
    return () => {}
  }

  const omega = (2 * Math.PI) / response
  const start = performanceNow()
  let handle = 0
  let stopped = false

  const offset = from - to
  const underDamped = damping < 1
  const omegaD = underDamped ? omega * Math.sqrt(1 - damping * damping) : 0
  const a = offset
  const b = underDamped ? (velocity + damping * omega * offset) / omegaD : velocity + omega * offset

  const step = (now: number) => {
    if (stopped) return
    const t = (now - start) / 1000
    const decay = Math.exp(-damping * omega * t)
    if (underDamped) {
      position = to + decay * (a * Math.cos(omegaD * t) + b * Math.sin(omegaD * t))
      velocity =
        decay *
        ((b * omegaD - a * damping * omega) * Math.cos(omegaD * t) -
          (a * omegaD + b * damping * omega) * Math.sin(omegaD * t))
    } else {
      position = to + decay * (a + b * t)
      velocity = decay * (b - omega * (a + b * t))
    }
    options.onUpdate(position)
    if ((Math.abs(position - to) < 0.4 && Math.abs(velocity) < 4) || t > 3) {
      options.onUpdate(to)
      options.onRest?.()
      return
    }
    handle = requestFrame(step)
  }

  handle = requestFrame(step)
  return () => {
    if (stopped) return
    stopped = true
    cancelFrame(handle)
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

// Apple 的动量投射：按指数衰减推算手势会停在哪里，而不是就近吸附。
export function projectMomentum(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * (decelerationRate / (1 - decelerationRate))
}

// 越界越远阻力越大，边界是软的而不是硬停。
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}