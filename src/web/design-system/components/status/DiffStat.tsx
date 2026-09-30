export interface DiffStatProps {
  added: number
  removed: number
}

export function DiffStat({ added, removed }: DiffStatProps) {
  return (
    <span className="ods-diffstat">
      <span className="ods-diffstat__add">+{added}</span>
      <span className="ods-diffstat__del">{'−'}{removed}</span>
    </span>
  )
}
