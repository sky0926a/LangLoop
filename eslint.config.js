import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["tests/fixtures/draft-vendor/**"] },
  ...tseslint.configs.recommended,
  {
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
