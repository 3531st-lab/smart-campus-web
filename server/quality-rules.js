const MODULES = Object.freeze({
  moral: Object.freeze({ label: "寰疯偛", max: 28, min: 0 }),
  intellectual: Object.freeze({ label: "鏅鸿偛", max: 48, min: 0 }),
  physical: Object.freeze({ label: "浣撹偛", max: 8, min: 0 }),
  aesthetic: Object.freeze({ label: "缇庤偛", max: 8, min: 0 }),
  labor: Object.freeze({ label: "鍔宠偛", max: 8, min: -8 })
});

const RULE_VERSION = Object.freeze({
  id: "2025-economics-management",
  modules: MODULES,
  zeroRules: Object.freeze(["SERIOUS_DISCIPLINE", "EVIDENCE_FALSIFICATION"])
});

function score(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error("鍒嗗€煎繀椤讳负鏁板瓧"), { statusCode: 400 });
  return Math.round(parsed * 100) / 100;
}

function calculateQualityRecord({ modules = {}, zeroRuleCodes = [] }) {
  const moduleScores = {};
  const calculation = {};
  for (const [id, config] of Object.entries(MODULES)) {
    const input = modules[id] || {};
    const base = score(input.base);
    const bonus = score(input.bonus);
    const deduction = score(input.deduction);
    const raw = score(base + bonus - deduction);
    const final = score(Math.min(config.max, Math.max(config.min, raw)));
    moduleScores[id] = final;
    calculation[id] = { base, bonus, deduction, raw, final, capped: raw !== final };
  }
  const zeroed = zeroRuleCodes.some((code) => RULE_VERSION.zeroRules.includes(code));
  const totalScore = zeroed ? 0 : score(Object.values(moduleScores).reduce((sum, value) => sum + value, 0));
  const warnings = moduleScores.moral < 16 ? ["寰疯偛浣庝簬16鍒嗭紝闇€杩涜璇勫璇勪紭璧勬牸澶嶆牳"] : [];
  return { moduleScores, totalScore, zeroed, warnings, calculation };
}

function validateQualityItem(item, ruleVersion = RULE_VERSION) {
  const module = String(item?.module || "");
  const type = String(item?.type || "");
  if (!ruleVersion.modules[module]) throw Object.assign(new Error("缁兼祴妯″潡鏃犳晥"), { statusCode: 400 });
  if (!["base", "bonus", "deduction"].includes(type)) throw Object.assign(new Error("璁″垎绫诲瀷鏃犳晥"), { statusCode: 400 });
  return {
    module,
    type,
    ruleCode: String(item?.ruleCode || "CUSTOM").slice(0, 80),
    claimedScore: score(item?.claimedScore),
    evidenceRequired: type !== "base"
  };
}

module.exports = { getQualityRuleVersion: () => RULE_VERSION, calculateQualityRecord, validateQualityItem };
