import process from "node:process"

let buffer = Buffer.alloc(0)

function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`)
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function handle(message) {
  const method = message.method
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "0.1.0" },
      },
    })
    return
  }

  if (method === "notifications/initialized") {
    return
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes the given text.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
          },
          {
            name: "sum",
            description: "Adds two numbers.",
            inputSchema: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        ],
      },
    })
    return
  }

  if (method === "tools/call") {
    const params = toObject(message.params)
    const name = params.name
    const args = toObject(params.arguments)

    if (name === "echo") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            { type: "text", text: String(args.text ?? "") },
          ],
        },
      })
      return
    }

    if (name === "sum") {
      const a = Number(args.a ?? 0)
      const b = Number(args.b ?? 0)
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            { type: "text", text: String(a + b) },
          ],
        },
      })
      return
    }
  }

  send({
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: `Unsupported method: ${message.method}`,
    },
  })
}

function consume() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd === -1) return

    const header = buffer.subarray(0, headerEnd).toString("utf8")
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }

    const bodyLength = Number(match[1])
    const totalLength = headerEnd + 4 + bodyLength
    if (buffer.length < totalLength) return

    const body = buffer.subarray(headerEnd + 4, totalLength).toString("utf8")
    buffer = buffer.subarray(totalLength)
    handle(JSON.parse(body))
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)])
  consume()
})
