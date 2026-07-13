(function timetableCoreFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TimetableCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTimetableCore() {
  const MAX_SECTION = 12;
  const MAX_SECTION_COUNT = 4;

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function toBoundedInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
  }

  function parseSectionSpec(value) {
    if (Number.isFinite(Number(value)) && String(value).trim() !== "") {
      return { start: Math.trunc(Number(value)), count: null };
    }
    const text = String(value || "")
      .trim()
      .replace(/[–—~～至到]/g, "-")
      .replace(/\s+/g, "");
    const range = text.match(/(?:第)?(\d{1,2})-(\d{1,2})(?:节)?/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start) return { start, count: end - start + 1 };
    }
    const single = text.match(/(?:第)?(\d{1,2})(?:节)?/);
    return single ? { start: Number(single[1]), count: null } : { start: null, count: null };
  }

  function parseSectionCount(value) {
    const spec = parseSectionSpec(value);
    if (spec.count) return spec.count;
    return spec.start;
  }

  function normalizePlacement(course = {}, options = {}) {
    const rawStart = firstDefined(
      course.startSection,
      course.section,
      course.period,
      course["开始节次"],
      course["起始节次"],
      course["节次"]
    );
    const startSpec = parseSectionSpec(rawStart);
    const fallbackStart = toBoundedInteger(options.fallbackStart, 1, MAX_SECTION, 1);
    const startSection = toBoundedInteger(startSpec.start, 1, MAX_SECTION, fallbackStart);
    const rawCount = firstDefined(
      course.sectionCount,
      course.duration,
      course.count,
      course["连续节数"],
      course["节数"]
    );
    const inferredCount = parseSectionCount(rawCount) || startSpec.count || options.fallbackCount || 2;
    const sectionCount = toBoundedInteger(
      inferredCount,
      1,
      Math.min(MAX_SECTION_COUNT, MAX_SECTION - startSection + 1),
      2
    );
    return { startSection, sectionCount };
  }

  function gridPlacement(course = {}, options = {}) {
    const placement = normalizePlacement(course, options);
    return {
      ...placement,
      gridRowStart: placement.startSection + 1,
      gridRowSpan: placement.sectionCount
    };
  }

  return {
    MAX_SECTION,
    MAX_SECTION_COUNT,
    parseSectionSpec,
    normalizePlacement,
    gridPlacement
  };
});
