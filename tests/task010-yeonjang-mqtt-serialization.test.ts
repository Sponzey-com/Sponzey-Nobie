import { describe, expect, it } from "vitest"
import {
  enqueueYeonjangExtensionExecution,
  shouldSerializeYeonjangMethod,
} from "../packages/core/src/yeonjang/mqtt-client.ts"

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

describe("yeonjang mqtt serialization", () => {
  it("serializes same-extension executions to prevent action interleaving", async () => {
    const gate = createDeferred<void>()
    const order: string[] = []

    const first = enqueueYeonjangExtensionExecution("yeonjang-main", async () => {
      order.push("start-1")
      await gate.promise
      order.push("end-1")
      return "first"
    })
    const second = enqueueYeonjangExtensionExecution("yeonjang-main", async () => {
      order.push("start-2")
      order.push("end-2")
      return "second"
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(["start-1"])

    gate.resolve()

    await expect(first).resolves.toBe("first")
    await expect(second).resolves.toBe("second")
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"])
  })

  it("allows different extensions to run independently", async () => {
    const gate = createDeferred<void>()
    const order: string[] = []

    const first = enqueueYeonjangExtensionExecution("yeonjang-a", async () => {
      order.push("a:start")
      await gate.promise
      order.push("a:end")
      return "a"
    })
    const second = enqueueYeonjangExtensionExecution("yeonjang-b", async () => {
      order.push("b:start")
      order.push("b:end")
      return "b"
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(["a:start", "b:start", "b:end"])

    gate.resolve()
    await Promise.all([first, second])
  })

  it("keeps read-only yeonjang methods outside the serialization queue", () => {
    expect(shouldSerializeYeonjangMethod("node.capabilities")).toBe(false)
    expect(shouldSerializeYeonjangMethod("camera.list")).toBe(false)
    expect(shouldSerializeYeonjangMethod("mouse.action")).toBe(true)
    expect(shouldSerializeYeonjangMethod("keyboard.action")).toBe(true)
    expect(shouldSerializeYeonjangMethod("system.exec")).toBe(true)
  })
})
