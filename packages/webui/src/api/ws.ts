type WsHandler = (data: WsMessage) => void

export interface WsMessage {
  type: string
  [key: string]: unknown
}

let ws: WebSocket | null = null
let retryDelay = 1000
let handlers: WsHandler[] = []
let connectListeners: Array<(connected: boolean) => void> = []

function notifyConnected(connected: boolean) {
  connectListeners.forEach((fn) => fn(connected))
}

export function onWsMessage(fn: WsHandler) {
  if (!handlers.includes(fn)) {
    handlers.push(fn)
  }
  return () => { handlers = handlers.filter((h) => h !== fn) }
}

export function onWsConnect(fn: (connected: boolean) => void) {
  if (!connectListeners.includes(fn)) {
    connectListeners.push(fn)
  }
  return () => { connectListeners = connectListeners.filter((h) => h !== fn) }
}

export function sendWs(data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  const token = localStorage.getItem("nobie_token") ?? localStorage.getItem("wizby_token") ?? localStorage.getItem("howie_token")
  const qs = token ? `?token=${encodeURIComponent(token)}` : ""
  const url = `${proto}//${window.location.host}/ws${qs}`

  ws = new WebSocket(url)

  ws.onopen = () => {
    retryDelay = 1000
    notifyConnected(true)
  }

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as WsMessage
      handlers.forEach((fn) => fn(data))
    } catch { /* ignore */ }
  }

  ws.onclose = () => {
    notifyConnected(false)
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, 30_000)
      connectWs()
    }, retryDelay)
  }

  ws.onerror = () => ws?.close()
}
