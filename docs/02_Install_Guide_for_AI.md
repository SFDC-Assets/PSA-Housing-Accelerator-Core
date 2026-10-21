# Install Guide for AI — AHA-Core (Source Deploy)

> **Audience:** an AI coding assistant (Claude Code, Cursor, etc.) that has been pointed at
> this repository **and** given access to a target Salesforce org via the Salesforce CLI
> (`sf`). This guide is the automated alternative to the manual
> [Install Guide](01_Install_Guide.md).
>
> **Human operator:** you only need to (1) make sure the org prerequisites below are met and
> (2) authorise the CLI to your org. The assistant does the rest and stops to ask you when a
> step genuinely requires the Setup UI.

---

## 0. What this repo installs (ground truth)

This repo is in **SFDX source format** (`force-app/main/default/`). It deploys the **core
schema only** — it extends the **standard** `Asset` and `Location` objects. It does **not**
contain a custom object or custom tabs. The actual deployable components are:

| Type | Count | Members |
|---|---|---|
| CustomApplication | 1 | `AHA` |
| CustomField | 11 | `Asset`: `AHA_Asset_Category__c`, `AHA_Asset_Type__c`, `AHA_Parent_Block__c`, `AHA_Parent_Estate__c`, `AHA_Twin_Asset__c`, `AHA_UPRN__c` · `Location`: `AHA_Long_Description__c`, `AHA_Managed_By__c`, `AHA_Status__c`, `AHA_Twin_Asset__c`, `AHA_UPRN__c` |
| RecordType | 7 | `Asset`: `AHA_Block`, `AHA_Component`, `AHA_Estate`, `AHA_Unit` · `Location`: `AHA_Block`, `AHA_Estate`, `AHA_Unit` |
| CompactLayout | 7 | matching the record types above |
| Layout | 7 | `Asset` / `Location` page layouts |
| FlexiPage | 8 | 7 record pages + `AHA_UtilityBar` |
| ListView | 1 | `Location.All_Locations` |
| Flow | 2 | `AHA_Create_Twin_Asset` — record-triggered on `Location` create, creates the twin `Asset` · `AHA_Update_Asset_Parents` — record-triggered on `Asset` create/update, sets `AHA_Parent_Estate__c` / `AHA_Parent_Block__c` |
| RelationshipGraphDefinition | 2 | `AHA_Asset_Hierarchy`, `AHA_Locations_and_Assets_Hierarchy` — the hierarchy graphs the record-page `arcGraph` components render |
| QuickAction | 1 | `Asset.Update_Asset` |
| ValidationRule | 3 | `Asset.AHA_Location_Without_Twin_Asset` — if a Location is set, `AHA_Twin_Asset__c` must be checked · `Asset.AHA_Twin_Asset_Without_Location` — if `AHA_Twin_Asset__c` is checked, a Location must be set · `Asset.AHA_Restrict_Parent_Asset` — an Asset cannot have both a Parent Asset and a Location (cannot be a child and a twin at once) |
| PermissionSet | 1 | `AHA_Core` — grants the AHA app, full CRUD + View All/Modify All Records + View All Fields on Asset, Location, Account, and Contact, and editable FLS on the writable `AHA_*` and standard hierarchy link fields (`Asset.LocationId`, `Location.ParentLocationId`) |
| Profile | 1 | `Admin` (System Administrator) — classic page-layout assignments binding the 7 AHA record types to their AHA layouts; Lightning record pages are bound separately via the AHA app overrides (§4b) |
| StandardValueSet | — | `LocationType` + `AssetStatus` — applied non-destructively via `scripts/merge-standard-valuesets.mjs`, **not** deployed in the package (see §4a) |

