/**
 * contracts/policies/OneTimeAllowPolicy.sol: `$grants[guard][safe][access]`, keyed by the access
 * selector the engine resolved (the fallback key when the fallback matched).
 */
import { describeAccess, T } from '../messages.ts'
import { fail, emit, stage, stateOf, strictDecode, type PolicyImpl } from './common.ts'

interface State {
  grants: Record<string, true>
}

const init = (): State => ({ grants: {} })

export const OneTimeAllowPolicy: PolicyImpl = {
  name: 'OneTimeAllowPolicy',
  configure(w, access, data) {
    const [granted] = strictDecode(['bool'], data)
    const s = stateOf(w, 'OneTimeAllowPolicy', init)
    if (granted) s.grants[access] = true
    else delete s.grants[access]
    return true
  },
  check(ctx, a) {
    const s = stateOf(ctx.w, 'OneTimeAllowPolicy', init)
    const what = describeAccess(ctx.w, a.access)
    if (!s.grants[a.access]) {
      fail(ctx, a, 'OneTimeAllowPolicy', { title: T.oneTimeFail(what) }, { error: 'Unauthorized' })
    }
    delete s.grants[a.access]
    emit(ctx, a, 'OneTimeAllowPolicy', { status: 'pass', title: T.oneTimePass, tech: `grant for access ${a.access}` })
    stage(ctx, a, 'OneTimeAllowPolicy', T.oneTimeState(what), `delete $grants[guard][safe][${a.access}]`)
    return true
  }
}
