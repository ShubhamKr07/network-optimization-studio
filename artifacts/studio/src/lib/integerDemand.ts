// SCU-2.R5a (D30) — whether a model's customer demand is an integer domain,
// read from its manifest's inputsSchema (max-coverage-us declares
// addedCustomers[].demand "type":"integer"; every other model allows decimals).
export function hasIntegerCustomerDemand(inputsSchema: Record<string, unknown> | undefined): boolean {
  const demand = (inputsSchema as any)?.properties?.addedCustomers?.items?.properties?.demand;
  return demand?.type === "integer";
}
