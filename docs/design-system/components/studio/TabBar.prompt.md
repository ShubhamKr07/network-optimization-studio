Document tab strip above workspace content: active tab is white with a 2px green top rule; each tab closes with an x. Empty state shows guidance text.

```jsx
<TabBar tabs={[{id:"input:warehouses",label:"Warehouses"},{id:"input:map",label:"Input Map"}]}
  activeTabId="input:map" onActivate={activate} onClose={close} />
```
