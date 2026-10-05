// Checked by `npm run typecheck`, never executed. Each @ts-expect-error must match a real error.
// If a strictness flag is switched off, the directive becomes unused and typecheck fails.

const scores: number[] = [];
// @ts-expect-error noUncheckedIndexedAccess: scores[0] has type number | undefined.
const firstScore: number = scores[0];

interface LabelOptions {
  label?: string;
}
// @ts-expect-error exactOptionalPropertyTypes: an optional property cannot be set to undefined.
const labelOptions: LabelOptions = { label: undefined };

export { firstScore, labelOptions };
