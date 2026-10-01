import type { Comparison } from '../../shared/api.ts'
import { Tag } from '../design-system'
import { shortSha } from '../format.ts'
import { RangeSelector } from './RangeSelector.tsx'
import './CompareHeader.css'

export function CompareHeader({ comparison }: { comparison: Comparison }) {
  const { base, head, mergeBase, commitCount } = comparison
  const contained = mergeBase === head.sha && base.sha !== head.sha
  const diverged = mergeBase !== null && mergeBase !== base.sha && !contained

  return (
    <header className="compare-header">
      <div className="compare-header__title">
        <Tag>Comparison</Tag>
        <h1 className="compare-header__heading">
          {commitCount} {commitCount === 1 ? 'commit' : 'commits'} from <code>{shortSha(base.sha)}</code> to{' '}
          <code>{shortSha(head.sha)}</code>
        </h1>
      </div>
      <RangeSelector base={base.sha} head={head.sha} />
      {diverged && (
        <p className="compare-header__note">
          These histories have diverged. Changes are shown from their common ancestor,{' '}
          <code>{shortSha(mergeBase)}</code>, to the head.
        </p>
      )}
      {contained && (
        <p className="compare-header__note">
          The head is already part of the base&apos;s history, so it adds nothing. Swap them to see what the base adds.
        </p>
      )}
      {mergeBase === null && (
        <p className="compare-header__note">These commits share no history. Changes are shown between them directly.</p>
      )}
    </header>
  )
}
