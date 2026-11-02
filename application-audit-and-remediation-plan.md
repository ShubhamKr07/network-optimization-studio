# Application audit & remediation plan (moved)

This July 2026 full-stack audit now lives in the private ops repo `ShubhamKr07/nos-ops-private`
(`application-audit-and-remediation-plan.md`), because it lists security findings and this repo is
public (PRIV-2). Section references elsewhere (e.g. §B1 in `model-integration-precheck.md`) point
there. Read it with:

    gh api repos/ShubhamKr07/nos-ops-private/contents/application-audit-and-remediation-plan.md --jq .content | base64 -d
