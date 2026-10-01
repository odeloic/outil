export interface TabItem<Key extends string = string> {
  key: Key
  label: string
  count?: number | string
  attention?: boolean
}

export interface TabsProps<Key extends string = string> {
  tabs: TabItem<Key>[]
  active: Key
  onChange: (key: Key) => void
}

export function Tabs<Key extends string = string>({ tabs, active, onChange }: TabsProps<Key>) {
  return (
    <div className="ods-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className="ods-tabs__tab"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ods-tabs__count${tab.attention ? ' ods-tabs__count--attention' : ''}`}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
