Workspace left rail: Scenarios / Inputs / Outputs sections, mono uppercase section headers, green-selected rows.

```jsx
<SidebarTree activeId="input:warehouses" onSelect={open} sections={[
  { title: "Scenarios", items: [{id:"s1",label:"Baseline"}], onAction: createScenario },
  { title: "Inputs", items: [{id:"input:warehouses",label:"Warehouses"},{id:"input:customers",label:"Customers"}] },
  { title: "Outputs", items: [{id:"out:map",label:"Output Map",disabled:true}] }
]} />
```
