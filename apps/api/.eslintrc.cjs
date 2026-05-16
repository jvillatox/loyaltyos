const base = require("@loyaltyos/config-eslint");

module.exports = {
  ...base,
  ignorePatterns: [...(base.ignorePatterns || []), "src/__tests__/**"],
};
