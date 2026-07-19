const test = require("node:test");
const assert = require("node:assert/strict");
const { getQualityRuleVersion, calculateQualityRecord, validateQualityItem } = require("../server/quality-rules");

test("calculates five modules with positive deductions", () => {
  const result = calculateQualityRecord({
    modules: {
      moral: { base: 18, bonus: 2.3, deduction: 0.5 },
      intellectual: { base: 36, bonus: 1.2, deduction: 0.2 },
      physical: { base: 4, bonus: 0.5, deduction: 0.2 },
      aesthetic: { base: 3, bonus: 1, deduction: 0.3 },
      labor: { base: 4, bonus: 1.5, deduction: 0.5 }
    },
    zeroRuleCodes: []
  });
  assert.deepEqual(result.moduleScores, {
    moral: 19.8,
    intellectual: 37,
    physical: 4.3,
    aesthetic: 3.7,
    labor: 5
  });
  assert.equal(result.totalScore, 69.8);
});

test("caps modules and permits labor down to negative eight", () => {
  const result = calculateQualityRecord({
    modules: {
      moral: { base: 28, bonus: 20, deduction: 0 },
      intellectual: { base: 48, bonus: 20, deduction: 0 },
      physical: { base: 8, bonus: 10, deduction: 0 },
      aesthetic: { base: 8, bonus: 10, deduction: 0 },
      labor: { base: 0, bonus: 0, deduction: 20 }
    },
    zeroRuleCodes: []
  });
  assert.deepEqual(result.moduleScores, { moral: 28, intellectual: 48, physical: 8, aesthetic: 8, labor: -8 });
  assert.equal(result.totalScore, 84);
});

test("zero rules override the calculated total", () => {
  const result = calculateQualityRecord({
    modules: { moral: { base: 18 }, intellectual: { base: 38 }, physical: { base: 5 }, aesthetic: { base: 3 }, labor: { base: 4 } },
    zeroRuleCodes: ["SERIOUS_DISCIPLINE"]
  });
  assert.equal(result.zeroed, true);
  assert.equal(result.totalScore, 0);
});

test("returns an immutable 2025 economics-management rule version", () => {
  const version = getQualityRuleVersion("ignored-version-id");

  assert.equal(version.id, "2025-economics-management");
  assert.deepEqual(version.zeroRules, ["SERIOUS_DISCIPLINE", "EVIDENCE_FALSIFICATION"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(version.modules).map(([id, module]) => [id, module.label])),
    { moral: "德育", intellectual: "智育", physical: "体育", aesthetic: "美育", labor: "劳育" }
  );
  assert.equal(version.modules.labor.min, -8);
  assert.equal(Object.isFrozen(version), true);
  assert.equal(Object.isFrozen(version.modules), true);
  assert.equal(Object.isFrozen(version.modules.moral), true);
});

test("rounds values and warns when moral score is below sixteen", () => {
  const result = calculateQualityRecord({ modules: { moral: { base: 15.999 } } });

  assert.equal(result.moduleScores.moral, 16);
  assert.deepEqual(result.warnings, []);

  const warned = calculateQualityRecord({ modules: { moral: { base: 15.99 } } });
  assert.equal(warned.moduleScores.moral, 15.99);
  assert.deepEqual(warned.warnings, ["德育低于16分，需进行评奖评优资格复核"]);
});

test("validates and normalizes quality items", () => {
  const item = validateQualityItem({ module: "physical", type: "bonus", claimedScore: "1.235" });
  const baseItem = validateQualityItem({ module: "moral", type: "base", ruleCode: "BASE-001", claimedScore: 18 });

  assert.deepEqual(item, {
    module: "physical",
    type: "bonus",
    ruleCode: "CUSTOM",
    claimedScore: 1.24,
    evidenceRequired: true
  });
  assert.equal(baseItem.evidenceRequired, false);
});

test("rejects invalid quality items and scores with status-coded errors", () => {
  for (const item of [
    { module: "unknown", type: "base" },
    { module: "moral", type: "other" },
    { module: "moral", type: "base", claimedScore: "not-a-number" }
  ]) {
    assert.throws(
      () => validateQualityItem(item),
      (error) => error.statusCode === 400
    );
  }
});

test("uses the corrected UTF-8 labels and messages", () => {
  const version = getQualityRuleVersion();
  const expectedMessages = ["分值必须为数字", "综测模块无效", "计分类型无效"];

  assert.deepEqual(
    Object.values(version.modules).map((module) => module.label),
    ["德育", "智育", "体育", "美育", "劳育"]
  );
  assert.throws(() => calculateQualityRecord({ modules: { moral: { base: "not-a-number" } } }), /分值必须为数字/);
  assert.throws(() => validateQualityItem({ module: "unknown", type: "base" }), /综测模块无效/);
  assert.throws(() => validateQualityItem({ module: "moral", type: "other" }), /计分类型无效/);

  for (const message of expectedMessages) {
    assert.doesNotMatch(message, /[锛鏅浣缇鍔寰]/);
  }
});
