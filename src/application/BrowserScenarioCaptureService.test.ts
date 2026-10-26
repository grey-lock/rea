import { expect, it } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { parseEvidence } from "../domain/evidence.js";
import { browserScenarioInputSchema } from "../domain/browserScenario.js";
import { err } from "../domain/result.js";
import { scriptScenarioFixture } from "../../tests/fixtures/webScriptCapture.js";
import type { BrowserScenarioCapturePort } from "./BrowserScenarioCapturePort.js";
import { captureBrowserScenario } from "./BrowserScenarioCaptureService.js";
import { browserScenarioCaptureSchema } from "../domain/browserScenarioCapture.js";

const scenario = browserScenarioInputSchema.parse({
  browser: { mode: "launch", executable_path: "/fixture/chrome" },
  start_url: { url: "https://fixture.test/", query: [] },
  actions: [{ step_id: "settle", action: "wait_for_timeout", duration_ms: 1 }],
});
const capture = scriptScenarioFixture();

it("retains an interrupted scenario as a typed partial capture", async () => {
  const completeness = {
    status: "incomplete",
    equality_eligible: false,
    missing_sections: ["action"],
    truncated_sections: [],
  };
  const partialCapture = browserScenarioCaptureSchema.parse({
    ...capture,
    completeness,
    steps: capture.steps.map((step, index) =>
      index === capture.steps.length - 1
        ? { ...step, status: "cancelled", error: "Cancelled", completeness }
        : step,
    ),
  });
  const partial = {
    kind: "browser-scenario-observation" as const,
    capture: partialCapture,
  };
  const failure = new AnalysisCancelledError("capture_browser_scenario", {
    partialObservation: partial,
  });
  const result = await captureBrowserScenario(
    {
      identity: () => ({ id: "fixture", name: "Fixture", version: "1" }),
      captureScenario: async () => err(failure),
    },
    scenario,
  );
  expect(result).toEqual(err(failure));
  expect(failure.partialObservation).toBe(partial);
});

it("converts a retained raw scenario capture into partial Evidence", async () => {
  const failure = new AnalysisCancelledError("capture_browser_scenario", {
    partialObservation: {
      kind: "browser-scenario-observation",
      capture,
    },
  });
  const provider: BrowserScenarioCapturePort = {
    identity: () => ({
      id: "scenario-fixture",
      name: "Scenario fixture",
      version: "1",
    }),
    captureScenario: async () => err(failure),
  };
  const result = await captureBrowserScenario(provider, scenario);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "capture_browser_scenario",
      normalized_result: capture,
    });
  }
});

it("converts a raw scenario capture retained after cleanup failure", async () => {
  const failure = new BrowserObservationError(
    "capture_browser_scenario",
    "cleanup_failed",
    {
      cleanup: {
        reason: "browser close failed",
        resources: ["browser process"],
      },
      partialObservation: {
        kind: "browser-scenario-observation",
        capture,
      },
    },
  );
  const provider: BrowserScenarioCapturePort = {
    identity: () => ({
      id: "scenario-fixture",
      name: "Scenario fixture",
      version: "1",
    }),
    captureScenario: async () => err(failure),
  };
  const result = await captureBrowserScenario(provider, scenario);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "capture_browser_scenario",
      normalized_result: capture,
    });
  }
});
