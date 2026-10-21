# AGENTS.md — AHA-Core

Guidance for AI coding assistants (Claude Code, Cursor, etc.) working with this repository.

## What this repo is

**AHA-Core** is a Salesforce community accelerator delivering the **core data schema** for the
Affordable Housing sector. It is in **SFDX source format** (`force-app/main/default/`), API
version **63.0** (the `AHA_Core` permission set uses the **View All Fields** object permission,
which requires API 63.0+ / Spring '25). It extends the **standard** `Asset` and `Location`
objects — it does **not** create a custom object. It is unsupported, community-driven, and **for sandbox/scratch/trial
orgs only — never production.**

## Installing into a Salesforce org

👉 **Follow [`docs/02_Install_Guide_for_AI.md`](docs/02_Install_Guide_for_AI.md).** It is the authoritative,
step-by-step automated install guide. Do not improvise a deploy — the guide covers the
non-obvious prerequisites and gotchas below.

### Non-negotiables (read before any deploy)

1. **Person Accounts must be enabled in the org first.** It is a manual, one-way org setting
   that **cannot** be deployed as metadata. The schema assumes it. Verify, and if it's off,
   stop and ask the human operator to enable it.
2. **Field-Level Security is NOT granted by a source deploy.** After deploying, the fields —
   both the `AHA_*` custom fields and the standard hierarchy link fields (`Asset.LocationId`,
   `Location.ParentLocationId`, `Asset.ParentId`) — are invisible until FLS is granted. This repo
   ships the `AHA_Core` permission set for exactly this — assign it:
   `sf org assign permset --name AHA_Core --target-org <alias>` (see guide §3). A "successful"
   deploy where the user sees no new fields (or can't build the Location/Asset hierarchy) is this,
   every time.
3. **Standard objects / licensing:** the org must have the standard `Asset` and `Location`
   objects, and an **Industries license — Nonprofit Cloud or Public Sector Solutions**. The record
   pages use the Actionable Relationship Center (ARC / `RelationshipGraphDefinition`), which plain
   Service Cloud does not include, so Service Cloud is not supported.
4. **Lightning Record Page assignment is automatic for the System Administrator profile.** The
   `AHA` app ships `profileActionOverrides` (scoped to `<profile>Admin</profile>`) that bind the
   7 record pages to their object + record type; these deploy with the app. No manual step for an
   admin installer. **Non-Admin profiles are not covered** — assign manually in App Builder or add
   per-profile overrides to `applications/AHA.app-meta.xml`. (The `Location.LocationType` and
   `Asset.Status` picklist values the record types need are applied **non-destructively** by the
   merge step in the deploy flow below — `node scripts/merge-standard-valuesets.mjs <alias>` — not
   via a packaged StandardValueSet; see guide §4a.)

## Deploy command (summary — full flow in the guide)

```bash
node scripts/merge-standard-valuesets.mjs <alias>                                        # 1. merge required picklist values first (Asset.Status, Location.LocationType) — see §4a
sf project deploy start --manifest manifest/package.xml --target-org <alias> --dry-run   # 2. validate
sf project deploy start --manifest manifest/package.xml --target-org <alias> --wait 15   # 3. deploy
```

The merge step is **mandatory and must run first** — the Asset/Location record types reference
those picklist values and the package deploy fails without them.

## Working on the code

- Keep changes in **SFDX source format** under `force-app/main/default/`.
- Regenerate `manifest/package.xml` after adding/removing components:
  `sf project generate manifest --source-dir force-app/main/default --name package.xml --output-dir manifest`
- Dev tooling (ESLint, Prettier) is configured via `package.json` + husky pre-commit hooks; it
  does not affect what deploys to the org.
- Use a branch + PR for changes (see `CONTRIBUTING.md`).

## FLS / permissions

The `AHA_Core` permission set (`force-app/main/default/permissionsets/`) grants the AHA app;
full CRUD + **View All / Modify All Records** + **View All Fields** on `Asset`, `Location`,
`Account`, and `Contact`; editable FLS on the writable `AHA_*` and standard hierarchy link fields
(`Asset.LocationId`, `Location.ParentLocationId`); visibility of the 7 AHA
record types (Asset: Block, Component, Estate, Unit; Location: Block, Estate,
Unit); and the Account/Asset/Location tabs. **View All Fields** makes every `Asset`/`Location`
field readable — including read-only, formula (`Asset.AHA_UPRN__c`), and compound
(`Location.Location`) fields — without per-field read FLS, which is why those read-only fields
are deliberately *not* listed under `fieldPermissions` (listing them with `editable=true` fails
to deploy). It deploys with the rest of the metadata; assign it with
`sf org assign permset --name AHA_Core`. If you add new **writable** fields, add an editable
`fieldPermissions` entry; read-only fields are already covered by View All Fields.
**Requires API 63.0+** (View All Fields).
