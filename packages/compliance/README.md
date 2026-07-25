# @stratum-hq/compliance

A content-free compliance **kernel** for [Stratum](https://github.com/stratum-hq/Stratum): the pure mechanics and type shapes any compliance product needs, with none of the content. Zero runtime dependencies, no database, no network, no provider, and no built-in catalog.

It gives you three things:

1. **Coverage scoring** — diff a declared baseline against a resolved state and get a per-control breakdown plus a 0 to 100 score.
2. **A finding state machine** — a pure decision for whether a new evaluation outcome should open, resolve, or leave a finding alone.
3. **A control type vocabulary** — structural interfaces for describing a catalog of controls.

> [!NOTE]
> This is **not** a batteries-included compliance solution. It ships no frameworks, no controls, no provider mappings, and no thresholds. **Bring your own catalog:** you supply the content and the persistence; this package supplies the arithmetic and the shapes.

## Installation

```bash
npm install @stratum-hq/compliance
```

## Coverage scoring

`scoreCoverage` compares a `baseline` (what each control is expected to be) against a `resolved` map (what each control actually is). Only baseline keys are scored; extra resolved keys are ignored.

```typescript
import { scoreCoverage } from "@stratum-hq/compliance";

const baseline = { mfaRequired: true, passwordMinLength: 12 };
const resolved = {
  mfaRequired: { value: "true" }, // resolved config often arrives as strings
  passwordMinLength: { value: 8 },
  // passwordMinLength is present but wrong; a key omitted here would be "missing"
};

const result = scoreCoverage(baseline, resolved);
// {
//   total: 2, compliant: 1, drift: 1, missing: 0, score: 50,
//   details: [
//     { key: "mfaRequired",       expected: true, actual: "true", status: "compliant" },
//     { key: "passwordMinLength", expected: 12,   actual: 8,      status: "drift" },
//   ],
// }
```

- `status` is `"compliant"` (matches), `"drift"` (present but wrong), or `"missing"` (no resolved entry for that key).
- `score` is `round(compliant / total * 100)`. An **empty baseline scores 100** — nothing is required, so nothing is out of compliance.

### Equality

The default comparator is `looseEqual`: booleans, numbers, and strings compare by their **textual form** (`true` equals `"true"`, `5` equals `"5"`), while objects and arrays compare by their **JSON form** (order-sensitive). This tolerates config values that come back as strings. Override it for strict or domain-specific comparison:

```typescript
import { scoreCoverage, looseEqual } from "@stratum-hq/compliance";

scoreCoverage(baseline, resolved, { equals: (e, a) => e === a }); // strict
looseEqual(true, "true"); // => true
```

## Finding state machine

`reconcileFinding` decides what should happen to a control's finding when a new evaluation outcome arrives. It is a pure decision — you persist the result.

```typescript
import { reconcileFinding } from "@stratum-hq/compliance";

reconcileFinding("fail", "none"); // { type: "open" }    — new gap
reconcileFinding("fail", "open"); // { type: "noop" }    — already tracked
reconcileFinding("pass", "open"); // { type: "resolve" } — gap closed
reconcileFinding("pass", "accepted"); // { type: "noop" } — accepted risk untouched
reconcileFinding("na", "open"); // { type: "noop" }      — na/error never change a finding
```

The rules:

- `fail` **opens** a finding, unless one is already active (`open` / `remediating`) or the risk was formally `accepted`.
- `pass` **resolves** an active finding (`open` / `remediating`), and leaves an `accepted` finding untouched; otherwise there is nothing to resolve.
- `na` and `error` are always no-ops.

Map `{ type: "open" }` and `{ type: "resolve" }` onto your own inserts and updates — the state machine has no opinion about storage.

## Type vocabulary

Structural, content-free interfaces for describing a catalog. They carry no data and no provider mapping; populate them with your own content.

```typescript
import type {
  FieldType, // "boolean" | "number" | "enum"
  Verification, // "verified" | "attestation" | "declared"
  CatalogField,
  CatalogGroup,
  ManualControl,
  ControlDef,
} from "@stratum-hq/compliance";
```

## Design

Everything here is a pure function or a type. No side effects, no IO, no global state, and nothing to configure. That is deliberate: the reusable part of compliance is the arithmetic and the vocabulary, so the interesting, product-specific parts (which controls, mapped to which real settings, for which framework, loaded and stored how) stay entirely on your side of the boundary.

## Links

- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
