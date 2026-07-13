const test = require("node:test");
const assert = require("node:assert/strict");
const timetableCore = require("../public/timetable-core-v155.js");

test("keeps numeric timetable placement unchanged", () => {
  assert.deepEqual(timetableCore.normalizePlacement({ startSection: 3, sectionCount: 2 }), {
    startSection: 3,
    sectionCount: 2
  });
});

test("parses legacy Chinese section range without auto-placing at the grid bottom", () => {
  const placement = timetableCore.gridPlacement({ startSection: "第1-2节", sectionCount: "2节" });
  assert.deepEqual(placement, {
    startSection: 1,
    sectionCount: 2,
    gridRowStart: 2,
    gridRowSpan: 2
  });
});

test("infers the span from a range when no explicit count exists", () => {
  assert.deepEqual(timetableCore.normalizePlacement({ startSection: "1-3" }), {
    startSection: 1,
    sectionCount: 3
  });
});

test("accepts OCR-style labels and clamps a course to the visible 12-section grid", () => {
  assert.deepEqual(timetableCore.normalizePlacement({ startSection: "第11节", sectionCount: "4节" }), {
    startSection: 11,
    sectionCount: 2
  });
});

test("always returns finite placement for malformed imported values", () => {
  const placement = timetableCore.gridPlacement({ startSection: "上午", sectionCount: "两节" });
  assert.equal(Number.isInteger(placement.gridRowStart), true);
  assert.equal(Number.isInteger(placement.gridRowSpan), true);
  assert.ok(placement.gridRowStart >= 2 && placement.gridRowStart <= 13);
  assert.ok(placement.gridRowSpan >= 1 && placement.gridRowSpan <= 4);
});
