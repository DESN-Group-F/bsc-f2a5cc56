import { test } from "node:test";
import assert from "node:assert/strict";
import { ageInDays, serviceAgeAsOfOn } from "../work/qa/battery-age.mjs";

test("service age stops on the Sydney retirement date while manufacture age continues", () => {
  const battery = { lifecycleStatus: "scrapped", lifecycleAt: "2026-10-05T13:30:00Z" };
  assert.equal(serviceAgeAsOfOn(battery, "2026-10-20"), "2026-10-06");
  assert.equal(ageInDays("2026-10-01", serviceAgeAsOfOn(battery, "2026-10-20")), 5);
  assert.equal(ageInDays("2026-10-01", "2026-10-20"), 19);
  assert.equal(serviceAgeAsOfOn({ lifecycleStatus: "permanently_removed", lifecycleAt: "2026-07-01T14:00:00Z" }, "2026-10-20"), "2026-07-02");
  assert.equal(serviceAgeAsOfOn({ lifecycleStatus: "active" }, "2026-10-20"), "2026-10-20");
  assert.equal(serviceAgeAsOfOn({}, "2026-10-20"), "2026-10-20");
});

test("missing, malformed and future retirement evidence leaves service age unknown", () => {
  for (const lifecycleAt of [null, "", "2026-10-01", "2026-02-30T00:00:00Z", "2026-10-01T24:00:00Z", "2026-10-01T10:00:00", "2026-10-21T00:00:00Z"]) {
    assert.equal(serviceAgeAsOfOn({ lifecycleStatus: "scrapped", lifecycleAt }, "2026-10-20"), null, String(lifecycleAt));
  }
  assert.equal(serviceAgeAsOfOn({ lifecycleStatus: "unknown", lifecycleAt: "2026-10-01T00:00:00Z" }, "2026-10-20"), null);
  assert.equal(serviceAgeAsOfOn({ lifecycleStatus: "active" }, "2026-02-30"), null);
});
