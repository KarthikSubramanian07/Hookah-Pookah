/// <reference lib="webworker" />
import { createHandler } from './handler.ts'
import type { ToWorker } from './protocol.ts'

const scope = self as unknown as DedicatedWorkerGlobalScope
const handle = createHandler((msg) => scope.postMessage(msg))
scope.onmessage = (event: MessageEvent<ToWorker>) => void handle(event.data)
