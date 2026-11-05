/**
 * The only place the harness reaches into the policy-engine checkout.
 *
 * Everything the harness needs from the Hardhat project (the running Hardhat runtime, its ethers,
 * the network helpers, `src/utils.ts`, the `test/deploy` helpers, `test/utils/frost.ts` and the Safe
 * 1.5.0 artifacts) is loaded here with a `require` rooted at the policy-engine checkout, never with a
 * bare import from this directory. Two reasons:
 *
 * 1. Module identity. `playground/node_modules` has its own `ethers`; a bare `import 'ethers'` from
 *    here would load that copy instead of the one Hardhat uses.
 * 2. Portability. In a standalone playground repository the checkout is a git submodule (or any
 *    path), not `../..`. Point `POLICY_ENGINE_ROOT` at it, or rely on the search below.
 *
 * The root is, in order: `$POLICY_ENGINE_ROOT`; the nearest ancestor of this directory that is a
 * policy-engine checkout; the nearest ancestor of the working directory (Hardhat's project root
 * when run with `npx hardhat test`); `../policy-engine` next to this directory (submodule layout).
 */
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'

function isPolicyEngineRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'hardhat.config.ts')) &&
    fs.existsSync(path.join(dir, 'contracts', 'SafePolicyGuard.sol')) &&
    fs.existsSync(path.join(dir, 'src', 'utils.ts'))
  )
}

function ancestors(dir: string): string[] {
  const out: string[] = []
  let current = path.resolve(dir)
  for (;;) {
    out.push(current)
    const parent = path.dirname(current)
    if (parent === current) return out
    current = parent
  }
}

function findRoot(): string {
  const fromEnv = process.env.POLICY_ENGINE_ROOT
  if (fromEnv) {
    const resolved = path.resolve(fromEnv)
    if (!isPolicyEngineRoot(resolved)) {
      throw new Error(`POLICY_ENGINE_ROOT=${fromEnv} is not a policy-engine checkout (no hardhat.config.ts, contracts/SafePolicyGuard.sol, src/utils.ts)`)
    }
    return resolved
  }
  const candidates = [
    ...ancestors(__dirname),
    ...ancestors(process.cwd()),
    path.resolve(__dirname, '..', 'policy-engine'),
    path.resolve(__dirname, '..', 'lib', 'policy-engine')
  ]
  for (const candidate of candidates) {
    if (isPolicyEngineRoot(candidate)) return candidate
  }
  throw new Error('policy-engine checkout not found: set POLICY_ENGINE_ROOT to its path (see conformance/README.md)')
}

export const POLICY_ENGINE_ROOT = findRoot()

const rootRequire = createRequire(path.join(POLICY_ENGINE_ROOT, 'package.json'))

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The running Hardhat runtime environment (the same instance `npx hardhat test` created). */
export const hre: any = rootRequire('hardhat')

// The engine's clock moves only on `wait` steps; transactions in between share one `now`. Hardhat
// mines every block at least one second after the previous one unless the network allows equal
// timestamps. The provider is created lazily from this config object, so opting in here (before
// the first RPC call, for this process only) lets the harness mine each transaction exactly
// `wait` seconds after the previous one. `deployBase` checks that it took effect and otherwise
// falls back to one second per transaction (see README "Time").
if (hre.network?.name === 'hardhat' && hre.config?.networks?.hardhat) {
  hre.config.networks.hardhat.allowBlocksWithSameTimestamp = true
}

/** Hardhat's ethers: the full ethers v6 namespace plus `provider`, `getSigners`, `getContractFactory`. */
export const ethers: typeof import('ethers') & {
  provider: any
  getSigners(): Promise<any[]>
  getContractFactory(nameOrAbi: any, bytecode?: string, signer?: any): Promise<any>
} = hre.ethers

/** `@nomicfoundation/hardhat-network-helpers` (time, takeSnapshot, setBalance, setStorageAt). */
export const helpers: any = rootRequire('@nomicfoundation/hardhat-network-helpers')

/** The policy-engine's `src/utils.ts`: Safe signing, MultiSend packing, configuration roots. */
export const utils: any = rootRequire('./src/utils')

/** The policy-engine's `test/deploy` helpers (CREATE2-deterministic deployments). */
export const deployers: any = rootRequire('./test/deploy')

/** The deterministic CREATE2 deployment helper behind `test/deploy`. */
export const create2: any = rootRequire('./test/deploy/util/create2')

/** The policy-engine's `test/utils/frost.ts` (single-participant FROST signing for SafenetPolicy). */
export const frost: any = rootRequire('./test/utils/frost')

/** Loads a Safe 1.5.0 build artifact, e.g. `libraries/MultiSendCallOnly.sol/MultiSendCallOnly.json`. */
export function safeArtifact(relative: string): { abi: any[]; bytecode: string } {
  return rootRequire(`@safe-global/safe-smart-account/build/artifacts/contracts/${relative}`)
}

/** Loads a Hardhat artifact of the policy-engine (for its ABI), e.g. `policies/AllowPolicy.sol/AllowPolicy.json`. */
export function engineArtifact(relative: string): { abi: any[]; bytecode: string } {
  const file = path.join(POLICY_ENGINE_ROOT, 'artifacts', 'contracts', relative)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
