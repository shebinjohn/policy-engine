/**
 * contracts/policies/AllowedModulePolicy.sol: `$allowedModules[guard][safe][module]`, NOT keyed
 * by access selector, so the allowlist survives the policy being detached and re-attached.
 */
import { ZERO, eqAddr, shortLabel } from '../book.ts'
import { revert } from '../errors.ts'
import { T } from '../messages.ts'
import { emit, fail, stateOf, strictDecode, type PolicyImpl } from './common.ts'

interface State {
  allowed: Record<string, true>
}

const init = (): State => ({ allowed: {} })

export const AllowedModulePolicy: PolicyImpl = {
  name: 'AllowedModulePolicy',
  configure(w, _access, data) {
    const [module, allowed] = strictDecode(['address', 'bool'], data)
    if (eqAddr(module, ZERO)) {
      revert('InvalidModule', { message: 'The Module Allowlist needs a module address, not the zero address.' })
    }
    const s = stateOf(w, 'AllowedModulePolicy', init)
    if (allowed) s.allowed[module] = true
    else delete s.allowed[module]
    return true
  },
  check(ctx, a) {
    if (ctx.module === null) {
      fail(ctx, a, 'AllowedModulePolicy', { title: T.moduleOwnerPath }, { error: 'InvalidModule' })
    }
    const s = stateOf(ctx.w, 'AllowedModulePolicy', init)
    const m = shortLabel(ctx.w, ctx.module)
    const ok = Object.keys(s.allowed).some((k) => eqAddr(k, ctx.module))
    if (!ok) fail(ctx, a, 'AllowedModulePolicy', { title: T.moduleNotAllowed(m) }, { error: 'UnauthorizedModule' })
    emit(ctx, a, 'AllowedModulePolicy', { status: 'pass', title: T.moduleAllowed(m) })
    return true
  }
}