A `manifest/package.xml` enumerating all of the above is checked in. **Source API version: 63.0**
(`sfdx-project.json` **and** `manifest/package.xml` — both must be ≥ 63.0 because the `AHA_Core`
permission set uses the **View All Fields** object permission, introduced in API 63.0 / Spring '25).

> ⚠️ **No custom objects are created.** If the target org does not already have the standard
> `Asset` and `Location` objects available (licensing/edition dependent — see §1), the deploy
> will fail. This is expected, not a repo defect.

> ⚠️ **FlexiPage → graph dependency.** Six of the seven record pages (`AHA_Block`, `AHA_Block_Asset`,
> `AHA_Estate`, `AHA_Estate_Asset`, `AHA_Unit`, `AHA_Unit_Asset`) embed a `runtime_industries_arcgraph:arcGraph`
> component that references the two `RelationshipGraphDefinition` graphs above. If the graphs are
> not deployed in the **same** transaction, those FlexiPages fail with
> `Invalid Graph Developer Name <name> - no graph found`. The checked-in `manifest/package.xml`
> includes the `RelationshipGraphDefinition` type for exactly this reason — if you ever regenerate
> or hand-edit the manifest, **do not drop it** (regenerate with the command in `AGENTS.md`, never
> hand-trim). This feature requires Industries/ARC — see §1.

---

## 1. Preflight — verify BEFORE deploying

Do not deploy until every item here is satisfied. Several of these are **manual org settings
that cannot be deployed as metadata** — if one is missing, stop and ask the human operator to
enable it in Setup.

1. **License / edition** — an **Industries license: Nonprofit Cloud or Public Sector Solutions**.
   The standard `Asset` and `Location` objects must be present.
   > ⚠️ **Industries / Actionable Relationship Center (ARC) is required.** The record pages embed
   > an `arcGraph` component backed by `RelationshipGraphDefinition` metadata — an Industries
   > feature present in Nonprofit Cloud and Public Sector Solutions but **not** in plain Service
   > Cloud. On a Service-Cloud-only org the two graphs will not deploy and the record pages will
   > not render the hierarchy, so Service Cloud is not supported for this accelerator.
2. **Lightning Experience (LEX)** is the default UI (not Classic).
3. **Person Accounts are enabled.** This is a one-way org setting and a hard prerequisite —
   record types and layouts assume it. It **cannot** be enabled via metadata deploy.
   [Salesforce docs](https://help.salesforce.com/s/articleView?id=sales.account_person.htm&type=5).
4. **Target org is a sandbox / scratch / trial** — never a production org (community accelerator,
   as-is, unsupported).

### Suggested preflight probes (read-only)

```bash
# Confirm you are pointed at the intended org
sf org display --target-org <alias>

# Standard objects present? (fails/empty => licensing or edition gap)
sf data query --query "SELECT COUNT() FROM Asset"    --target-org <alias>
sf data query --query "SELECT COUNT() FROM Location" --target-org <alias>

# Person Accounts enabled? Returns a row only when PA is on.
sf data query --query "SELECT Id FROM RecordType WHERE SobjectType='Account' AND IsPersonType=true LIMIT 1" --target-org <alias>
```

If the Person Accounts probe returns no rows, **stop** and ask the operator to enable Person
Accounts, then resume.

---

## 2. Deploy the metadata

From the repo root, with the CLI authenticated to the target org:

```bash
# Step 1 — Non-destructively ensure the required StandardValueSet values exist on the org
# (Asset.Status: Active/Planned/Obsolete; Location.LocationType: the 19 housing values).
# Adds only what is missing and preserves every existing org value. MUST run before the
# package deploy — the Asset/Location record types reference these values. See §4a.
node scripts/merge-standard-valuesets.mjs <alias>

# Step 2 — Validate the package (no changes committed to the org)
sf project deploy start --manifest manifest/package.xml --target-org <alias> --dry-run

# Step 3 — Deploy for real
sf project deploy start --manifest manifest/package.xml --target-org <alias> --wait 15
```

Deploying `--source-dir force-app` works equally well **except for the two StandardValueSets**,
which are `.forceignore`d and must be applied via the merge script above — a raw StandardValueSet
deploy would deactivate the org's other values (see §4a).

If the deploy reports failures, surface the exact error to the operator. The most common cause
is an unmet §1 prerequisite (Person Accounts, missing standard object, or edition/licensing).

---

## 3. Grant Field-Level Security ⚠️ (do not skip)

**SFDX source deploys do NOT grant Field-Level Security.** After a clean deploy, the fields
exist but are **invisible** in the UI and to SOQL — even for a System Administrator — until FLS
is granted. This applies to the `AHA_*` custom fields **and** to the standard hierarchy link
fields the schema depends on (`Asset.LocationId`, `Location.ParentLocationId`, `Asset.ParentId`);
without those, you cannot see or build the Location/Asset hierarchy. A deploy that "succeeded"
while the user sees no new fields (or can't link the hierarchy) is almost always this.

This repo ships the **`AHA_Core` permission set** to close that gap. It is deployed as part of
§2, and grants the `AHA` app; full CRUD + **View All / Modify All Records** + **View All Fields**
on `Asset`, `Location`, `Account`, and `Contact`; and editable FLS on the writable `AHA_*` and
standard hierarchy link fields (`Asset.LocationId`, `Location.ParentLocationId`, `Asset.ParentId`).
**View All Fields** makes every `Asset`/`Location` field readable — including read-only, formula
(`Asset.AHA_UPRN__c`), and compound (`Location.Location`) fields — so no per-field read FLS is
needed. **Assign it to the running user:**

```bash
sf org assign permset --name AHA_Core --target-org <alias>
```

That single command makes the fields visible. (The permission set is license-agnostic, so it
assigns regardless of the org's user license.)

- **Interim alternative** (if you prefer not to use the permission set): manually enable field
  visibility via Setup → Object Manager → Asset/Location → Fields & Relationships → each
  `AHA_*` field → Set Field-Level Security.

---

## 4. Pre/Post configuration that is NOT in the metadata

These steps mirror the manual guide and still require the Setup UI. An assistant should
**prompt the operator** to perform them (or confirm they are done).

### 4a. Standard picklist values (`LocationType`, `Asset.Status`) — applied by the §2 merge step ✅

Two standard picklists need extra values before the record types will deploy:
- **`Location.LocationType`** — the 19 housing values the Location record types require
- **`Asset.Status`** — the `Active` / `Planned` / `Obsolete` values the Asset record types require

⚠️ A `StandardValueSet` deploy **replaces** the entire active value set — any value in the target
org that is *not* in the deployed file gets **deactivated**. Shipping these as a direct deploy
would wipe a customer org's own values. To stay non-destructive, the canonical value lists live in
`standardValueSets/*.standardValueSet-meta.xml` (and are `.forceignore`d so they are never deployed
directly); `scripts/merge-standard-valuesets.mjs` applies them **additively** — it retrieves each
value set from the target, adds only the missing AHA values, preserves everything else, and
redeploys. This is Step 1 of §2 and must run **before** the package deploy. The 19 `LocationType`
values are:

```
General Needs Scheme · Sheltered / Supported Housing Scheme · Extra Care Scheme ·
Mixed-Tenure Development · Temporary Accommodation Site · Commercial Zone ·
High-Rise Block · Low / Mid-Rise Block · Maisonette Block · Sheltered Facility Block ·
Garage Block · Communal Structure · Flat / Apartment · House · Maisonette ·
Bedsit / Studio / HMO Room · Garage / Parking Bay · Store Room / Shed · Communal Area Unit
```

> If the record types fail with "Picklist value … not found", the merge step didn't run (or didn't
> finish) before the package deploy — run `node scripts/merge-standard-valuesets.mjs <alias>` and
> redeploy.

### 4b. Lightning Record Page assignment — automatic for System Administrator ✅

The seven FlexiPages (4 for `Asset`, 3 for `Location`) are assigned to their object + record type
automatically. The `AHA` CustomApplication ships `profileActionOverrides` that bind each record
page, and these deploy in §2. **No manual activation is needed for the System Administrator
profile.**

The **classic page-layout assignments** (the record-detail layouts behind Dynamic Forms, related
lists, and mobile cards) are delivered by the packaged `Admin` profile
(`profiles/Admin.profile-meta.xml`), which binds each AHA record type to its `Asset-AHA *` /
`Location-AHA *` layout for the System Administrator profile. Without it the org falls back to the
default `Asset Layout` for every record type. Users on **other** profiles get the org-default
layout — assign the AHA layouts to those profiles manually (Setup → Object Manager → Asset/Location
→ Page Layouts → **Page Layout Assignment**) or extend the profile and redeploy.

| FlexiPage | Object | Record Type |
|---|---|---|
| `AHA_Block_Asset`     | Asset | Block |
| `AHA_Component_Asset` | Asset | Component |
| `AHA_Estate_Asset`    | Asset | Estate |
| `AHA_Unit_Asset`      | Asset | Unit |
| `AHA_Block`          | Location | AHA Block |
| `AHA_Estate`         | Location | AHA Estate |
| `AHA_Unit`           | Location | AHA Unit |

(`AHA_UtilityBar` is the app's utility bar, not a record page — referenced via `<utilityBar>` in
the app; nothing to activate.)

> ⚠️ **Profile scope:** the shipped overrides are scoped to the **System Administrator**
> (`<profile>Admin</profile>`) profile only. Users on **other** profiles are not covered and will
> see the org-default record page. For those profiles, either assign the pages manually in
> Lightning App Builder (see §Post-Installation of the
> [manual Install Guide](01_Install_Guide.md)), or add matching
> `profileActionOverrides` for the profile to `applications/AHA.app-meta.xml` and redeploy.

**Verify** — open any Asset/Location record of an AHA record type as an admin and confirm the AHA
page renders, or inspect the metadata:

```bash
sf project retrieve start --metadata "CustomApplication:AHA" --target-org <alias>
grep -c "<profileActionOverrides>" force-app/main/default/applications/AHA.app-meta.xml   # expect 14
```

---

## 5. Verify the install

```bash
# Fields visible to SOQL (confirms deploy + FLS). Should NOT error.
sf data query --query "SELECT Id, AHA_UPRN__c FROM Asset LIMIT 1"       --target-org <alias>
sf data query --query "SELECT Id, AHA_UPRN__c FROM Location LIMIT 1"    --target-org <alias>

# Hierarchy link fields visible (confirms View All Fields + editable FLS). Should NOT error.
sf data query --query "SELECT Id, LocationId FROM Asset LIMIT 1"            --target-org <alias>
sf data query --query "SELECT Id, ParentLocationId FROM Location LIMIT 1"   --target-org <alias>

# Record types present. Expect exactly 7 — 4 on Asset, 3 on Location. Record types on any other
# object (e.g. an AHA_* type on Account) are pre-existing org data, not from this package.
sf data query --query "SELECT DeveloperName, SobjectType FROM RecordType WHERE SobjectType IN ('Asset','Location') AND DeveloperName LIKE 'AHA_%' ORDER BY SobjectType, DeveloperName" --target-org <alias>

# LocationType picklist populated (expect 19)
sf data query --query "SELECT COUNT() FROM PicklistValueInfo WHERE EntityParticle.EntityDefinition.QualifiedApiName='Location' AND EntityParticle.QualifiedApiName='LocationType'" --target-org <alias>

# App deployed — CustomApplication is NOT SOQL-queryable; verify via metadata listing
sf org list metadata --metadata-type CustomApplication --target-org <alias> --json | grep -o '"fullName": *"AHA"'
```

A "No such column" error on any of these (`AHA_UPRN__c`, `LocationId`, `ParentLocationId`) means
**FLS was not granted** → return to §3 and assign `AHA_Core`.

Final human check: open the **AHA** app in LEX, create a `Location` and an `Asset` of each
record type, and confirm the record pages render.

---

## 6. Quick checklist (assistant summary)

- [ ] §1 Preflight: license/edition OK, LEX default, **Person Accounts enabled**, non-prod org
- [ ] §2 Run `node scripts/merge-standard-valuesets.mjs <alias>` (StandardValueSet merge), then `sf project deploy start --manifest manifest/package.xml` succeeds (dry-run first)
- [ ] §3 **FLS granted** — `sf org assign permset --name AHA_Core` (or manual)
- [ ] §4a Standard picklist values merged non-destructively — `LocationType` (19) + `Asset.Status` (Active/Planned/Obsolete) present, existing org values preserved
- [ ] §4b Record pages auto-assigned for Admin profile (shipped in AHA app); non-Admin profiles need manual assignment
- [ ] §5 Verification queries return rows without "No such column" errors

If any prerequisite is unmet, **stop and ask the operator** rather than forcing the deploy.
