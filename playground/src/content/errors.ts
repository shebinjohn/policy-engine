/**
 * Plain-language copy for every error the playground can return: guard and engine errors, policy
 * errors, Safe GS codes, ERC-20 errors, and the two execution outcomes 'Reverted' and 'CallFailed'.
 *
 * Keys are error names. A few names are shared by several policies (Unauthorized, InvalidSelector,
 * InvalidOperation, InvalidTransfer, InvalidModule, ModulePathUnsupported); their plain key holds
 * generic copy, and `<PolicyName>.<ErrorName>` keys hold the policy-specific version the UI prefers
 * when it knows the policy.
 */
import type { PolicyName } from '../engine/types.ts'
import type { ErrorInfo } from './types.ts'

type Entry = ErrorInfo & { policy?: PolicyName }

const list: Entry[] = [
  // -------------------------------------------------------------------------------------------
  // Policy Guard and engine
  // -------------------------------------------------------------------------------------------
  {
    name: 'NonZeroGasPrice',
    source: 'Policy Guard',
    title: 'Gas Refunds Not Allowed',
    plain:
      'The transaction sets a gas price, which would pay a refund out of the Safe. No policy can check that payment, so the guard refuses any gas price other than zero.',
    fix: 'Set the gas price to 0.',
    tech: 'NonZeroGasPrice() from SafePolicyGuard.checkTransaction: require(gasPrice == 0).'
  },
  {
    name: 'NonZeroSafeTxGas',
    source: 'Policy Guard',
    title: 'Gas Limit Must Be Zero',
    plain:
      'The transaction sets its own gas limit. With one, a call that fails could still count as done and keep what the policies recorded. The guard requires zero, so a failure always undoes everything.',
    fix: 'Set safeTxGas to 0.',
    tech: 'NonZeroSafeTxGas() from SafePolicyGuard.checkTransaction: require(safeTxGas == 0).'
  },
  {
    name: 'InvalidSelector',
    source: 'Policy Guard',
    title: 'No Function to Read',
    plain:
      'No valid function could be read here. Either the calldata is one to three bytes long, too short to name a function, or a token policy was attached to a function it cannot check.',
    fix: 'Send empty calldata or at least four bytes. Attach token policies to the function they are made for.',
    tech: 'InvalidSelector(): PolicyEngine._decodeSelector reverts on 1 to 3 bytes of data; ERC20TransferPolicy and ERC20ApprovePolicy revert with it from configure on the wrong selector.'
  },
  {
    name: 'Reentrancy',
    source: 'Policy Guard',
    title: 'Check Already Running',
    plain:
      'A policy tried to start a second check while one was in progress. The guard runs one check at a time, so no policy can slip in another transaction.',
    tech: 'Reentrancy() from PolicyEngine._enterCheck: $checkingSafe != address(0).'
  },
  {
    name: 'NotChecking',
    source: 'Policy Guard',
    title: 'No Check in Progress',
    plain: 'Something called the engine check directly, outside a guarded transaction. Only the guard may start a check.',
    tech: 'NotChecking(): PolicyEngine.checkTransaction called while $checkingSafe == address(0).'
  },
  {
    name: 'CrossSafeCheck',
    source: 'Policy Guard',
    title: 'Wrong Safe',
    plain:
      'A policy asked to check a transaction for another Safe than the one being checked. A policy can only reach the Safe it guards.',
    tech: 'CrossSafeCheck(): PolicyEngine.checkTransaction with safe != $checkingSafe.'
  },
  {
    name: 'ModuleConfigurationDenied',
    source: 'Policy Guard',
    title: 'Modules Cannot Change Rules',
    plain: 'A module tried to ask for, apply or cancel a rule change. Only the owners can manage rules.',
    fix: 'Have the owners send it as a normal Safe transaction.',
    tech: 'ModuleConfigurationDenied(): PolicyEngine.checkTransaction when _allowedCalls matches and $checkingModule != address(0).'
  },
  {
    name: 'AccessDenied',
    source: 'Policy Guard',
    title: 'No Rule Allows This',
    plain:
      'No rule covers this transaction, or the rule that covers it always refuses. With the Policy Guard installed, anything without a rule is denied.',
    fix: 'Add a rule for this contract, function and operation, or a catch-all that covers it.',
    tech: 'AccessDenied(address policy): address(0) when neither the exact key nor the operation catch-all has a policy; otherwise the policy that returned without the magic value.'
  },
  {
    policy: 'DenyPolicy',
    name: 'AccessDenied',
    source: 'Policy',
    title: 'Denied by Rule',
    plain:
      'The rule for this call uses DenyPolicy, which refuses every matching call. An exact rule wins over the catch-all, so nothing else is asked.',
    fix: 'This rule is doing its job. To allow the call, change the rule through the waiting period.',
    tech: 'AccessDenied(DenyPolicy): DenyPolicy.checkTransaction returns bytes4(0) instead of the magic value.'
  },
  {
    name: 'PolicyReverted',
    source: 'Policy Guard',
    title: 'Refused by Policy',
    plain: 'A rule matched, and its policy refused the transaction. The reason inside says why.',
    tech: 'PolicyReverted(address policy, bytes reason): PolicyEngine.checkTransaction wraps any revert from IPolicy.checkTransaction, forwarding the revert data as reason.'
  },
  {
    name: 'PolicyConfigurationFailed',
    source: 'Policy Guard',
    title: 'Rule Not Accepted',
    plain:
      'The policy refused to be attached to this rule. Some policies fit only certain rules: plain ETH needs the empty selector with CALL, and the batch checker needs multiSend with DELEGATECALL.',
    fix: "Check where the policy can be placed, then change the rule's target, function or operation.",
    tech: 'PolicyConfigurationFailed(): IPolicy.configure returned false in PolicyEngine._confirmPolicy.'
  },
  {
    name: 'GuardTargetDenied',
    source: 'Policy Guard',
    title: 'Guard Is Off Limits',
    plain:
      'The transaction calls the Policy Guard itself. Apart from asking for, applying and cancelling rule changes, nothing may reach the guard, whatever the rules say.',
    fix: 'Ask for the change, then apply it after the waiting period.',
    tech: 'GuardTargetDenied(): PolicyEngine.checkTransaction require(to != address(this)), checked after _allowedCalls and before any policy lookup.'
  },
  {
    name: 'RootAlreadyConfigured',
    source: 'Policy Guard',
    title: 'Change Already Requested',
    plain: 'This exact set of changes is already waiting. It cannot be requested again while that request is open.',
    fix: 'Apply it once the wait is over, or cancel it first.',
    tech: 'RootAlreadyConfigured(bytes32 root): SafePolicyGuard.requestConfiguration when rootConfigured is set and not expired.'
  },
  {
    name: 'RootNotConfigured',
    source: 'Policy Guard',
    title: 'Change Not Requested',
    plain:
      'No open request matches this set of changes. The rules being applied or cancelled must match a request exactly, in the same order.',
    fix: 'Ask for the change first, wait, then apply exactly the same rules.',
    tech: 'RootNotConfigured(bytes32 root): SafePolicyGuard.applyConfiguration or invalidateRoot with rootConfigured[safe][root] == 0.'
  },
  {
    name: 'RootConfigurationPending',
    source: 'Policy Guard',
    title: 'Still Waiting',
    plain: 'The change was requested, but the waiting period has not passed yet.',
    fix: 'Wait until the delay is over, then apply it.',
    tech: 'RootConfigurationPending(): SafePolicyGuard.applyConfiguration with block.timestamp < validFrom.'
  },
  {
    name: 'RootConfigurationExpired',
    source: 'Policy Guard',
    title: 'Request Expired',
    plain:
      'The change was not applied in time. After the wait it stays open for a limited window, seven days by default, and that window has closed.',
    fix: 'Ask for the same change again and apply it after the wait.',
    tech: 'RootConfigurationExpired(): SafePolicyGuard.applyConfiguration with block.timestamp >= validFrom + EXPIRY.'
  },
  {
    name: 'GuardAlreadyEnabled',
    source: 'Policy Guard',
    title: 'Instant Changes Are Off',
    plain:
      'Instant rule changes only work before the Policy Guard is installed. It already guards this Safe, as transaction guard or module guard, even if an earlier step of the same batch just installed it. From here, every change goes through the waiting period.',
    fix: 'When hardening in one batch, set the rules before installing either guard. After hardening, ask for the change and apply it after the wait.',
    tech: 'GuardAlreadyEnabled(): SafePolicyGuard.configureImmediately when either Safe guard slot holds this guard. The slots are read live, so an earlier set*Guard step in the same batch triggers it.'
  },
  {
    name: 'ExecutionFailed',
    source: 'Policy Guard',
    title: 'Transaction Failed',
    plain: 'The transaction passed its checks but failed when it ran. Everything is undone, including what the policies recorded.',
    tech: 'ExecutionFailed(): SafePolicyGuard.checkAfterExecution with success == false.'
  },
  {
    name: 'ModuleExecutionFailed',
    source: 'Policy Guard',
    title: 'Module Transaction Failed',
    plain:
      'The module transaction passed its checks but failed when it ran. The guard turns the failure into a full revert, so spent grants and signatures are undone too.',
    tech: 'ModuleExecutionFailed(): SafePolicyGuard.checkAfterModuleExecution with success == false.'
  },
  {
    name: 'MalformedSignatureExtension',
    source: 'Policy Guard',
    title: 'Broken Context',
    plain:
      'The extra data carried with the signatures claims to be policy context but is broken. The guard refuses rather than guess.',
    tech: 'MalformedSignatureExtension(): SignatureExtension.payload in SafePolicyGuard._decodeContext.'
  },

  // -------------------------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------------------------
  {
    name: 'Unauthorized',
    source: 'Policy',
    title: 'Not Authorized',
    plain:
      'The policy on this rule did not find what it needs: the recipient or spender is not on its list, the one-time pass is used up, or the co-signature is missing or wrong.',
    fix: 'See what this policy expects, then provide it or change the rule.',
    tech: 'Unauthorized(): thrown by OneTimeAllowPolicy, ERC20TransferPolicy, ERC20ApprovePolicy and CoSignerPolicy.'
  },
  {
    policy: 'ERC20TransferPolicy',
    name: 'Unauthorized',
    source: 'Policy',
    title: 'Recipient Not Allowed',
    plain: 'The person receiving the tokens is not on the allowlist for this token, or their one-time permission was already used.',
    fix: 'Add the recipient to the allowlist through a rule change.',
    tech: 'ERC20TransferPolicy.Unauthorized(): recipient permission is NONE for this token.'
  },
  {
    policy: 'ERC20ApprovePolicy',
    name: 'Unauthorized',
    source: 'Policy',
    title: 'Spender Not Allowed',
    plain:
      'The spender is not on the allowlist for this token, or their one-time permission was already used. An approval of zero would always pass.',
    fix: 'Add the spender through a rule change, or approve zero to revoke.',
    tech: 'ERC20ApprovePolicy.Unauthorized(): spender permission is NONE and amount != 0.'
  },
  {
    policy: 'OneTimeAllowPolicy',
    name: 'Unauthorized',
    source: 'Policy',
    title: 'One-Time Pass Used',
    plain: 'This rule allowed a single transaction, and it has been used or was never granted.',
    fix: 'Grant it again through a rule change.',
    tech: 'OneTimeAllowPolicy.Unauthorized(): no unspent grant for this access selector.'
  },
  {
    policy: 'CoSignerPolicy',
    name: 'Unauthorized',
    source: 'Policy',
    title: 'Co-Signature Missing',
    plain:
      'The transaction does not carry a valid co-signature for exactly this transaction. In a batch, each step needs its own co-signature, not one for the whole batch.',
    fix: 'Ask the co-signer to sign this transaction, or each step of the batch.',
    tech: 'CoSignerPolicy.Unauthorized(): SignatureChecker.isValidSignatureNow(cosigner, safeTxHash, context) is false. The hash is rebuilt with zero gas fields at nonce - 1.'
  },
  {
    name: 'UnauthorizedModule',
    source: 'Policy',
    title: 'Module Not Allowed',
    plain: 'The module sending this transaction is not on the module allowlist.',
    fix: 'Allow the module through a rule change.',
    tech: 'AllowedModulePolicy.UnauthorizedModule(): allowed[guard][safe][module] is false.'
  },
  {
    name: 'InvalidModule',
    source: 'Policy',
    title: 'Modules Only',
    plain:
      'This rule only accepts transactions sent by an allowed module. An owner transaction comes from no module, so it is refused. A rule cannot list the zero address as a module either.',
    fix: 'Send it through the allowed module, or give owner transactions a rule of their own.',
    tech: 'AllowedModulePolicy.InvalidModule(): module == address(0) in checkTransaction (owner path) or in configure.'
  },
  {
    name: 'InvalidTransfer',
    source: 'Policy',
    title: 'Not a Valid Transfer',
    plain:
      'The call is not a transfer this policy accepts: a plain ETH transfer moved no ETH, or a recipient allowlist saw a call that is not a token transfer.',
    tech: 'InvalidTransfer(): NativeTransferPolicy (value == 0) and ERC20TransferPolicy (selector is not transfer or transferFrom).'
  },
  {
    policy: 'NativeTransferPolicy',
    name: 'InvalidTransfer',
    source: 'Policy',
    title: 'No ETH Moved',
    plain: 'A plain ETH transfer must send some ETH. This one sends none.',
    fix: 'Send an amount above zero.',
    tech: 'NativeTransferPolicy.InvalidTransfer(): value == 0.'
  },
  {
    policy: 'ERC20TransferPolicy',
    name: 'InvalidTransfer',
    source: 'Policy',
    title: 'Not a Token Transfer',
    plain: 'The recipient allowlist can only read transfers. This call is something else.',
    tech: 'ERC20TransferPolicy.InvalidTransfer(): data selector is neither transfer nor transferFrom.'
  },
  {
    name: 'CalldataNotPermitted',
    source: 'Policy',
    title: 'Calldata Not Allowed',
    plain: 'A plain ETH transfer must carry no calldata at all. This one carries some, even if it is only four zero bytes.',
    fix: 'Send the ETH with empty calldata.',
    tech: 'NativeTransferPolicy.CalldataNotPermitted(): data.length != 0.'
  },
  {
    name: 'InvalidOperation',
    source: 'Policy',
    title: 'Wrong Operation',
    plain: 'This policy only works with CALL. The transaction or the rule uses DELEGATECALL.',
    fix: 'Use CALL, or pick a policy made for DELEGATECALL.',
    tech: 'InvalidOperation(): NativeTransferPolicy.checkTransaction; ERC20TransferPolicy and ERC20ApprovePolicy configure on a DELEGATECALL access selector.'
  },
  {
    policy: 'NativeTransferPolicy',
    name: 'InvalidOperation',
    source: 'Policy',
    title: 'Plain Transfers Use CALL',
    plain: 'A plain ETH transfer is a CALL. This one is a DELEGATECALL, which would run code inside the Safe instead.',
    tech: 'NativeTransferPolicy.InvalidOperation(): operation != CALL.'
  },
  {
    policy: 'ERC20TransferPolicy',
    name: 'InvalidSelector',
    source: 'Policy',
    title: 'Wrong Function for Allowlist',
    plain: 'The recipient allowlist only fits transfer or transferFrom. This rule names another function, so it cannot be set.',
    fix: 'Attach the recipient allowlist to transfer or transferFrom of a token.',
    tech: 'ERC20TransferPolicy.InvalidSelector(): configure on an access selector whose selector is not transfer or transferFrom.'
  },
  {
    policy: 'ERC20ApprovePolicy',
    name: 'InvalidSelector',
    source: 'Policy',
    title: 'Wrong Function for Allowlist',
    plain: 'The spender allowlist only fits approve. This rule names another function, so it cannot be set.',
    fix: 'Attach the spender allowlist to approve of a token.',
    tech: 'ERC20ApprovePolicy.InvalidSelector(): configure on an access selector whose selector is not approve.'
  },
  {
    name: 'InvalidApproval',
    source: 'Policy',
    title: 'Not an Approval',
    plain: 'The spender allowlist can only read approvals. This call is something else.',
    tech: 'ERC20ApprovePolicy.InvalidApproval(): data selector is not approve.'
  },
  {
    name: 'InvalidMultiSend',
    source: 'Policy',
    title: 'Not a Batch',
    plain: 'The batch checker expected a MultiSend batch and found something else.',
    tech: 'MultiSendPolicy.InvalidMultiSend(): data selector is not multiSend.'
  },
  {
    name: 'NoCosignerConfigured',
    source: 'Policy',
    title: 'No Co-Signer Set',
    plain: 'This rule uses the co-signer policy, but no co-signer is set for it.',
    fix: 'Set the co-signer address in the rule.',
    tech: 'CoSignerPolicy.NoCosignerConfigured(): cosigner[guard][safe][access] == address(0).'
  },
  {
    name: 'CoSignatureAlreadySpent',
    source: 'Policy',
    title: 'Co-Signature Already Used',
    plain: 'This co-signature was already used. Each one works once, so a batch cannot repeat the same co-signed step.',
    fix: 'Vary the step, for example the amount, or split it across transactions.',
    tech: 'CoSignerPolicy.CoSignatureAlreadySpent(): spent[guard][safe][safeTxHash] is set.'
  },
  {
    name: 'ModulePathUnsupported',
    source: 'Policy',
    title: 'Owners Only',
    plain:
      'This policy needs signatures or an attestation, and a module transaction cannot carry either. It refuses every module transaction.',
    fix: 'Send it as an owner transaction, or give the module a rule of its own with the module allowlist.',
    tech: 'ModulePathUnsupported(): CoSignerPolicy, IncreasedThresholdPolicy and SafenetPolicy with module != address(0).'
  },
  {
    policy: 'CoSignerPolicy',
    name: 'ModulePathUnsupported',
    source: 'Policy',
    title: 'Co-Signer Needs Owners',
    plain: 'A co-signature travels with the owner signatures, and a module transaction has none. The co-signer policy refuses every module transaction.',
    fix: 'Send it as an owner transaction, or give the module a rule of its own with the module allowlist.',
    tech: 'CoSignerPolicy.ModulePathUnsupported(): module != address(0).'
  },
  {
    policy: 'IncreasedThresholdPolicy',
    name: 'ModulePathUnsupported',
    source: 'Policy',
    title: 'Extra Signatures Need Owners',
    plain: 'This rule asks for extra owner signatures, and a module transaction carries none. It refuses every module transaction.',
    fix: 'Send it as an owner transaction.',
    tech: 'IncreasedThresholdPolicy.ModulePathUnsupported(): module != address(0).'
  },
  {
    policy: 'SafenetPolicy',
    name: 'ModulePathUnsupported',
    source: 'Policy',
    title: 'Safenet Needs Owners',
    plain: 'A Safenet attestation travels with the owner signatures, and a module transaction has none. The Safenet policy refuses every module transaction.',
    fix: 'Send it as an owner transaction.',
    tech: 'SafenetPolicy.ModulePathUnsupported(): module != address(0).'
  },
  {
    policy: 'IncreasedThresholdPolicy',
    name: 'GS020',
    source: 'Policy',
    title: 'Not Enough Owner Signatures',
    plain: 'This rule asks for more owner signatures than the Safe threshold, and the transaction does not carry enough of them.',
    fix: 'Collect the extra owner signatures and send them along with the transaction.',
    tech: 'GS020 from Safe.checkNSignatures, called by IncreasedThresholdPolicy with the required count clamped to [threshold + 1, owners].'
  },
  {
    policy: 'IncreasedThresholdPolicy',
    name: 'GS026',
    source: 'Policy',
    title: 'Invalid Owner Signature',
    plain: 'One of the extra signatures is not from an owner, or appears twice.',
    fix: 'Collect signatures from distinct owners only.',
    tech: 'GS026 from Safe.checkNSignatures, called by IncreasedThresholdPolicy.'
  },
  {
    name: 'SignaturesAlreadySpent',
    source: 'Policy',
    title: 'Signatures Already Used',
    plain: 'These owner signatures were already used. Each set works once, so a batch cannot repeat the same step that needs extra signatures.',
    fix: 'Vary the step, or split it across transactions.',
    tech: 'IncreasedThresholdPolicy.SignaturesAlreadySpent(): spent[guard][safe][safeTxHash] is set.'
  },
  {
    name: 'MalformedAttestation',
    source: 'Policy',
    title: 'Attestation Missing',
    plain: 'The transaction does not carry a Safenet attestation in the expected form.',
    fix: 'Get a Safenet attestation for this transaction and send it along.',
    tech: 'SafenetPolicy.MalformedAttestation(): context.length != 256.'
  },
  {
    name: 'UntrustedAttestationKey',
    source: 'Policy',
    title: 'Unknown Safenet Key',
    plain: 'The attestation was signed with a key the policy does not trust.',
    tech: 'SafenetPolicy.UntrustedAttestationKey(): (groupKey, epoch) is not in the trusted epoch forest.'
  },
  {
    name: 'AttestationAlreadySpent',
    source: 'Policy',
    title: 'Attestation Already Used',
    plain:
      'An attestation was already used at this Safe nonce. Safenet approves one transaction per nonce, so a batch can hold only one Safenet-checked step.',
    fix: 'Send Safenet-checked actions as separate transactions.',
    tech: 'SafenetPolicy.AttestationAlreadySpent(): spent[guard][safe][nonce - 1] is set.'
  },
  {
    name: 'InvalidMulMulAddWitness',
    source: 'Policy',
    title: 'Attestation Does Not Match',
    plain: 'The Safenet signature does not match this transaction. It may have been made for a different one.',
    tech: 'InvalidMulMulAddWitness(): the revert SafenetPolicy forwards when FROST.verify meets a well-formed signature over another message. Thrown by Secp256k1.mulmuladd: the Schnorr equation does not hold.'
  },
  {
    name: 'InvalidScalar',
    source: 'Policy',
    title: 'Malformed Attestation Signature',
    plain: 'The Safenet signature contains a value out of range, so it cannot be checked.',
    tech: 'InvalidScalar(): FROST.verify with signature.z >= Secp256k1.N.'
  },
  {
    name: 'NotOnCurve',
    source: 'Policy',
    title: 'Malformed Attestation Key',
    plain: 'The attestation contains a key or commitment that is not a valid point, so it cannot be checked.',
    tech: 'NotOnCurve(): Secp256k1 point validation inside FROST.verify.'
  },
  {
    name: 'UnsupportedMulMulAddInput',
    source: 'Policy',
    title: 'Malformed Attestation Signature',
    plain: 'The Safenet signature has values the verifier cannot process.',
    tech: 'UnsupportedMulMulAddInput(): Secp256k1.mulmuladd, ecrecover returned address(0).'
  },

  // -------------------------------------------------------------------------------------------
  // Safe (GS codes)
  // -------------------------------------------------------------------------------------------
  {
    name: 'GS020',
    source: 'Safe',
    title: 'Not Enough Signatures',
    plain:
      'There are fewer signatures than required. For the Safe this is its threshold. For the extra-signatures policy it is the higher number the rule asks for.',
    fix: 'Collect more owner signatures.',
    tech: 'GS020: Safe.checkNSignatures, signatures.length < requiredSignatures * 65.'
  },
  {
    name: 'GS021',
    source: 'Safe',
    title: 'Invalid Contract Signature',
    plain: 'A contract signature points to data inside the signature list itself.',
    tech: 'GS021: Safe.checkNSignatures, contract signature offset inside the static part.'
  },
  {
    name: 'GS022',
    source: 'Safe',
    title: 'Invalid Contract Signature',
    plain: 'A contract signature points past the end of the signature data.',
    tech: 'GS022: Safe.checkContractSignature, offset out of bounds.'
  },
  {
    name: 'GS023',
    source: 'Safe',
    title: 'Invalid Contract Signature',
    plain: 'A contract signature is longer than the data that holds it.',
    tech: 'GS023: Safe.checkContractSignature, length out of bounds.'
  },
  {
    name: 'GS024',
    source: 'Safe',
    title: 'Contract Signature Rejected',
    plain: 'A contract owner did not confirm its signature.',
    tech: 'GS024: ISignatureValidator.isValidSignature did not return the EIP-1271 magic value.'
  },
  {
    name: 'GS025',
    source: 'Safe',
    title: 'Hash Not Approved',
    plain: 'A signature claims an owner approved this transaction ahead of time, but no such approval exists.',
    tech: 'GS025: approved-hash signature (v == 1) without approvedHashes[owner][hash] and executor != owner.'
  },
  {
    name: 'GS026',
    source: 'Safe',
    title: 'Invalid Owner Signature',
    plain: 'A signature is not from an owner, appears twice, or is out of order.',
    fix: 'Collect signatures from distinct owners only.',
    tech: 'GS026: Safe.checkNSignatures, currentOwner <= lastOwner or not an owner.'
  },
  {
    name: 'GS101',
    source: 'Safe',
    title: 'Invalid Module Address',
    plain: 'The module address is the zero address or the special marker the Safe uses for its list.',
    tech: 'GS101: ModuleManager.enableModule or disableModule with module == 0 or SENTINEL_MODULES.'
  },
  {
    name: 'GS102',
    source: 'Safe',
    title: 'Module Already Enabled',
    plain: 'This module is already enabled on the Safe.',
    tech: 'GS102: ModuleManager.enableModule, modules[module] != 0.'
  },
  {
    name: 'GS103',
    source: 'Safe',
    title: 'Module Not Found',
    plain: 'The module to remove is not where the Safe expects it in its list of modules.',
    tech: 'GS103: ModuleManager.disableModule, modules[prevModule] != module.'
  },
  {
    name: 'GS104',
    source: 'Safe',
    title: 'Module Not Enabled',
    plain: 'Only enabled modules can send module transactions, and this one is not enabled.',
    fix: 'Enable the module first. After hardening that needs a rule.',
    tech: 'GS104: ModuleManager.execTransactionFromModule from a module that is not enabled.'
  },
  {
    name: 'GS201',
    source: 'Safe',
    title: 'Threshold Too High',
    plain: 'The threshold cannot be higher than the number of owners.',
    tech: 'GS201: OwnerManager.changeThreshold, addOwnerWithThreshold or removeOwner.'
  },
  {
    name: 'GS202',
    source: 'Safe',
    title: 'Threshold Cannot Be Zero',
    plain: 'A Safe needs at least one signature.',
    tech: 'GS202: OwnerManager, _threshold == 0.'
  },
  {
    name: 'GS203',
    source: 'Safe',
    title: 'Invalid Owner Address',
    plain: 'An owner cannot be the zero address, the special list marker, or the Safe itself.',
    tech: 'GS203: OwnerManager.addOwnerWithThreshold, removeOwner or swapOwner.'
  },
  {
    name: 'GS204',
    source: 'Safe',
    title: 'Already an Owner',
    plain: 'This address is already an owner of the Safe.',
    tech: 'GS204: OwnerManager, owners[owner] != 0.'
  },
  {
    name: 'GS205',
    source: 'Safe',
    title: 'Owner Not Found',
    plain: 'The owner to remove is not where the Safe expects it in its list of owners.',
    tech: 'GS205: OwnerManager.removeOwner or swapOwner, owners[prevOwner] != owner.'
  },
  {
    name: 'GS300',
    source: 'Safe',
    title: 'Not a Transaction Guard',
    plain:
      'The contract set as the transaction guard answered that it is not one. This fires only for a contract that can answer the question. An address with no code, or a contract that cannot answer, fails with no reason instead.',
    fix: 'Set the Policy Guard, or the zero address to remove the guard.',
    tech: 'GS300: GuardManager.setGuard when supportsInterface(ITransactionGuard) returns false. If that call reverts or returns nothing (no code, no ERC-165), setGuard reverts with empty data: Reverted.'
  },
  {
    name: 'GS301',
    source: 'Safe',
    title: 'Not a Module Guard',
    plain:
      'The contract set as the module guard answered that it is not one. This fires only for a contract that can answer the question. An address with no code, or a contract that cannot answer, fails with no reason instead.',
    fix: 'Set the Policy Guard, or the zero address to remove the module guard.',
    tech: 'GS301: ModuleManager.setModuleGuard when supportsInterface(IModuleGuard) returns false. If that call reverts or returns nothing (no code, no ERC-165), setModuleGuard reverts with empty data: Reverted.'
  },

  // -------------------------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------------------------
  {
    name: 'ERC20InsufficientBalance',
    source: 'Token',
    title: 'Not Enough Tokens',
    plain: 'The Safe does not hold enough of this token. The checks passed, but the transfer failed, so everything is undone.',
    fix: 'Lower the amount or fund the Safe.',
    tech: 'ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed), OpenZeppelin ERC20 v5.'
  },
  {
    name: 'ERC20InsufficientAllowance',
    source: 'Token',
    title: 'Allowance Too Low',
    plain: 'Moving tokens on behalf of someone else needs their approval for at least this amount.',
    fix: 'Have the token holder approve the Safe first, or lower the amount.',
    tech: 'ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed), OpenZeppelin ERC20 v5.'
  },
  {
    name: 'ERC20InvalidReceiver',
    source: 'Token',
    title: 'Invalid Recipient',
    plain: 'Tokens cannot be sent to the zero address.',
    tech: 'ERC20InvalidReceiver(address receiver), OpenZeppelin ERC20 v5.'
  },
  {
    name: 'ERC20InvalidSpender',
    source: 'Token',
    title: 'Invalid Spender',
    plain: 'The zero address cannot be approved as a spender.',
    tech: 'ERC20InvalidSpender(address spender), OpenZeppelin ERC20 v5.'
  },

  // -------------------------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------------------------
  {
    name: 'Reverted',
    source: 'Execution',
    title: 'Call Reverted',
    plain:
      'The call failed without giving a reason. Common causes: not enough ETH, a function the target does not have, ETH sent to a token, or a guard set to an address that is not a guard. Everything is undone.',
    tech: 'Empty revert data, bubbled up by Safe.execTransaction because safeTxGas == 0 and gasPrice == 0.'
  },
  {
    name: 'CallFailed',
    source: 'Execution',
    title: 'Module Call Failed',
    plain:
      'The module transaction failed. With no module guard installed, the Safe reported the failure instead of reverting. Nothing changed.',
    tech: 'execTransactionFromModule returned false; no checkAfterModuleExecution ran to revert it.'
  }
]

/** Error copy by name, plus `<PolicyName>.<ErrorName>` keys for policy-specific wording. */
export const ERRORS: Record<string, ErrorInfo> = Object.fromEntries(
  list.map(({ policy, ...info }) => [policy ? `${policy}.${info.name}` : info.name, info])
)
