/**
 * The one place the UI imports the engine and the content modules from. Swap these two lines to
 * run the UI against a stand-in while either side is being rewritten.
 */
export { engine } from '../engine/index.ts'
import * as contentModule from '../content/index.ts'

export const contentSource = contentModule as unknown as Record<string, unknown>
