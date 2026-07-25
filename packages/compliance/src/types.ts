// Control type vocabulary.
//
// Structural, content-free shapes for describing a catalog of controls: how a
// field is typed, how it is verified, and how declared controls relate to
// verified ones. These interfaces carry no data and no provider mapping. Bring
// your own catalog: populate them with your product's own content.

/** The data type of a catalog field's value. */
export type FieldType = "boolean" | "number" | "enum";

/**
 * How a control's compliance is established: machine-`verified` from evidence,
 * covered by a signed operator `attestation`, or self-`declared` by the caller.
 */
export type Verification = "verified" | "attestation" | "declared";

/** A single configurable control in a catalog. */
export interface CatalogField {
  key: string;
  label: string;
  /** The {@link CatalogGroup} this field belongs to, by name. */
  group: string;
  type: FieldType;
  /** Choices for an `enum` field. */
  options?: { value: string; label: string }[];
  /** Suggested values for a `number` field. */
  presets?: { value: number; label: string }[];
  help: string;
  verification: Verification;
  /** For a `declared` field, the key of the verified control it maps to. */
  verifiedControl?: string;
}

/** A named grouping of catalog fields. */
export interface CatalogGroup {
  name: string;
  blurb: string;
}

/** A control that no automated check can prove, covered by an attestation. */
export interface ManualControl {
  key: string;
  label: string;
  /** The frameworks this manual control satisfies. */
  frameworks: string[];
  description: string;
}

/** A verified control definition. */
export interface ControlDef {
  key: string;
  label: string;
  /** The declared field this control backs, or `null` if it stands alone. */
  declaredKey: string | null;
}
