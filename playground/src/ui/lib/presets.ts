/** Sandbox presets and example transactions. UI-owned data; names come from the address book (SPEC §2). */
import type { SetupSpec, TxSpec } from '../../engine/types.ts'

export interface Preset {
  id: string
  label: string
  blurb: string
  setup: SetupSpec
  /** The transaction prepared in the builder after a reset. */
  tx: TxSpec
}

const BALANCES = { ETH: '12', USDC: '250000', SAFE: '40000', WETH: '5' }

const PAY_MALLORY: TxSpec = {
  label: 'Send 5,000 USDC to Mallory',
  to: 'USDC',
  call: { fn: 'transfer', args: ['Mallory', '5000'] },
  signers: ['Alice', 'Bob']
}

const PAY_DAVE: TxSpec = {
  label: 'Pay Dave 1,200 USDC',
  to: 'USDC',
  call: { fn: 'transfer', args: ['Dave', '1200'] },
  signers: ['Alice', 'Bob']
}

export const PRESETS: Preset[] = [
  {
    id: 'example',
    label: 'Example treasury',
    blurb: 'Both guards on and five rules: pay the vendor any time, the contractor once, batches checked step by step, everything else needs the co-signer.',
    setup: {
      owners: ['Alice', 'Bob', 'Carol'],
      threshold: 2,
      modules: ['AllowanceModule'],
      balances: BALANCES,
      rules: [
        {
          target: 'USDC',
          selector: 'transfer',
          policy: 'ERC20TransferPolicy',
          config: {
            recipients: [
              { account: 'Dave', permission: 'ALWAYS' },
              { account: 'Erin', permission: 'ONCE' }
            ]
          },
          note: 'Pay the vendor any time, the contractor once'
        },
        { target: 'Dave', selector: 'none', policy: 'NativeTransferPolicy', note: 'Plain ETH to the vendor' },
        { target: 'SAFE', selector: 'transfer', policy: 'AllowedModulePolicy', config: { module: 'AllowanceModule', allowed: true } },
        { target: 'MultiSend', selector: 'multiSend', operation: 'DELEGATECALL', policy: 'MultiSendPolicy' },
        { fallback: 'CALL', operation: 'CALL', policy: 'CoSignerPolicy', config: { cosigner: 'CoSigner' } }
      ]
    },
    tx: PAY_MALLORY
  },
  {
    id: 'fresh',
    label: 'Fresh hardened Safe',
    blurb: 'Both guards on and no rules yet. Deny by default: every transaction is blocked until you add a rule.',
    setup: { owners: ['Alice', 'Bob', 'Carol'], threshold: 2, modules: ['AllowanceModule'], balances: BALANCES, rules: [] },
    tx: PAY_DAVE
  },
  {
    id: 'no-guard',
    label: 'No guard',
    blurb: 'A plain Safe. Nothing checks transactions, so any 2 owners can do anything. Rules can be set immediately.',
    setup: {
      owners: ['Alice', 'Bob', 'Carol'],
      threshold: 2,
      modules: ['AllowanceModule'],
      balances: BALANCES,
      guards: { transaction: false, module: false }
    },
    tx: PAY_MALLORY
  },
  {
    id: 'tx-guard-only',
    label: 'Only the transaction guard',
    blurb: 'Owner transactions are checked, module transactions are not. The Allowance Module can bypass every rule.',
    setup: {
      owners: ['Alice', 'Bob', 'Carol'],
      threshold: 2,
      modules: ['AllowanceModule'],
      balances: BALANCES,
      rules: [
        {
          target: 'USDC',
          selector: 'transfer',
          policy: 'ERC20TransferPolicy',
          config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] }
        }
      ],
      guards: { transaction: true, module: false }
    },
    tx: { label: 'Allowance Module sends 5,000 USDC to Mallory', path: 'module', module: 'AllowanceModule', to: 'USDC', call: { fn: 'transfer', args: ['Mallory', '5000'] } }
  },
  {
    id: 'module-guard-only',
    label: 'Only the module guard',
    blurb: 'Module transactions are checked, owner transactions are not. Any 2 owners can still do anything.',
    setup: {
      owners: ['Alice', 'Bob', 'Carol'],
      threshold: 2,
      modules: ['AllowanceModule'],
      balances: BALANCES,
      rules: [
        {
          target: 'USDC',
          selector: 'transfer',
          policy: 'ERC20TransferPolicy',
          config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] }
        }
      ],
      guards: { transaction: false, module: true }
    },
    tx: PAY_MALLORY
  }
]

export interface Example {
  id: string
  label: string
  tx: TxSpec
}

/** Quick picks in the transaction builder. Chosen to show one idea each on the example treasury. */
export const EXAMPLES: Example[] = [
  { id: 'pay-dave', label: 'Pay Dave', tx: PAY_DAVE },
  { id: 'pay-mallory', label: 'Pay Mallory', tx: PAY_MALLORY },
  { id: 'pay-erin', label: 'Pay Erin (once)', tx: { label: 'Pay Erin 800 USDC', to: 'USDC', call: { fn: 'transfer', args: ['Erin', '800'] }, signers: ['Alice', 'Bob'] } },
  { id: 'eth-dave', label: 'Send ETH to Dave', tx: { label: 'Send 1 ETH to Dave', to: 'Dave', value: '1', signers: ['Alice', 'Bob'] } },
  {
    id: 'module-safe',
    label: 'Module pays in SAFE',
    tx: { label: 'Allowance Module sends 100 SAFE to Erin', path: 'module', module: 'AllowanceModule', to: 'SAFE', call: { fn: 'transfer', args: ['Erin', '100'] } }
  },
  {
    id: 'batch',
    label: 'Batch payroll',
    tx: {
      label: 'Batch: pay Dave and Erin',
      to: 'MultiSend',
      operation: 'DELEGATECALL',
      signers: ['Alice', 'Bob'],
      call: {
        fn: 'multiSend',
        batch: [
          { to: 'USDC', call: { fn: 'transfer', args: ['Dave', '500'] } },
          { to: 'USDC', call: { fn: 'transfer', args: ['Erin', '300'] } }
        ]
      }
    }
  },
  { id: 'remove-guard', label: 'Remove the guard', tx: { label: 'Remove the transaction guard', to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] }, signers: ['Alice', 'Bob'] } },
  {
    id: 'remove-guard-cosigned',
    label: 'Remove the guard, co-signed',
    tx: {
      label: 'Remove the transaction guard, co-signed',
      to: 'Safe',
      call: { fn: 'setGuard', args: ['Zero'] },
      signers: ['Alice', 'Bob'],
      context: { type: 'cosignature', signer: 'CoSigner', over: 'self' }
    }
  },
  { id: 'wrap', label: 'Wrap ETH', tx: { label: 'Wrap 1 ETH into WETH', to: 'WETH', value: '1', call: { fn: 'deposit' }, signers: ['Alice', 'Bob'] } }
]
