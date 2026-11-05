/**
 * The learning path, in order. `id` matches `Scenario.chapter` in scenarios/*.json.
 */
import type { Chapter } from './types.ts'

export const CHAPTERS: Chapter[] = [
  {
    id: 'how-a-check-works',
    title: 'How a Check Works',
    blurb:
      'With the Policy Guard installed, every transaction needs a rule. See what a rule matches, and what is checked before any rule is read.'
  },
  {
    id: 'rules-and-catch-all',
    title: 'Rules and the Catch-All',
    blurb:
      'A catch-all decides every call that has no rule of its own. See how it pairs with a co-signer, how an exact rule overrides it, and where it leaks.'
  },
  {
    id: 'policies-at-work',
    title: 'Policies at Work',
    blurb:
      'Allowlists for recipients and spenders, plain ETH transfers and extra owner signatures. What each policy checks, and what it does not.'
  },
  {
    id: 'batches',
    title: 'Batches',
    blurb:
      'A batch runs many steps as one transaction. Every step is checked on its own, all before any of them runs, and one failure undoes them all.'
  },
  {
    id: 'modules-and-guards',
    title: 'Modules and Guards',
    blurb:
      'Hardening installs the Policy Guard twice: as transaction guard and as module guard, ideally in one batch. See what goes wrong one at a time, which policies tell owners and modules apart, and why the guard guards itself.'
  },
  {
    id: 'changing-the-rules',
    title: 'Changing the Rules',
    blurb:
      'After hardening, every rule change is requested, waits, and is then applied. See the waiting period, expiry, removing a rule and removing the guard.'
  }
]
