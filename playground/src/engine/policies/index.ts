import type { PolicyName } from '../types.ts'
import { AllowedModulePolicy } from './AllowedModulePolicy.ts'
import { AllowPolicy } from './AllowPolicy.ts'
import type { PolicyImpl } from './common.ts'
import { CoSignerPolicy } from './CoSignerPolicy.ts'
import { DenyPolicy } from './DenyPolicy.ts'
import { ERC20ApprovePolicy } from './ERC20ApprovePolicy.ts'
import { ERC20TransferPolicy } from './ERC20TransferPolicy.ts'
import { IncreasedThresholdPolicy } from './IncreasedThresholdPolicy.ts'
import { MultiSendPolicy } from './MultiSendPolicy.ts'
import { NativeTransferPolicy } from './NativeTransferPolicy.ts'
import { OneTimeAllowPolicy } from './OneTimeAllowPolicy.ts'
import { SafenetPolicy } from './SafenetPolicy.ts'

export const POLICIES: Record<PolicyName, PolicyImpl> = {
  AllowPolicy,
  DenyPolicy,
  OneTimeAllowPolicy,
  AllowedModulePolicy,
  NativeTransferPolicy,
  ERC20TransferPolicy,
  ERC20ApprovePolicy,
  MultiSendPolicy,
  CoSignerPolicy,
  IncreasedThresholdPolicy,
  SafenetPolicy
}

export type { CheckArgs, CheckCtx, PolicyImpl, SubCall } from './common.ts'
