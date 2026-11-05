/**
 * Glossary of the terms the playground, its scenarios and its challenges use. Plain first; `tech`
 * gives the contract-level name for engineers.
 */
import type { Term } from './types.ts'

export const GLOSSARY: Term[] = [
  {
    term: 'Safe',
    plain: 'A smart account that holds funds and runs a transaction only when enough of its owners sign it.',
    tech: 'Safe 1.5.0 smart account. In the playground, the Treasury Safe.'
  },
  {
    term: 'Owner',
    plain: 'A person or key allowed to sign for the Safe.',
    tech: 'OwnerManager.getOwners()'
  },
  {
    term: 'Threshold',
    plain: 'How many owners must sign before the Safe runs a transaction, for example two of three.',
    tech: 'OwnerManager.getThreshold()'
  },
  {
    term: 'Owner Signature',
    plain: "An owner's approval of one exact transaction. Any change to the transaction makes the signature invalid.",
    tech: 'ECDSA signature over the EIP-712 Safe transaction hash, checked by Safe.checkSignatures.'
  },
  {
    term: 'Nonce',
    plain: "The Safe's transaction counter. Each owner transaction uses the next number, so a signed transaction can run only once.",
    tech: 'Safe.nonce(), incremented before the guard is called; policies use nonce - 1.'
  },
  {
    term: 'Transaction Hash',
    plain: 'A fingerprint of one exact transaction at one nonce. Owners, co-signers and Safenet sign this fingerprint.',
    tech: 'Safe.getTransactionHash(to, value, data, operation, 0, 0, 0, 0x0, 0x0, nonce)'
  },
  {
    term: 'Module',
    plain:
      'An add-on contract the Safe trusts to send transactions without owner signatures, such as an Allowance Module that pays set amounts.',
    tech: 'execTransactionFromModule, enabled with ModuleManager.enableModule.'
  },
  {
    term: 'Owner Path',
    plain: 'A transaction signed by the owners and sent through the Safe the normal way.',
    tech: 'Safe.execTransaction, checked by the transaction guard with module = address(0).'
  },
  {
    term: 'Module Path',
    plain: 'A transaction sent by an enabled module, with no owner signatures and no room for extra signatures.',
    tech: 'Safe.execTransactionFromModule, checked by the module guard with module = the sender.'
  },
  {
    term: 'Guard',
    plain: 'A contract the Safe asks before every transaction. If the guard says no, the transaction does not run.',
    tech: 'Safe transaction guard or module guard.'
  },
  {
    term: 'Transaction Guard',
    plain: 'The guard that checks transactions signed by the owners.',
    tech: 'Set with setGuard; called from Safe.execTransaction.'
  },
  {
    term: 'Module Guard',
    plain: 'The guard that checks transactions sent by modules.',
    tech: 'Set with setModuleGuard; called from execTransactionFromModule.'
  },
  {
    term: 'Policy Guard',
    plain:
      'The guard behind Safe{Policies}. It must be installed as both the transaction guard and the module guard, so every transaction, owner or module, is checked against the rules.',
    tech: 'SafePolicyGuard, which inherits PolicyEngine.'
  },
  {
    term: 'Policy Engine',
    plain: 'The part of the Policy Guard that finds the rule for a transaction and asks its policy.',
    tech: 'PolicyEngine.checkTransaction and getPolicy.'
  },
  {
    term: 'Hardening',
    plain:
      'Setting up the rules while no guard is installed, then installing the Policy Guard in both slots: the module guard first, or both in one batch. After that, rules change only through the waiting period.',
    tech: 'configureImmediately, then setModuleGuard before setGuard. Once the transaction guard is set, a separate setModuleGuard is a checked call and needs a rule.'
  },
  {
    term: 'Policy',
    plain: 'A small contract that decides yes or no for the calls its rule covers. Exactly one policy decides each call.',
    tech: 'IPolicy.checkTransaction returns the magic value to allow; anything else denies.'
  },
  {
    term: 'Rule',
    plain: 'One line of the rule table: a contract, a function and an operation, and the policy that decides those calls.',
    tech: 'SafePolicyGuard.Configuration { target, selector, operation, policy, data }'
  },
  {
    term: 'Exact Rule',
    plain: 'A rule for one specific contract, function and operation. It is always checked before the catch-all.',
    tech: 'Access selector with a non-zero target or selector.'
  },
  {
    term: 'Catch-All Rule',
    plain:
      'The rule that decides any call with no rule of its own. There are two: one for CALL and one for DELEGATECALL. With no catch-all, unlisted calls are denied.',
    tech: 'Fallback access selector: operation << 216, target address(0), selector 0x00000000.'
  },
  {
    term: 'Access Selector',
    plain: 'The key the engine looks up in the rule table: function, operation and target, packed into one value.',
    tech: '32 bytes: selector (4) | operation (1) | 7 zero bytes | target (20).'
  },
  {
    term: 'Deny by Default',
    plain: 'Anything without a rule is refused. You list what may happen, not what may not.',
    tech: 'AccessDenied(address(0)) when neither the exact key nor the catch-all has a policy.'
  },
  {
    term: 'Operation',
    plain: 'How the Safe makes a call: CALL or DELEGATECALL. The same contract and function under a different operation is a different rule.',
    tech: 'Enum.Operation: 0 = CALL, 1 = DELEGATECALL.'
  },
  {
    term: 'CALL',
    plain: 'A normal call: the target runs its own code with its own storage. Sending tokens or ETH is a CALL.',
    tech: 'Operation 0.'
  },
  {
    term: 'DELEGATECALL',
    plain:
      "The Safe borrows another contract's code and runs it as if it were its own, with full control of the Safe. Batches use it; unknown code must never get it.",
    tech: 'Operation 1.'
  },
  {
    term: 'Calldata',
    plain: 'The data sent with a call: which function to run, and with what values. A plain ETH transfer has none.',
    tech: 'The data field of the Safe transaction.'
  },
  {
    term: 'Function Selector',
    plain: 'The first four bytes of calldata, which name the function being called.',
    tech: "bytes4(keccak256('transfer(address,uint256)')) = 0xa9059cbb"
  },
  {
    term: 'Selector Zero',
    plain:
      'The key for calls that name no function. Empty calldata and calldata starting with four zero bytes both land on it, so only a policy that checks for empty calldata tells them apart.',
    tech: '0x00000000; the rule editor writes it as none.'
  },
  {
    term: 'Fallback Function',
    plain:
      'Code a contract runs when a call names no function it knows. WETH uses it to wrap any ETH it receives.',
    tech: 'Solidity fallback or receive; WETH9 calls deposit() from it.'
  },
  {
    term: 'Batch',
    plain: 'Several transactions bundled into one, signed once and run in order. If one step fails, the whole batch is undone.',
    tech: 'MultiSendCallOnly.multiSend(bytes), called with DELEGATECALL.'
  },
  {
    term: 'MultiSend',
    plain: 'The contract the Safe uses to run a batch. With the Policy Guard, a batch needs a rule for MultiSend and a rule for each step.',
    tech: 'Safe 1.5.0 MultiSendCallOnly; checked by MultiSendPolicy.'
  },
  {
    term: 'Step',
    plain: 'One transaction inside a batch. Each step is checked on its own, as if it were sent alone.',
    tech: 'MultiSend sub-transaction: operation, to, value, data.'
  },
  {
    term: 'Co-Signer',
    plain:
      'A second opinion, often an automated service, that must sign a transaction on top of the owners. It signs each transaction, and each step of a batch.',
    tech: 'CoSignerPolicy: ECDSA or ERC-1271 signature over the transaction hash, carried in the context.'
  },
  {
    term: 'Context',
    plain:
      'Extra proof sent along with a transaction, such as a co-signature, extra owner signatures or a Safenet attestation. Only owner transactions can carry it.',
    tech: 'SignatureExtension envelope at the end of the Safe signatures; empty on the module path.'
  },
  {
    term: 'Safenet',
    plain: 'A network of validators that review Safe transactions and attest to the ones they approve.',
    tech: 'safe-research/safenet; FROST threshold signatures checked by SafenetPolicy.'
  },
  {
    term: 'Attestation',
    plain: "The Safenet validators' joint signature saying they approve one exact transaction.",
    tech: 'FROST Schnorr signature over the transaction proposal, bound to the Safe transaction hash.'
  },
  {
    term: 'Allowlist',
    plain: 'A list of who may receive tokens or be approved to spend them. Anyone not on it is refused.',
    tech: 'ERC20TransferPolicy recipients, ERC20ApprovePolicy spenders, AllowedModulePolicy modules.'
  },
  {
    term: 'ALWAYS and ONCE',
    plain: 'Permissions on an allowlist. ALWAYS stays until removed. ONCE is used up by the first payment or approval that uses it.',
    tech: 'Permission enum: NONE = 0, ONCE = 1, ALWAYS = 2.'
  },
  {
    term: 'One-Time Pass',
    plain: 'A rule that lets exactly one matching transaction through, whoever it pays, then refuses until granted again.',
    tech: 'OneTimeAllowPolicy grant, keyed by access selector.'
  },
  {
    term: 'Approval',
    plain: "Permission for someone else to move up to a set amount of the Safe's tokens.",
    tech: 'ERC-20 approve(spender, amount).'
  },
  {
    term: 'Revoke',
    plain: 'Setting an approval back to zero. The spender allowlist always allows it.',
    tech: 'approve(spender, 0).'
  },
  {
    term: 'ERC-20 Token',
    plain: 'The standard kind of token on Ethereum, such as USDC.',
    tech: 'transfer, transferFrom, approve.'
  },
  {
    term: 'WETH',
    plain: 'Wrapped Ether: ETH in the form of an ERC-20 token. Sending ETH to it wraps the ETH.',
    tech: 'WETH9: deposit(), withdraw(uint256), payable fallback that deposits.'
  },
  {
    term: 'Configuration Change',
    plain: 'Adding, changing or removing rules after hardening. It is requested, waits, and is then applied.',
    tech: 'requestConfiguration(root), then applyConfiguration(configurations).'
  },
  {
    term: 'Request',
    plain: 'The first step of a rule change: the Safe records the exact set of changes and starts the waiting period. Requesting is always allowed.',
    tech: 'requestConfiguration(bytes32 root); root = keccak256(abi.encode(configurations)).'
  },
  {
    term: 'Apply',
    plain: 'The last step of a rule change: once the wait is over, the Safe sends the exact same changes again and they take effect.',
    tech: 'applyConfiguration(Configuration[])'
  },
  {
    term: 'Cancel',
    plain: 'Withdrawing a requested change before it is applied. Always allowed, with no wait.',
    tech: 'invalidateRoot(bytes32 root)'
  },
  {
    term: 'Delay',
    plain:
      'The waiting period between asking for a rule change and applying it, one hour in the playground. It gives owners time to notice and cancel a change they did not expect.',
    tech: 'SafePolicyGuard.DELAY'
  },
  {
    term: 'Expiry',
    plain: 'How long a matured change stays open to be applied, seven days in the playground. After that it is dead and must be requested again.',
    tech: 'SafePolicyGuard.EXPIRY; expired when block.timestamp >= validFrom + EXPIRY.'
  },
  {
    term: 'Instant Configuration',
    plain: 'Setting rules with no wait. Only possible before the Policy Guard is installed, which is how a Safe is hardened.',
    tech: 'configureImmediately, rejected with GuardAlreadyEnabled once either guard is set.'
  },
  {
    term: 'Gas Refund',
    plain: 'A Safe feature that pays whoever submits a transaction out of the Safe. The Policy Guard refuses it, because no policy sees that payment.',
    tech: 'gasPrice > 0 with gasToken and refundReceiver; rejected with NonZeroGasPrice.'
  },
  {
    term: 'safeTxGas',
    plain: 'A gas limit an owner transaction can set for its call. The Policy Guard requires zero, so a failed call always undoes the whole transaction.',
    tech: 'Rejected with NonZeroSafeTxGas.'
  },
  {
    term: 'Revert',
    plain: 'A transaction failing and undoing everything it did, including what the policies recorded during the check.',
    tech: 'EVM revert; Safe bubbles inner revert data when safeTxGas == 0 and gasPrice == 0.'
  },
  {
    term: 'Spent',
    plain: 'Used up. One-time passes, ONCE permissions, co-signatures, extra signatures and attestations each work once, and are restored if the transaction fails.',
    tech: 'Stateful policies write during checkTransaction; a revert rolls the write back.'
  }
]
