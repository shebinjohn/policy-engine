/**
 * The one switch between the real engine/content and the dev mocks. Everything in the UI imports
 * the engine and the content modules through this file.
 */
import type { EngineApi } from '../engine/types.ts'
import * as engineModule from './dev/mockEngine.ts'
import * as contentModule from './dev/mockContent.ts'

type EngineModule = Partial<EngineApi> & { engine?: EngineApi; default?: EngineApi }
const em = engineModule as unknown as EngineModule

/** The engine, whether index.ts exports `engine`, a default, or the API functions themselves. */
export const engine: EngineApi = em.engine ?? em.default ?? (em as EngineApi)

export const contentSource = contentModule as unknown as Record<string, unknown>
