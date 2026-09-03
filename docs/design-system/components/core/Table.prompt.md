Analyst-grade data table: sticky mono uppercase header, hairline row rules, mono numeric columns.

```jsx
<Table
  columns={[{key:"name",label:"Warehouse"},{key:"state",label:"State"},{key:"demand",label:"Demand",align:"right",mono:true}]}
  rows={[{name:"Chicago DC",state:"IL",demand:"18,240"}]}
/>
```
