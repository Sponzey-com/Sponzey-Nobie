import { describe, expect, it } from "vitest"
import { createCliChunkDeliveryHandler } from "../packages/cli/src/chunk-delivery.ts"

function createBufferWriter() {
  let buffer = ""
  return {
    write(text: string) {
      buffer += text
    },
    read() {
      return buffer
    },
    isTTY: false,
  }
}

describe("cli chunk delivery helper", () => {
  it("writes text chunks to stdout", () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    const handleChunk = createCliChunkDeliveryHandler({ stdout, stderr })

    handleChunk({ type: "text", delta: "Hello" })

    expect(stdout.read()).toBe("Hello")
    expect(stderr.read()).toBe("")
  })

  it("writes tool lifecycle messages to stderr", () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    const handleChunk = createCliChunkDeliveryHandler({ stdout, stderr })

    handleChunk({ type: "tool_start", toolName: "screen_capture", params: { full: true } })
    handleChunk({ type: "tool_end", toolName: "screen_capture", success: true, output: "ok" })

    expect(stderr.read()).toContain("screen_capture")
    expect(stderr.read()).toContain("✓")
  })

  it("writes errors to stderr", () => {
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()
    const handleChunk = createCliChunkDeliveryHandler({ stdout, stderr })

    handleChunk({ type: "error", message: "failure" })

    expect(stderr.read()).toContain("Error: failure")
  })
})
