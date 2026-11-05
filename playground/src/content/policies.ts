/**
 * Plain-language descriptions of the 11 policies, for the rule editor, the policy picker and the
 * trace. Behaviour follows contracts/policies/*.sol; pitfalls follow the README's limitations.
 */
import type { PolicyName } from '../engine/types.ts'
import type { PolicyInfo } from './types.ts'

export const POLICIES: Record<PolicyName, PolicyInfo> = {
  AllowPolicy: {
    name: 'AllowPolicy',
    label: 'Always Allow',
    oneLiner: 'Lets every matching call through.',
    plain:
      'Passes every call that reaches its rule, from owners and modules alike. It reads nothing: not the amount, not the recipient, not the calldata. Use it where the rule itself is the whole decision.',
    paths: 'both',
    configHelp: 'No settings.',
    stateful: false,
    pitfalls: [
      'On the catch-all it allows everything without a rule of its own, including changes to owners, threshold, modules and guards.',
      'On the empty selector it also passes calldata of four zero bytes, which can run a contract fallback.',
      'Enabled modules pass it too, with no signatures at all.'
    ],
    placement: 'Any rule, including either catch-all.'
  },
  DenyPolicy: {
    name: 'DenyPolicy',
    label: 'Always Deny',
    oneLiner: 'Refuses every matching call.',
    plain:
      'Closes one door for good. On an exact rule it wins over a permissive catch-all, because an exact rule is always found first. Removing a rule is not the same: a removed rule falls back to the catch-all.',
    paths: 'both',
    configHelp: 'No settings.',
    stateful: false,
    pitfalls: [
      'It blocks one function on one contract, not an outcome. WETH wraps ETH sent with no calldata, which never reaches a deny rule on deposit.',
      'It refuses approvals of zero too, so it cannot be used to allow revokes only.',
      'On a catch-all it is the same as having no catch-all.'
    ],
    placement: 'Any rule. Most useful on exact rules under a permissive catch-all.'
  },
  OneTimeAllowPolicy: {
    name: 'OneTimeAllowPolicy',
    label: 'One-Time Pass',
    oneLiner: 'Lets one matching call through, then refuses.',
    plain:
      'The pass belongs to the rule, not to a recipient or an amount: the first call that matches uses it up, whatever it does. If that transaction fails, the pass is not used. Granting it again is a rule change, so it goes through the waiting period.',
    paths: 'both',
    configHelp: 'Granted: on gives one use. Off cancels an unused one.',
    stateful: true,
    pitfalls: [
      'On a catch-all, the single use goes to whichever call comes first.',
      'It does not read calldata: on the empty selector it also passes four zero bytes.',
      'A token that returns false instead of failing still counts as a success, so the pass is used although nothing moved.'
    ],
    placement: 'Any rule.'
  },
  AllowedModulePolicy: {
    name: 'AllowedModulePolicy',
    label: 'Module Allowlist',
    oneLiner: 'Lets listed modules through and refuses owners.',
    plain:
      'Checks which module sent the transaction, using the identity the guard itself provides, which no one can fake. Owner transactions come from no module, so this rule always refuses them. It does not look at what the module does: amounts and recipients are up to the module.',
    paths: 'both',
    configHelp: 'Pick a module and whether it is allowed. Allowed off removes a module that was allowed before.',
    stateful: false,
    pitfalls: [
      'Owners are always refused on this rule. If owners need the same call, they cannot share the rule.',
      'The module list is shared by every rule that uses this policy: a module allowed on one rule is allowed on all of them.',
      'The list survives removing the rule. Revoke a module explicitly.'
    ],
    placement: 'Any rule. It only ever passes module transactions.'
  },
  NativeTransferPolicy: {
    name: 'NativeTransferPolicy',
    label: 'Plain ETH Transfer',
    oneLiner: 'Lets plain ETH through: some value, no calldata.',
    plain:
      'Allows a CALL that moves ETH and carries no calldata at all. Put it on one recipient with the empty selector to let that address receive ETH. It is the only policy that tells empty calldata from four zero bytes.',
    paths: 'both',
    configHelp: 'No settings. The rule must use the empty selector (none) and CALL, or it is not accepted.',
    stateful: false,
    pitfalls: [
      'On the CALL catch-all it allows any amount of ETH to any address, the zero address included.',
      'A transfer of 0 ETH is refused.',
      'It does not limit the amount.'
    ],
    placement: 'Only on the empty selector (none) with CALL: one recipient, or the CALL catch-all.'
  },
  ERC20TransferPolicy: {
    name: 'ERC20TransferPolicy',
    label: 'Recipient Allowlist',
    oneLiner: 'Only lets tokens go to people you list.',
    plain:
      'Reads the recipient of a token transfer and checks it against a list kept for that token. Each recipient is ALWAYS, for any number of payments, or ONCE, for one payment after which they drop off the list. It does not limit amounts.',
    paths: 'both',
    configHelp: 'Add recipients and pick ALWAYS or ONCE for each. NONE takes a recipient off the list.',
    stateful: true,
    pitfalls: [
      'The list belongs to the token, not the rule: rules on transfer and transferFrom of the same token share one list.',
      'ALWAYS means any amount, any number of times.',
      'It does not check who sends the transaction, so enabled modules can pay listed recipients too.',
      'With transferFrom it checks where the tokens go, not whose tokens they are.'
    ],
    placement: 'Only on transfer or transferFrom of one token, with CALL.'
  },
  ERC20ApprovePolicy: {
    name: 'ERC20ApprovePolicy',
    label: 'Spender Allowlist',
    oneLiner: 'Only lets listed spenders be approved. Revokes always pass.',
    plain:
      "Controls who may be approved to spend the Safe's tokens. Each spender is ALWAYS or ONCE. An approval of zero, a revoke, passes for any spender and uses up nothing, so cleaning up never waits for a rule change.",
    paths: 'both',
    configHelp: 'Add spenders and pick ALWAYS or ONCE for each. NONE takes a spender off the list. An empty list allows revokes only.',
    stateful: true,
    pitfalls: [
      'It does not limit the approved amount.',
      'Any spender can be revoked, whatever the list says.',
      'Enabled modules can approve listed spenders too.'
    ],
    placement: 'Only on approve of one token, with CALL.'
  },
  MultiSendPolicy: {
    name: 'MultiSendPolicy',
    label: 'Batch Checker',
    oneLiner: 'Opens a batch and checks every step against your rules.',
    plain:
      'A batch runs as one DELEGATECALL to MultiSend. This policy unpacks it and sends each step through the rule table, as if each were sent alone. Every step is checked before any of them runs, and one refused step refuses the whole batch.',
    paths: 'both',
    configHelp: 'No settings. The rule must be multiSend on MultiSend with DELEGATECALL, or it is not accepted.',
    stateful: false,
    pitfalls: [
      'Each step needs a rule of its own. The batch rule only opens the batch.',
      'Steps are checked against the Safe as it was before the batch. A threshold change or newly applied rules inside the batch do not count for the other steps.',
      'Signatures and attestations are matched to steps by position. To give one only to the last step, pad the earlier ones.',
      'A batch cannot repeat the same step if that step needs a co-signature, extra signatures or an attestation.'
    ],
    placement: 'Only on multiSend of MultiSend, with DELEGATECALL.'
  },
  CoSignerPolicy: {
    name: 'CoSignerPolicy',
    label: 'Co-Signer',
    oneLiner: 'Needs a signature from your co-signer service.',
    plain:
      'The co-signer, often an automated service, signs the exact transaction at its nonce. The signature travels with the owner signatures and works once. In a batch, the co-signer signs each step, not the batch.',
    paths: 'owner-only',
    configHelp: 'Pick the co-signer address. Each rule has its own co-signer.',
    stateful: true,
    pitfalls: [
      'Module transactions cannot carry a co-signature, so they are always refused.',
      'A signature over a whole batch does not count for its steps.',
      'A batch cannot repeat the same co-signed step: the second one is refused.',
      'On an exact rule it replaces the catch-all for that call. Nothing else is checked.'
    ],
    placement: 'Any rule. Commonly the CALL catch-all.'
  },
  IncreasedThresholdPolicy: {
    name: 'IncreasedThresholdPolicy',
    label: 'Extra Owner Signatures',
    oneLiner: "Needs more owner signatures than the Safe's threshold.",
    plain:
      'Asks for every owner except a set number who may be absent, and never fewer than the threshold plus one. The extra signatures travel with the transaction and work once. Use it to put sensitive calls behind more owners.',
    paths: 'owner-only',
    configHelp:
      'Max absent: how many owners may be missing. 0 means every owner must sign. The result is never below threshold + 1 nor above the number of owners.',
    stateful: true,
    pitfalls: [
      'Module transactions carry no signatures, so they are always refused.',
      'In a batch it reads the threshold and owners from before the batch. Change them in a transaction of their own.',
      'On a Safe that already needs every owner, it adds nothing: it cannot ask for more owners than there are.'
    ],
    placement: 'Any rule.'
  },
  SafenetPolicy: {
    name: 'SafenetPolicy',
    label: 'Safenet Attestation',
    oneLiner: 'Needs an attestation from the Safenet validators.',
    plain:
      'The Safenet validators review a transaction and sign an attestation with a shared key. The policy checks that the key is trusted and that the attestation matches this exact transaction. Each Safe nonce can use one attestation.',
    paths: 'owner-only',
    configHelp: 'No settings. The trusted keys live in the policy contract itself.',
    stateful: true,
    pitfalls: [
      'Module transactions cannot carry an attestation, so they are always refused.',
      'Only one Safenet-checked step fits in a transaction: a batch with two fails on the second.',
      'Best placed on the catch-alls, not inside batches.'
    ],
    placement: 'Any rule. Best on the CALL and DELEGATECALL catch-alls.'
  }
}
