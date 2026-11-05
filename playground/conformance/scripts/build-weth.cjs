#!/usr/bin/env node
/**
 * Compiles conformance/contracts/WETH9.sol with solc-js and writes conformance/artifacts/WETH9.json
 * ({ contractName, abi, bytecode, compiler }). The artifact is checked in so the harness never needs
 * a compiler at test time; run this only after editing WETH9.sol.
 *
 *   node playground/conformance/scripts/build-weth.cjs            (from a policy-engine checkout)
 *   POLICY_ENGINE_ROOT=policy-engine node conformance/scripts/build-weth.cjs   (standalone repo)
 *
 * solc-js is resolved from this directory first, then from the policy-engine checkout (Hardhat
 * pulls it in as a dependency).
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const here = path.resolve(__dirname, '..')
const roots = [here, process.env.POLICY_ENGINE_ROOT, path.resolve(here, '..', '..'), path.resolve(here, '..', 'policy-engine')]
  .filter(Boolean)
  .map((p) => path.resolve(p))

let solc
for (const root of roots) {
  try {
    solc = createRequire(path.join(root, 'package.json'))('solc')
    break
  } catch {
    // try the next root
  }
}
if (!solc) {
  console.error('solc-js not found; install it (npm i -D solc) or set POLICY_ENGINE_ROOT')
  process.exit(1)
}

const source = fs.readFileSync(path.join(here, 'contracts', 'WETH9.sol'), 'utf8')
const input = {
  language: 'Solidity',
  sources: { 'WETH9.sol': { content: source } },
  settings: {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((e) => e.severity === 'error')
if (errors.length > 0) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}
const contract = output.contracts['WETH9.sol'].WETH9
const artifact = {
  contractName: 'WETH9',
  sourceName: 'playground/conformance/contracts/WETH9.sol',
  compiler: `solc-js ${solc.version()}`,
  settings: input.settings,
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`
}
fs.mkdirSync(path.join(here, 'artifacts'), { recursive: true })
fs.writeFileSync(path.join(here, 'artifacts', 'WETH9.json'), JSON.stringify(artifact, null, 2) + '\n')
console.log(`wrote artifacts/WETH9.json (${solc.version()})`)
